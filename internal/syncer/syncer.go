package syncer

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	_ "github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
	"github.com/lipaysamart/mailhooks/internal/config"
	"github.com/lipaysamart/mailhooks/internal/model"
	"github.com/lipaysamart/mailhooks/internal/queue"
	"github.com/lipaysamart/mailhooks/internal/state"
	"go.uber.org/zap"
)

type Syncer struct {
	cfg        config.ResolvedAccountConfig
	queue      *queue.Queue
	stateStore *state.Store
	logger     *zap.Logger
}

func New(
	cfg config.ResolvedAccountConfig,
	q *queue.Queue,
	s *state.Store,
	logger *zap.Logger,
) *Syncer {
	return &Syncer{
		cfg:        cfg,
		queue:      q,
		stateStore: s,
		logger:     logger,
	}
}

func (s *Syncer) Run(ctx context.Context) {
	s.logger.Info("syncer started",
		zap.String("account", s.cfg.Name),
		zap.Duration("interval", s.cfg.SyncInterval),
	)
	ticker := time.NewTicker(s.cfg.SyncInterval)
	defer ticker.Stop()

	if err := s.Sync(ctx); err != nil {
		s.logger.Error("sync failed", zap.String("account", s.cfg.Name), zap.Error(err))
	}

	for {
		select {
		case <-ticker.C:
			if err := s.Sync(ctx); err != nil {
				s.logger.Error("sync failed", zap.String("account", s.cfg.Name), zap.Error(err))
			}
		case <-ctx.Done():
			s.logger.Info("syncer stopped", zap.String("account", s.cfg.Name))
			return
		}
	}
}

func (s *Syncer) Sync(ctx context.Context) error {
	hostPort := s.cfg.Host + ":" + strconv.Itoa(s.cfg.Port)

	var client *imapclient.Client
	var err error

	if s.cfg.TLS {
		client, err = imapclient.DialTLS(hostPort, &imapclient.Options{
			TLSConfig: &tls.Config{InsecureSkipVerify: false},
		})
	} else {
		client, err = imapclient.DialStartTLS(hostPort, &imapclient.Options{})
	}
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = client.Close() }()
	s.logger.Debug("imap connected", zap.String("account", s.cfg.Name))

	if err := client.Login(s.cfg.Username, s.cfg.Password).Wait(); err != nil {
		return fmt.Errorf("login: %w", err)
	}
	s.logger.Debug("imap login ok", zap.String("account", s.cfg.Name))

	selectCmd := client.Select("INBOX", nil)
	mailboxData, err := selectCmd.Wait()
	if err != nil {
		return fmt.Errorf("select inbox: %w", err)
	}
	uidValidity := mailboxData.UIDValidity
	uidNext := mailboxData.UIDNext
	s.logger.Debug("inbox selected",
		zap.String("account", s.cfg.Name),
		zap.Uint32("uid_validity", uidValidity),
		zap.Uint32("uid_next", uint32(uidNext)),
	)

	if uidNext == 0 {
		s.logger.Warn("uid_next is 0, skipping sync",
			zap.String("account", s.cfg.Name))
		return nil
	}

	state, err := s.stateStore.Load(s.cfg.Name)
	if err != nil {
		return fmt.Errorf("load state: %w", err)
	}

	isInitialSync := state.LastUID == 0

	if uidValidity != state.UIDValidity {
		s.logger.Info("UIDValidity changed, full resync",
			zap.String("account", s.cfg.Name),
			zap.Uint32("old", state.UIDValidity),
			zap.Uint32("new", uidValidity),
		)
		state.LastUID = 0
		isInitialSync = true
	}

	if uint32(uidNext) <= state.LastUID+1 {
		s.logger.Debug("no new messages",
			zap.String("account", s.cfg.Name),
			zap.Uint32("uid_next", uint32(uidNext)),
			zap.Uint32("last_uid", state.LastUID),
		)
		return nil
	}

	var uidSet imap.UIDSet
	uidSet.AddRange(imap.UID(state.LastUID+1), 0)

	fetchOptions := &imap.FetchOptions{
		Flags:    true,
		Envelope: true,
		BodySection: []*imap.FetchItemBodySection{
			{},
		},
	}

	queueCfg := s.queue.Config()

	fetchCmd := client.Fetch(uidSet, fetchOptions)

	newCount := 0
	for {
		msgData := fetchCmd.Next()
		if msgData == nil {
			break
		}

		msgBuf, err := msgData.Collect()
		if err != nil {
			s.logger.Error("collect message failed",
				zap.String("account", s.cfg.Name),
				zap.Error(err),
			)
			continue
		}

		if len(msgBuf.BodySection) == 0 {
			continue
		}
		rawBody := msgBuf.BodySection[0].Bytes

		s.logger.Debug("fetching message",
			zap.String("account", s.cfg.Name),
			zap.Uint32("uid", uint32(msgBuf.UID)),
		)

		email, parseErr := s.parseMIME(rawBody)
		if parseErr != nil {
			s.logger.Error("parse MIME failed",
				zap.String("account", s.cfg.Name),
				zap.Uint32("uid", uint32(msgBuf.UID)),
				zap.Error(parseErr),
			)
			continue
		}
		email.AccountName = s.cfg.Name
		email.Folder = "INBOX"
		email.SyncedAt = time.Now()
		if msgBuf.Flags != nil {
			for _, f := range msgBuf.Flags {
				email.Flags = append(email.Flags, string(f))
			}
		}

		// Initial sync: update state only, do not enqueue for webhook delivery
		if isInitialSync {
			s.logger.Debug("initial sync, skipping enqueue",
				zap.String("account", s.cfg.Name),
				zap.Uint32("uid", uint32(msgBuf.UID)),
			)
			if msgBuf.UID > imap.UID(state.LastUID) {
				state.LastUID = uint32(msgBuf.UID)
			}
			newCount++
			continue
		}

		s.logger.Info("new message synced",
			zap.String("account", s.cfg.Name),
			zap.Uint32("uid", uint32(msgBuf.UID)),
			zap.String("subject", email.Subject),
		)

		itemID := email.MessageID
		if itemID == "" {
			itemID = fmt.Sprintf("%d@%s", msgBuf.UID, s.cfg.Name)
		} else {
			itemID = itemID + "@" + s.cfg.Name
		}

		s.queue.Push(&model.QueueItem{
			ID:           itemID,
			Email:        email,
			MaxRetries:   queueCfg.MaxRetries,
			NextRetryAt:  time.Now(),
			ExpireAt:     time.Now().Add(queueCfg.ExpireAfter),
			WebhookURL:   s.cfg.WebhookURL,
			WebhookTmout: s.cfg.WebhookTimeout,
		})

		if msgBuf.UID > imap.UID(state.LastUID) {
			state.LastUID = uint32(msgBuf.UID)
		}
		newCount++
	}

	if err := fetchCmd.Close(); err != nil {
		return fmt.Errorf("fetch error: %w", err)
	}

	state.UIDValidity = uidValidity
	if err := s.stateStore.Save(s.cfg.Name, state); err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	s.logger.Debug("sync complete",
		zap.String("account", s.cfg.Name),
		zap.Int("new_messages", newCount),
		zap.Uint32("last_uid", state.LastUID),
	)
	return nil
}

