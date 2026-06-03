package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/lipaysamart/mailhooks/internal/model"
)

type AttachmentPayload struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int    `json:"size"`
}

type FromPayload struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type EmailPayload struct {
	ID          string             `json:"id"`
	AccountName string             `json:"accountName"`
	Folder      string             `json:"folder"`
	From        *FromPayload       `json:"from"`
	To          []string           `json:"to"`
	Subject     string             `json:"subject"`
	Text        string             `json:"text"`
	Body        string             `json:"body"`
	HTML        string             `json:"html,omitempty"`
	Attachments []AttachmentPayload `json:"attachments,omitempty"`
	Date        string             `json:"date"`
	SyncedAt    string             `json:"syncedAt"`
	Flags       []string           `json:"flags,omitempty"`
}

func Send(ctx context.Context, url, accountName string, email *model.Email, timeout time.Duration) error {
	payload := buildPayload(accountName, email)
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("send webhook: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

func buildPayload(accountName string, email *model.Email) EmailPayload {
	p := EmailPayload{
		ID:          email.MessageID,
		AccountName: accountName,
		Folder:      email.Folder,
		Subject:     email.Subject,
		Text:        email.TextBody,
		Body:        email.TextBody,
		HTML:        email.HTMLBody,
		Date:        email.Date.UTC().Format(time.RFC3339),
		SyncedAt:    email.SyncedAt.UTC().Format(time.RFC3339),
	}

	if email.From != nil {
		p.From = &FromPayload{
			Name:    email.From.Name,
			Address: email.From.Address,
		}
	}

	for _, addr := range email.To {
		p.To = append(p.To, addr.Address)
	}

	for _, a := range email.Attachments {
		p.Attachments = append(p.Attachments, AttachmentPayload{
			Filename:    a.Filename,
			ContentType: a.MIMEType,
			Size:        a.Size,
		})
	}

	if email.Flags != nil {
		p.Flags = email.Flags
	}

	return p
}
