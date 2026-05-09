# MailHooks

轻量级邮件同步与分发服务 — 通过 IMAP 协议同步多邮箱账户，将新邮件实时推送至 Webhook 端点。

## 核心特性

| 特性                    | 说明                                 |
| ----------------------- | ------------------------------------ |
| 📬 **多账户同步**       | 同时监控多个 IMAP 箱账户             |
| 🔄 **增量同步**         | 基于 UID 的增量拉取，避免重复处理    |
| 📝 **HTML 转 Markdown** | 自动将 HTML 邮件转换为 Markdown 格式 |
| 📤 **Webhook 分发**     | 将邮件 JSON 推送到任意 HTTP 端点     |
| 🔁 **队列重试**         | 失败自动重试，支持过期清理           |
| 🧦 **SOCKS5 代理**      | 支持 SOCKS5 代理连接 IMAP            |
| 🐳 **Docker 部署**      | 一键容器化部署                       |
| 💾 **SQLite WAL**       | WAL 模式 + 进程分离，并发安全        |

## 技术栈

- **Runtime**: Bun.js (TypeScript)
- **IMAP**: node-imap + mailparser
- **Database**: bun:sqlite (WAL 模式)
- **Markdown**: turndown (HTML → Markdown)
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
    password: "${GMAIL_PASSWORD}" # 支持环境变量
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

## 支持的邮箱列表

### 国际邮箱服务商

| 邮箱服务商 | IMAP 服务器 | 文件夹名称 | 特殊说明 |
|-----------|------------|-----------|---------|
| **Gmail** | `imap.gmail.com:993` | `INBOX` | 需启用 IMAP，使用应用专用密码 |
| **Outlook/Hotmail** | `imap-mail.outlook.com:993` | `INBOX` | 需启用 IMAP |
| **Yahoo Mail** | `imap.mail.yahoo.com:993` | `INBOX` | 需生成应用密码 |
| **iCloud** | `imap.mail.me.com:993` | `INBOX` | 需启用 IMAP，使用应用专用密码 |

### 国内邮箱服务商

| 邮箱服务商 | IMAP 服务器 | 文件夹名称 | 特殊说明 |
|-----------|------------|-----------|---------|
| **163 邮箱** | `imap.163.com:993` | `&UXZO1mWHTvZZOQ-` | ⚠️ 需使用 UTF-7 编码，需客户端授权码 |
| **126 邮箱** | `imap.126.com:993` | `&UXZO1mWHTvZZOQ-` | ⚠️ 需使用 UTF-7 编码，需客户端授权码 |
| **QQ 邮箱** | `imap.qq.com:993` | `INBOX` | 需启用 IMAP，使用授权码 |
| **阿里邮箱** | `imap.aliyun.com:993` | `INBOX` | 企业邮箱标准配置 |

### 文件夹名称说明

**国际邮箱**：直接使用英文文件夹名，如：
- `INBOX` - 收件箱
- `Sent` - 已发送
- `Drafts` - 草稿
- `Trash` - 已删除

**国内邮箱（163/126）**：需使用 IMAP UTF-7 编码格式：
- `&UXZO1mWHTvZZOQ-` - 收件箱（中文"收件箱"的 UTF-7 编码）
- `&g0l6O3Rul-` - 已发送
- `&DCyi4S4-` - 草稿
- `&i6KWBZ7-` - 已删除

> **注意**：由于运行时环境限制，中文文件夹名在 Bun.js 下会报错，必须使用 UTF-7 编码格式。