func (s *Syncer) parseMIME(raw []byte) (*model.Email, error) {
	mr, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("create mail reader: %w", err)
	}
	email := &model.Email{}

	header := mr.Header
	email.MessageID, _ = header.MessageID()
	email.Subject, _ = header.Subject()
	if from, err := header.AddressList("From"); err == nil && len(from) > 0 {
		email.From = &model.Address{Name: from[0].Name, Address: from[0].Address}
	}
	if to, err := header.AddressList("To"); err == nil {
		for _, a := range to {
			email.To = append(email.To, model.Address{Name: a.Name, Address: a.Address})
		}
	}
	if d, err := header.Date(); err == nil {
		email.Date = d
	}

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		switch h := part.Header.(type) {
		case *mail.InlineHeader:
			bodyBytes, readErr := io.ReadAll(part.Body)
			if readErr != nil {
				s.logger.Warn("failed to read inline body",
					zap.String("account", s.cfg.Name),
					zap.Error(readErr))
				continue
			}
			ct := part.Header.Get("Content-Type")
			mediaType, _, _ := mime.ParseMediaType(ct)
			switch {
			case strings.HasPrefix(mediaType, "text/plain"):
				email.TextBody = string(bodyBytes)
			case strings.HasPrefix(mediaType, "text/html"):
				email.HTMLBody = string(bodyBytes)
			}
		case *mail.AttachmentHeader:
			bodyBytes, readErr := io.ReadAll(part.Body)
			if readErr != nil {
				s.logger.Warn("failed to read attachment body",
					zap.String("account", s.cfg.Name),
					zap.Error(readErr))
				continue
			}
			filename, fnErr := h.Filename()
			if fnErr != nil {
				filename = "unknown"
			}
			mediaType, _, _ := mime.ParseMediaType(part.Header.Get("Content-Type"))
			att := model.Attachment{
				Filename: filename,
				MIMEType: mediaType,
				Size:     len(bodyBytes),
			}
			if s.cfg.IncludeAttachmentContent {
				att.Content = base64.StdEncoding.EncodeToString(bodyBytes)
			}
			email.Attachments = append(email.Attachments, att)
		}
	}
	return email, nil
}
