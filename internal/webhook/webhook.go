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

type Payload struct {
	Event     string      `json:"event"`
	Account   AccountInfo `json:"account"`
	Email     *model.Email `json:"email"`
	Timestamp time.Time   `json:"timestamp"`
}

type AccountInfo struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

func Send(ctx context.Context, url, accountName, accountAddress string, email *model.Email, timeout time.Duration) error {
	payload := Payload{
		Event: "email.received",
		Account: AccountInfo{
			Name:    accountName,
			Address: accountAddress,
		},
		Email:     email,
		Timestamp: time.Now().UTC(),
	}
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
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}