## Docker 部署

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
    build: .
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
  "id": "8464",
  "accountName": "gmail",
  "folder": "INBOX",
  "from": {
    "name": "Sender Name",
    "address": "sender@example.com"
  },
  "to": ["recipient@example.com"],
  "subject": "邮件主题",
  "text": "纯文本正文内容",
  "body": "## 标题\n\nMarkdown 格式正文...",
  "attachments": [
    {
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "size": 102400
    }
  ],
  "date": "2024-04-18T10:00:00Z",
  "syncedAt": "2024-04-18T10:05:00Z",
  "flags": ["\\Seen"]
}
```

**字段说明**：

- `text`: 邮件原始纯文本内容（可能为 null）
- `body`: HTML 转 Markdown 格式内容（无 HTML 时为空字符串）

## 架构设计

```
┌─────────────────┐
│   index.ts      │  主进程：spawn sync.ts + consumer.ts
│   (Main)        │
└─────────────────┘
        │
        ├──────────────────────┐
        │                      │
        ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│   sync.ts       │    │  consumer.ts    │
│  (Sync 进程)    │    │ (Consumer 进程) │
└─────────────────┘    └─────────────────┘
        │                      │
        ▼                      │
┌─────────────────┐            │
│  IMAP Accounts  │            │
│  (Gmail, etc.)  │            │
└─────────────────┘            │
        │                      │
        ▼                      │
┌─────────────────┐            │
│  EmailSyncer    │            │
│  (增量同步)      │            │
└─────────────────┘            │
        │                      │
        ▼                      │
┌─────────────────┐◀───────────┘
│   SQLite DB     │  WAL 模式 + busy_timeout=5000
│  (邮件 + 队列)   │  claimQueueItems() 原子操作
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ WebhookSender   │
│  (队列消费)      │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│  Webhook 端点   │
│  (Dify, 等)     │
└─────────────────┘
```

### 工作流程

1. **Main**: 主进程启动，spawn sync.ts 和 consumer.ts 为独立进程
2. **Sync Loop**: sync.ts 定时轮询 IMAP，增量拉取新邮件入队
3. **First Sync**: 首次同步记录 `uidnext - 1`，只同步启动后的新邮件
4. **Consumer Loop**: consumer.ts 定时消费队列，发送 Webhook
5. **Retry**: 失败项自动重试，超过过期时间标记为 expired
6. **Concurrency Safety**: SQLite WAL 模式 + 事务包裹入队操作

## 配置参数

| 参数            | 默认值 | 说明                            |
| --------------- | ------ | ------------------------------- |
| `sync_interval` | 300    | IMAP 同步间隔 (秒)              |
| `poll_interval` | 30     | Webhook 队列轮询间隔 (秒)       |
| `expires_hours` | 24     | 队列项过期时间 (小时)           |
| `cleanup_days`  | 7      | 清理已完成记录的天数            |
| `log_level`     | info   | 日志级别: debug/info/warn/error |
| `socks_proxy`   | -      | SOCKS5 代理地址                 |

## 目录结构

```sh
mailhooks/
├── src/
│   ├── index.ts          # 主入口，spawn sync.ts + consumer.ts
│   ├── sync.ts           # 同步进程入口
│   ├── consumer.ts       # 队列消费进程入口
│   ├── types.ts          # 类型定义
│   ├── config/
│   │   ├── loader.ts     # YAML 配置加载
│   │   ├── schema.ts     # 配置验证
│   │   └── types.ts      # 配置类型
│   ├── imap/
│   │   ├── client.ts     # IMAP 客户端封装
│   │   ├── parser.ts     # 邮件解析
│   │   └── syncer.ts     # 同步逻辑（首次同步 uidnext-1）
│   ├── storage/
│   │   ├── database.ts   # SQLite CRUD（WAL + claimQueueItems）
│   │   ├── migrations.ts # 数据库迁移（PRAGMA WAL）
│   │   └── types.ts      # 存储类型
│   ├── webhooks/
│   │   └── sender.ts     # Webhook 发送（新 Payload 格式）
│   └── utils/
│       ├── env.ts        # 环境变量
│       ├── logger.ts     # 日志封装
│       └── markdown.ts   # HTML → Markdown 转换
├── scripts/
│   └── send-test-email.ts # 测试邮件发送脚本
├── data/                 # SQLite 数据库目录
├── config.yaml           # 配置文件（在 .gitignore）
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
