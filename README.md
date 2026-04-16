# MailHooks

A lightweight email synchronization and distribution tool that syncs multiple IMAP accounts and pushes emails to webhooks based on configurable rules.

## Features

- **Multi-account support**: Sync multiple IMAP email accounts
- **Rule-based filtering**: Filter emails by sender, subject, folder
- **Webhook distribution**: Push emails to any HTTP endpoint
- **Template rendering**: Customize webhook payloads with Handlebars
- **Retry support**: Automatic retry for failed webhook calls
- **Docker ready**: Easy deployment with Docker

## Quick Start

### 1. Configuration

Copy the example config:

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` with your email accounts and webhook endpoints.

### 2. Environment Variables

Set required environment variables:

```bash
export GMAIL_PASSWORD="your-app-password"
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

### 3. Run

```bash
bun install
bun run start
```

### Docker Deployment

```bash
docker-compose up -d
```

## Configuration

### Accounts

```yaml
accounts:
  - name: "gmail"
    host: "imap.gmail.com"
    port: 993
    username: "email@gmail.com"
    password: "${GMAIL_PASSWORD}"  # Environment variable
    folders:
      - "INBOX"
```

### Webhooks

```yaml
webhooks:
  - name: "telegram"
    url: "https://api.telegram.org/bot${TOKEN}/sendMessage"
    method: "POST"
    headers:
      Content-Type: "application/json"
    template: |
      {
        "chat_id": "${CHAT_ID}",
        "text": "From: {{from_addr}}\nSubject: {{subject}}"
      }
```

### Rules

```yaml
rules:
  - name: "urgent"
    match:
      from: ["boss@company.com"]
      subject: ["urgent"]
    webhooks: ["telegram"]
    
  - name: "catch-all"
    match:
      catch_all: true
    webhooks: ["telegram"]
```

## Template Variables

| Variable | Description |
|----------|-------------|
| `{{id}}` | Email unique ID |
| `{{from_addr}}` | Sender address |
| `{{from_name}}` | Sender name |
| `{{subject}}` | Email subject |
| `{{text}}` | Plain text body |
| `{{html}}` | HTML body |
| `{{date}}` | Send date |
| `{{folder}}` | IMAP folder |

## License

MIT