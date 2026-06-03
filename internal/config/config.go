package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Accounts []AccountConfig `yaml:"accounts"`
	Queue    QueueConfig     `yaml:"queue"`
	Log      LogConfig       `yaml:"log"`
}

type AccountConfig struct {
	Name                     string `yaml:"name"`
	Host                     string `yaml:"host"`
	Port                     int    `yaml:"port"`
	TLS                      bool   `yaml:"tls"`
	Username                 string `yaml:"username"`
	Password                 string `yaml:"password"`
	WebhookURL               string `yaml:"webhook_url"`
	WebhookTimeout           string `yaml:"webhook_timeout"`
	SyncInterval             string `yaml:"sync_interval"`
	IncludeAttachmentContent bool   `yaml:"include_attachment_content"`
}

type QueueConfig struct {
	PollInterval    string `yaml:"poll_interval"`
	MaxRetries      int    `yaml:"max_retries"`
	RetryDelay      string `yaml:"retry_delay"`
	ExpireAfter     string `yaml:"expire_after"`
	CleanupInterval string `yaml:"cleanup_interval"`
	DBPath          string `yaml:"db_path"`
}

type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

type ResolvedAccountConfig struct {
	Name                     string
	Host                     string
	Port                     int
	TLS                      bool
	Username                 string
	Password                 string
	WebhookURL               string
	WebhookTimeout           time.Duration
	SyncInterval             time.Duration
	IncludeAttachmentContent bool
}

type ResolvedQueueConfig struct {
	PollInterval    time.Duration
	MaxRetries      int
	RetryDelay      time.Duration
	ExpireAfter     time.Duration
	CleanupInterval time.Duration
	DBPath          string
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "console"
	}
	if cfg.Queue.MaxRetries == 0 {
		cfg.Queue.MaxRetries = 3
	}
	if cfg.Queue.PollInterval == "" {
		cfg.Queue.PollInterval = "5s"
	}
	if cfg.Queue.RetryDelay == "" {
		cfg.Queue.RetryDelay = "30s"
	}
	if cfg.Queue.ExpireAfter == "" {
		cfg.Queue.ExpireAfter = "24h"
	}
	if cfg.Queue.CleanupInterval == "" {
		cfg.Queue.CleanupInterval = "5m"
	}
	if cfg.Queue.DBPath == "" {
		cfg.Queue.DBPath = "data/queue.db"
	}
	for i := range cfg.Accounts {
		if cfg.Accounts[i].Port == 0 {
			if cfg.Accounts[i].TLS {
				cfg.Accounts[i].Port = 993
			} else {
				cfg.Accounts[i].Port = 143
			}
		}
		if cfg.Accounts[i].WebhookTimeout == "" {
			cfg.Accounts[i].WebhookTimeout = "30s"
		}
		if cfg.Accounts[i].SyncInterval == "" {
			cfg.Accounts[i].SyncInterval = "60s"
		}
	}
	return &cfg, nil
}

func (c *AccountConfig) Resolve() (ResolvedAccountConfig, error) {
	var r ResolvedAccountConfig

	if c.Name == "" {
		return r, fmt.Errorf("account name is required")
	}
	if c.Host == "" {
		return r, fmt.Errorf("account %q: host is required", c.Name)
	}
	if c.Username == "" {
		return r, fmt.Errorf("account %q: username is required", c.Name)
	}
	if c.Password == "" {
		return r, fmt.Errorf("account %q: password is required", c.Name)
	}
	if c.WebhookURL == "" {
		return r, fmt.Errorf("account %q: webhook_url is required", c.Name)
	}

	r.Name = c.Name
	r.Host = c.Host
	r.Port = c.Port
	r.TLS = c.TLS
	r.Username = c.Username
	r.Password = c.Password
	r.WebhookURL = c.WebhookURL
	r.IncludeAttachmentContent = c.IncludeAttachmentContent

	var err error
	r.WebhookTimeout, err = time.ParseDuration(c.WebhookTimeout)
	if err != nil {
		return r, fmt.Errorf("parse webhook_timeout: %w", err)
	}
	r.SyncInterval, err = time.ParseDuration(c.SyncInterval)
	if err != nil {
		return r, fmt.Errorf("parse sync_interval: %w", err)
	}
	return r, nil
}

func (c *QueueConfig) Resolve() (ResolvedQueueConfig, error) {
	var r ResolvedQueueConfig
	r.MaxRetries = c.MaxRetries
	r.DBPath = c.DBPath
	var err error
	r.PollInterval, err = time.ParseDuration(c.PollInterval)
	if err != nil {
		return r, fmt.Errorf("parse poll_interval: %w", err)
	}
	r.RetryDelay, err = time.ParseDuration(c.RetryDelay)
	if err != nil {
		return r, fmt.Errorf("parse retry_delay: %w", err)
	}
	r.ExpireAfter, err = time.ParseDuration(c.ExpireAfter)
	if err != nil {
		return r, fmt.Errorf("parse expire_after: %w", err)
	}
	r.CleanupInterval, err = time.ParseDuration(c.CleanupInterval)
	if err != nil {
		return r, fmt.Errorf("parse cleanup_interval: %w", err)
	}
	return r, nil
}
