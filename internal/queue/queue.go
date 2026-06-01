package queue

import (
	"context"
	"math/rand"
	"sync"
	"time"

	"github.com/lipaysamart/mailhooks/internal/config"
	"github.com/lipaysamart/mailhooks/internal/model"
	"github.com/lipaysamart/mailhooks/internal/webhook"
	"go.uber.org/zap"
)

type Queue struct {
	mu       sync.Mutex
	pending  []*model.QueueItem
	inFlight map[string]*model.QueueItem
	cfg      config.ResolvedQueueConfig
	logger   *zap.Logger
	wg       sync.WaitGroup
}

func New(cfg config.ResolvedQueueConfig, logger *zap.Logger) *Queue {
	return &Queue{
		inFlight: make(map[string]*model.QueueItem),
		cfg:      cfg,
		logger:   logger,
	}
}

func (q *Queue) Config() config.ResolvedQueueConfig {
	return q.cfg
}

func (q *Queue) Push(item *model.QueueItem) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if _, exists := q.inFlight[item.ID]; exists {
		return
	}
	for _, existing := range q.pending {
		if existing.ID == item.ID {
			return
		}
	}
	q.pending = append(q.pending, item)
}

func (q *Queue) PopReady() []*model.QueueItem {
	q.mu.Lock()
	defer q.mu.Unlock()

	now := time.Now()
	var ready []*model.QueueItem
	var remaining []*model.QueueItem

	for _, item := range q.pending {
		if item.NextRetryAt.Before(now) || item.NextRetryAt.Equal(now) {
			ready = append(ready, item)
			q.inFlight[item.ID] = item
		} else {
			remaining = append(remaining, item)
		}
	}
	q.pending = remaining
	return ready
}

func (q *Queue) MarkDone(id string) {
	q.mu.Lock()
	delete(q.inFlight, id)
	q.mu.Unlock()
}

func (q *Queue) MarkFailed(id string) {
	q.mu.Lock()

	item, exists := q.inFlight[id]
	if !exists {
		q.mu.Unlock()
		return
	}
	delete(q.inFlight, id)

	item.RetryCount++
	if item.RetryCount > item.MaxRetries {
		q.mu.Unlock()
		return
	}

	backoff := 1 << (item.RetryCount - 1)
	base := q.cfg.RetryDelay * time.Duration(backoff)
	jitter := time.Duration(float64(base) * (rand.Float64()*0.5 - 0.25))
	delay := base + jitter
	item.NextRetryAt = time.Now().Add(delay)
	q.pending = append(q.pending, item)
	q.mu.Unlock()
}

func (q *Queue) CleanupExpired() {
	q.mu.Lock()
	defer q.mu.Unlock()

	now := time.Now()
	var remaining []*model.QueueItem
	for _, item := range q.pending {
		if item.ExpireAt.After(now) {
			remaining = append(remaining, item)
		}
	}
	q.pending = remaining
}

func (q *Queue) Shutdown() {
	q.wg.Wait()
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
				q.wg.Add(1)
				go func(item *model.QueueItem) {
					defer q.wg.Done()
					err := webhook.Send(ctx, item.WebhookURL, item.Email.AccountName, item.Email, item.WebhookTmout)
					if err == nil {
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
