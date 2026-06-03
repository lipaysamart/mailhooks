package queue

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/lipaysamart/mailhooks/internal/config"
	"github.com/lipaysamart/mailhooks/internal/model"
	"github.com/lipaysamart/mailhooks/internal/webhook"
	_ "modernc.org/sqlite"
	"go.uber.org/zap"
)

const schemaVersion = 1

type Queue struct {
	db     *sql.DB
	cfg    config.ResolvedQueueConfig
	logger *zap.Logger
	wg     sync.WaitGroup
	sem    chan struct{} // limits concurrent webhook sends
}

func New(cfg config.ResolvedQueueConfig, logger *zap.Logger) (*Queue, error) {
	dir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create queue db dir: %w", err)
	}

	db, err := sql.Open("sqlite", cfg.DBPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open queue db: %w", err)
	}
	db.SetMaxOpenConns(1)

	if err := migrateSchema(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate queue schema: %w", err)
	}

	// P0: recover stuck in_flight items from previous crash; reset retry_count to 0
	// so crash-recovered items get a clean retry slate
	if _, err := db.Exec(`UPDATE queue_items SET status = 'pending', retry_count = 0 WHERE status = 'in_flight'`); err != nil {
		db.Close()
		return nil, fmt.Errorf("recover in_flight items: %w", err)
	}

	// P1: clean expired items before consuming
	if _, err := db.Exec(`DELETE FROM queue_items WHERE expire_at < ? AND status != 'in_flight'`,
		time.Now().UTC().Format(time.RFC3339)); err != nil {
		db.Close()
		return nil, fmt.Errorf("cleanup expired items: %w", err)
	}

	return &Queue{db: db, cfg: cfg, logger: logger, sem: make(chan struct{}, 10)}, nil
}

