package model

import "time"

type AccountState struct {
	UIDValidity uint32 `json:"uid_validity"`
	LastUID     uint32 `json:"last_uid"`
}

type Address struct {
	Name    string `json:"name,omitempty"`
	Address string `json:"address"`
}

type Email struct {
	MessageID    string       `json:"message_id"`
	AccountName  string       `json:"account_name"`
	Folder       string       `json:"folder"`
	Subject      string       `json:"subject"`
	From         *Address     `json:"from"`
	To           []Address    `json:"to"`
	Cc           []Address    `json:"cc"`
	Date         time.Time    `json:"date"`
	SyncedAt     time.Time    `json:"synced_at"`
	TextBody     string       `json:"text_body,omitempty"`
	HTMLBody     string       `json:"html_body,omitempty"`
	MarkdownBody string       `json:"markdown_body,omitempty"`
	Attachments  []Attachment `json:"attachments,omitempty"`
	Flags        []string     `json:"flags,omitempty"`
}

type Attachment struct {
	Filename string `json:"filename"`
	MIMEType string `json:"mime_type"`
	Size     int    `json:"size"`
	Content  string `json:"content,omitempty"`
}

type QueueItem struct {
	ID            string    `json:"id"`
	Email         *Email    `json:"email"`
	RetryCount    int       `json:"retry_count"`
	MaxRetries    int       `json:"max_retries"`
	NextRetryAt   time.Time `json:"next_retry_at"`
	ExpireAt      time.Time `json:"expire_at"`
	WebhookURL    string        `json:"-"`
	WebhookTmout  time.Duration `json:"-"`
}
