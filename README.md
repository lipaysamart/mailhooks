# MailHooks

轻量级邮件同步与分发服务 — 通过 IMAP 协议同步多邮箱账户，将新邮件实时推送至 Webhook 端点。

## 核心特性

| 特性 | 说明 |
|------|------|
| 📬 **多账户同步** | 同时监控多个 IMAP 邮箱账户 |
| 🔄 **增量同步** | 基于 UID 的增量拉取，避免重复处理 |
| 📤 **Webhook 分发** | 将邮件 JSON 推送到任意 HTTP 端点 |
| 🔁 **队列重试** | 失败自动重试，支持过期清理 |
| 🧦 **SOCKS5 代理** | 支持 SOCKS5 代理连接 IMAP |
| 🐳 **Docker 部署** | 一键容器化部署 |
| 💾 **SQLite 存储** | 本地持久化，无需额外数据库依赖 |

## 技术栈

- **Runtime**: Bun.js (TypeScript)
- **IMAP**: node-imap + mailparser
- **Database**: bun:sqlite
- **Logging**: pino
- **Config**: YAML

## 快速开始

### 1. 配置文件

复制示例配置：

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`：

```yaml
# 同步间隔 (秒)
sync_interval: 300

# Webhook 轮询间隔 (秒)
poll_interval: 30

# 队列项过期时间 (小时)
expires_hours: 24

# 邮件账户
accounts:
  - name: "gmail"
    host: "imap.gmail.com"
    port: 993
    username: "your-email@gmail.com"
    password: "${GMAIL_PASSWORD}"  # 支持环境变量
    folders:
      - "INBOX"

# Webhook 端点
webhook:
  url: "https://your-webhook-url.com/endpoint"
  method: "POST"
  headers:
    Content-Type: "application/json"
  timeout: 10
```

### 2. 环境变量

```bash
export GMAIL_PASSWORD="your-app-password"
export OUTLOOK_PASSWORD="your-password"
# 可选：SOCKS5 代理
export SOCKS_PROXY="socks5://127.0.0.1:7898"
```

### 3. 运行

```bash
# 安装依赖
bun install

# 开发模式 (热重载)
bun run dev

# 生产运行
bun run start

# 构建
bun run build
```

## Docker 部署

### 从 Docker Hub 拉取

```bash
# 拉取指定版本
docker pull lipaysam/mailhooks:0.1.2

# 或拉取最新版本
docker pull lipaysam/mailhooks:latest
```

### 运行容器

```bash
docker run -d \
  --name mailhooks \
  --restart always \
  -v ./config:/app/config \
  -v ./data:/app/data \
  -e LOG_LEVEL=info \
  -e SYNC_INTERVAL=300 \
  lipaysam/mailhooks:latest
```

### 使用 Docker Compose

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker logs -f mailhooks
```

### Docker Compose 配置

```yaml
services:
  mailhooks:
    image: lipaysam/mailhooks:latest
    restart: unless-stopped
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    environment:
      - LOG_LEVEL=info
      - SYNC_INTERVAL=300
```

## Webhook Payload

邮件推送的 JSON 格式：

```json
{
  "subject": "邮件主题",
  "from": "发件人名称",
  "context": {
    "text": "邮件正文 (截断至 500 字)",
    "date": "2024-04-18T10:00:00Z",
    "html": "<p>HTML 正文</p>",
    "attachments": [
      {
        "filename": "document.pdf",
        "contentType": "application/pdf",
        "size": 102400
      }
    ]
  }
}
```

## 架构设计

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  IMAP Accounts  │────▶│  EmailSyncer    │────▶│    SQLite DB    │
│  (Gmail, etc.)  │     │  (增量同步)      │     │  (邮件 + 队列)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                        ┌─────────────────┐             │
                        │ WebhookSender   │◀────────────┘
                        │  (队列消费)      │
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │  Webhook 端点   │
                        │  (Telegram,等)  │
                        └─────────────────┘
```

### 工作流程

1. **Sync Loop**: 定时轮询 IMAP 账户，增量拉取新邮件
2. **Queue**: 新邮件存入 SQLite，同时加入 Webhook 发送队列
3. **Consumer**: 定时消费队列，发送 Webhook
4. **Retry**: 失败项自动重试，超过过期时间标记为 expired
5. **Cleanup**: 定期清理已完成/过期的队列记录

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `sync_interval` | 300 | IMAP 同步间隔 (秒) |
| `poll_interval` | 30 | Webhook 队列轮询间隔 (秒) |
| `expires_hours` | 24 | 队列项过期时间 (小时) |
| `cleanup_days` | 7 | 清理已完成记录的天数 |
| `log_level` | info | 日志级别: debug/info/warn/error |
| `socks_proxy` | - | SOCKS5 代理地址 |

## 目录结构

```
mailhooks/
├── src/
│   ├── index.ts          # 入口，协调各模块
│   ├── types.ts          # 类型定义
│   ├── config/
│   │   ├── loader.ts     # YAML 配置加载
│   │   ├── schema.ts     # 配置验证
│   │   └── types.ts      # 配置类型
│   ├── imap/
│   │   ├── client.ts     # IMAP 客户端封装
│   │   ├── parser.ts     # 邮件解析
│   │   └── syncer.ts     # 同步逻辑
│   ├── storage/
│   │   ├── database.ts   # SQLite CRUD
│   │   ├── migrations.ts # 数据库迁移
│   │   └── types.ts      # 存储类型
│   └── webhooks/
│   │   ├── sender.ts     # Webhook 发送
│   │   └── types.ts      # Webhook 类型
│   └── utils/
│       ├── env.ts        # 环境变量
│       └── logger.ts     # 日志封装
├── data/                 # SQLite 数据库目录
├── config.yaml           # 配置文件
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 使用场景

- **Telegram 通知**: 将邮件推送到 Telegram Bot
- **Slack/Discord**: 实时邮件提醒
- **自定义处理**: 推送到自建 API 进行二次处理
- **邮件归档**: 同步并存储邮件到本地数据库

## License

MIT