func migrateSchema(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version >= schemaVersion {
		return nil
	}

	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS queue_items (
			id                 TEXT PRIMARY KEY,
			email_json         TEXT NOT NULL,
			retry_count        INTEGER NOT NULL DEFAULT 0,
			max_retries        INTEGER NOT NULL,
			next_retry_at      TEXT NOT NULL,
			expire_at          TEXT NOT NULL,
			webhook_url        TEXT NOT NULL,
			webhook_timeout_ms INTEGER NOT NULL,
			status             TEXT NOT NULL DEFAULT 'pending',
			created_at         TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`)
	if err != nil {
		return fmt.Errorf("create queue_items table: %w", err)
	}

	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_queue_status_retry ON queue_items(status, next_retry_at)`); err != nil {
		return fmt.Errorf("create idx_queue_status_retry: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_queue_expire ON queue_items(expire_at)`); err != nil {
		return fmt.Errorf("create idx_queue_expire: %w", err)
	}

	if _, err := db.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

func (q *Queue) Config() config.ResolvedQueueConfig {
	return q.cfg
}

func (q *Queue) Push(item *model.QueueItem) {
	emailJSON, err := json.Marshal(item.Email)
	if err != nil {
		q.logger.Error("marshal email for queue", zap.Error(err))
		return
	}

	result, err := q.db.Exec(
		`INSERT OR IGNORE INTO queue_items (id, email_json, retry_count, max_retries, next_retry_at, expire_at, webhook_url, webhook_timeout_ms, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
		item.ID,
		string(emailJSON),
		item.RetryCount,
		item.MaxRetries,
		item.NextRetryAt.UTC().Format(time.RFC3339),
		item.ExpireAt.UTC().Format(time.RFC3339),
		item.WebhookURL,
		item.WebhookTmout.Milliseconds(),
	)
	if err != nil {
		q.logger.Error("push to queue", zap.String("id", item.ID), zap.Error(err))
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		q.logger.Warn("duplicate item ignored", zap.String("id", item.ID))
		return
	}
	q.logger.Info("queued for delivery",
		zap.String("id", item.ID),
		zap.String("subject", item.Email.Subject),
	)
}

func (q *Queue) PopReady() []*model.QueueItem {
	now := time.Now().UTC().Format(time.RFC3339)

	rows, err := q.db.Query(
		`UPDATE queue_items SET status = 'in_flight'
		 WHERE status = 'pending' AND next_retry_at <= ?
		 RETURNING id, email_json, retry_count, max_retries, expire_at, webhook_url, webhook_timeout_ms`,
		now)
	if err != nil {
		q.logger.Error("pop ready items", zap.Error(err))
		return nil
	}
	defer rows.Close()

	var items []*model.QueueItem
	for rows.Next() {
		var (
			id               string
			emailJSON        string
			retryCount       int
			maxRetries       int
			expireAt         string
			webhookURL       string
			webhookTimeoutMs int64
		)
		if err := rows.Scan(&id, &emailJSON, &retryCount, &maxRetries, &expireAt, &webhookURL, &webhookTimeoutMs); err != nil {
			q.logger.Error("scan queue item", zap.Error(err))
			continue
		}

		var email model.Email
		if err := json.Unmarshal([]byte(emailJSON), &email); err != nil {
			q.logger.Error("unmarshal email from queue", zap.String("id", id), zap.Error(err))
			q.MarkDone(id)
			continue
		}

		expireAtTime, err := time.Parse(time.RFC3339, expireAt)
		if err != nil {
			q.logger.Error("parse expire_at", zap.String("id", id), zap.Error(err))
			q.MarkDone(id)
			continue
		}

		items = append(items, &model.QueueItem{
			ID:           id,
			Email:        &email,
			RetryCount:   retryCount,
			MaxRetries:   maxRetries,
			ExpireAt:     expireAtTime,
			WebhookURL:   webhookURL,
			WebhookTmout: time.Duration(webhookTimeoutMs) * time.Millisecond,
		})
	}
	if err := rows.Err(); err != nil {
		q.logger.Error("rows iteration error", zap.Error(err))
	}
	if len(items) > 0 {
		q.logger.Debug("popped ready items", zap.Int("count", len(items)))
	}
	return items
}

func (q *Queue) MarkDone(id string) {
	if _, err := q.db.Exec(`DELETE FROM queue_items WHERE id = ?`, id); err != nil {
		q.logger.Error("mark done", zap.String("id", id), zap.Error(err))
		return
	}
	q.logger.Debug("item delivered", zap.String("id", id))
}

func (q *Queue) MarkFailed(id string) {
	var retryCount, maxRetries int
	err := q.db.QueryRow(
		`SELECT retry_count, max_retries FROM queue_items WHERE status = 'in_flight' AND id = ?`,
		id).Scan(&retryCount, &maxRetries)
	if err != nil {
		if err != sql.ErrNoRows {
			q.logger.Error("mark failed: get item", zap.String("id", id), zap.Error(err))
		}
		return
	}

	retryCount++
	if retryCount > maxRetries {
		if _, err := q.db.Exec(`DELETE FROM queue_items WHERE id = ?`, id); err != nil {
			q.logger.Error("mark failed: delete exceeded item", zap.String("id", id), zap.Error(err))
		}
		return
	}

	backoff := 1 << (retryCount - 1)
	base := q.cfg.RetryDelay * time.Duration(backoff)
	jitter := time.Duration(float64(base) * (rand.Float64()*0.5 - 0.25))
	delay := base + jitter
	nextRetryAt := time.Now().Add(delay).UTC().Format(time.RFC3339)

	if _, err := q.db.Exec(
		`UPDATE queue_items SET retry_count = ?, next_retry_at = ?, status = 'pending' WHERE id = ?`,
		retryCount, nextRetryAt, id); err != nil {
		q.logger.Error("mark failed: update item", zap.String("id", id), zap.Error(err))
	}
}

func (q *Queue) CleanupExpired() {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := q.db.Exec(`DELETE FROM queue_items WHERE expire_at < ? AND status != 'in_flight'`, now)
	if err != nil {
		q.logger.Error("cleanup expired", zap.Error(err))
		return
	}
	n, _ := result.RowsAffected()
	if n > 0 {
		q.logger.Debug("expired items cleaned up", zap.Int64("count", n))
	}
}

func (q *Queue) Shutdown() {
	q.wg.Wait()
	close(q.sem)
	if err := q.db.Close(); err != nil {
		q.logger.Error("close queue db", zap.Error(err))
	}
}

func (q *Queue) Consume(ctx context.Context) {
	ticker := time.NewTicker(q.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			for _, item := range q.PopReady() {
				if item.Email == nil || item.WebhookURL == "" {
					continue
				}
				select {
				case q.sem <- struct{}{}:
				case <-ctx.Done():
					return
				}
				q.wg.Add(1)
				go func(item *model.QueueItem) {
					defer q.wg.Done()
					defer func() { <-q.sem }()
					err := webhook.Send(ctx, item.WebhookURL, item.Email.AccountName, item.Email, item.WebhookTmout)
					if err == nil {
						q.logger.Info("webhook delivered",
							zap.String("id", item.ID),
							zap.String("subject", item.Email.Subject),
						)
						q.MarkDone(item.ID)
					} else {
						q.logger.Warn("webhook failed",
							zap.String("id", item.ID),
							zap.Error(err),
							zap.Int("retry_count", item.RetryCount),
						)
						q.MarkFailed(item.ID)
					}
				}(item)
			}
		case <-ctx.Done():
			return
		}
	}
}

func (q *Queue) CleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(q.cfg.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			q.CleanupExpired()
		case <-ctx.Done():
			return
		}
	}
}
