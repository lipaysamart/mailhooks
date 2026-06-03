package state

import (
	"os"
	"testing"

	"github.com/lipaysamart/mailhooks/internal/model"
)

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"personal", "personal"},
		{"my-account_123", "my-account_123"},
		{"name with spaces", "name_with_spaces"},
		{"evil/../path", "evil____path"},
		{"中文名", "___"},
	}

	for _, tt := range tests {
		got := sanitizeName(tt.input)
		if got != tt.expected {
			t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state := &model.AccountState{
		UIDValidity: 42,
		LastUID:     100,
	}

	if err := store.Save("test-account", state); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Verify file exists
	path := store.path("test-account")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatalf("state file not created at %s", path)
	}

	loaded, err := store.Load("test-account")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if loaded.UIDValidity != 42 {
		t.Errorf("UIDValidity = %d, want 42", loaded.UIDValidity)
	}
	if loaded.LastUID != 100 {
		t.Errorf("LastUID = %d, want 100", loaded.LastUID)
	}
}

func TestLoadNonExistent(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state, err := store.Load("nonexistent")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if state.UIDValidity != 0 || state.LastUID != 0 {
		t.Errorf("expected zero-value state, got %+v", state)
	}
}

func TestAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state := &model.AccountState{UIDValidity: 1, LastUID: 10}
	if err := store.Save("account", state); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Verify no .tmp file left behind
	path := store.path("account")
	tmpPath := path + ".tmp"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error(".tmp file should not exist after atomic write")
	}
}

func TestOverwrite(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// First save
	s1 := &model.AccountState{UIDValidity: 1, LastUID: 10}
	store.Save("account", s1)

	// Overwrite
	s2 := &model.AccountState{UIDValidity: 2, LastUID: 20}
	store.Save("account", s2)

	loaded, _ := store.Load("account")
	if loaded.UIDValidity != 2 || loaded.LastUID != 20 {
		t.Errorf("got %+v, want UIDValidity=2 LastUID=20", loaded)
	}
}
