package webhook

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/lipaysamart/mailhooks/internal/model"
)

func TestBuildPayload(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	email := &model.Email{
		MessageID:   "<abc123@mail.example.com>",
		AccountName: "test-account",
		Folder:      "INBOX",
		Subject:     "Test Subject",
		From: &model.Address{
			Name:    "Sender Name",
			Address: "sender@example.com",
		},
		To: []model.Address{
			{Name: "Recipient One", Address: "one@example.com"},
			{Name: "Recipient Two", Address: "two@example.com"},
		},
		Date:     now,
		SyncedAt: now,
		TextBody: "This is the plain text body.",
		HTMLBody: "<html><body>Hello</body></html>",
		Flags:    []string{"\\Seen", "\\Flagged"},
		Attachments: []model.Attachment{
			{Filename: "report.pdf", MIMEType: "application/pdf", Size: 1048576},
		},
	}

	p := buildPayload("test-account", email)

	// Verify fields
	if p.ID != "<abc123@mail.example.com>" {
		t.Errorf("ID = %q", p.ID)
	}
	if p.AccountName != "test-account" {
		t.Errorf("AccountName = %q", p.AccountName)
	}
	if p.Folder != "INBOX" {
		t.Errorf("Folder = %q", p.Folder)
	}
	if p.Subject != "Test Subject" {
		t.Errorf("Subject = %q", p.Subject)
	}
	if p.Text != "This is the plain text body." {
		t.Errorf("Text = %q", p.Text)
	}
	if p.Body != "This is the plain text body." {
		t.Errorf("Body = %q", p.Body)
	}
	if p.HTML != "<html><body>Hello</body></html>" {
		t.Errorf("HTML = %q", p.HTML)
	}
	if p.From == nil {
		t.Fatal("From is nil")
	}
	if p.From.Name != "Sender Name" {
		t.Errorf("From.Name = %q", p.From.Name)
	}
	if p.From.Address != "sender@example.com" {
		t.Errorf("From.Address = %q", p.From.Address)
	}
	if len(p.To) != 2 {
		t.Fatalf("len(To) = %d, want 2", len(p.To))
	}
	if p.To[0] != "one@example.com" {
		t.Errorf("To[0] = %q", p.To[0])
	}
	if p.To[1] != "two@example.com" {
		t.Errorf("To[1] = %q", p.To[1])
	}
	if len(p.Attachments) != 1 {
		t.Fatalf("len(Attachments) = %d, want 1", len(p.Attachments))
	}
	if p.Attachments[0].Filename != "report.pdf" {
		t.Errorf("Attachment filename = %q", p.Attachments[0].Filename)
	}
	if p.Attachments[0].ContentType != "application/pdf" {
		t.Errorf("Attachment contentType = %q", p.Attachments[0].ContentType)
	}
	if p.Attachments[0].Size != 1048576 {
		t.Errorf("Attachment size = %d", p.Attachments[0].Size)
	}
	if p.Date != "2026-06-01T12:00:00Z" {
		t.Errorf("Date = %q", p.Date)
	}
	if p.SyncedAt != "2026-06-01T12:00:00Z" {
		t.Errorf("SyncedAt = %q", p.SyncedAt)
	}
	if len(p.Flags) != 2 {
		t.Fatalf("len(Flags) = %d, want 2", len(p.Flags))
	}
	if p.Flags[0] != "\\Seen" || p.Flags[1] != "\\Flagged" {
		t.Errorf("Flags = %v", p.Flags)
	}
}

func TestBuildPayloadJSON(t *testing.T) {
	email := &model.Email{
		MessageID: "<test@example.com>",
		From:      &model.Address{Name: "Test", Address: "test@example.com"},
		Date:      time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC),
		SyncedAt:  time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC),
		HTMLBody:  "<p>hi</p>",
		Flags:     []string{"\\Seen"},
	}

	p := buildPayload("test", email)
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}

	// Verify all expected fields exist in JSON
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}

	// Required fields
	required := []string{"id", "accountName", "folder", "from", "to", "subject", "text", "body", "html", "date", "syncedAt"}
	for _, f := range required {
		if _, ok := result[f]; !ok {
			t.Errorf("missing field %q in payload", f)
		}
	}

	// body should equal text (both set to TextBody)
	if result["body"] != result["text"] {
		t.Errorf("body = %v, text = %v, want equal", result["body"], result["text"])
	}

	// html should be present when set
	if result["html"] != "<p>hi</p>" {
		t.Errorf("html = %v, want <p>hi</p>", result["html"])
	}
}

func TestBuildPayloadNilFrom(t *testing.T) {
	email := &model.Email{
		Date:     time.Now(),
		SyncedAt: time.Now(),
	}
	p := buildPayload("test", email)

	if p.From != nil {
		t.Error("From should be nil when email.From is nil")
	}
}

func TestBuildPayloadEmptyFlags(t *testing.T) {
	email := &model.Email{
		Date:     time.Now(),
		SyncedAt: time.Now(),
		Flags:    nil,
	}
	p := buildPayload("test", email)

	data, _ := json.Marshal(p)
	var result map[string]interface{}
	json.Unmarshal(data, &result)

	// flags should be omitted when empty/nil
	if _, ok := result["flags"]; ok {
		t.Error("flags should be omitted when empty")
	}
}
