package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/lipaysamart/mailhooks/internal/model"
)

var safeName = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func sanitizeName(name string) string {
	return safeName.ReplaceAllString(name, "_")
}

type Store struct {
	mu  sync.Mutex
	dir string
}

func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

func (s *Store) path(accountName string) string {
	name := sanitizeName(accountName)
	return filepath.Join(s.dir, name+".json")
}

func (s *Store) Load(accountName string) (*model.AccountState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path(accountName))
	if err != nil {
		if os.IsNotExist(err) {
			return &model.AccountState{}, nil
		}
		return nil, fmt.Errorf("read state: %w", err)
	}
	var state model.AccountState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parse state: %w", err)
	}
	return &state, nil
}

func (s *Store) Save(accountName string, state *model.AccountState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}
	p := s.path(accountName)
	tmpPath := p + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	return os.Rename(tmpPath, p)
}
