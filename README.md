# mailhooks

[![CI](https://github.com/lipaysamart/mailhooks/actions/workflows/ci.yml/badge.svg)](https://github.com/lipaysamart/mailhooks/actions/workflows/ci.yml)

mailhooks 是一个 Go 编写的 IMAP 邮件到 Webhook 的桥接服务。它定期轮询 IMAP 邮箱的 INBOX 文件夹，将新邮件解析后通过 HTTP POST 投递到你配置的 Webhook URL，支持多账户、自动重试和进度持久化。

## 功能特性

- **多账户支持** — 同时监听多个 IMAP 邮箱，每个账户独立同步，互不干扰
- **增量同步** — 基于 IMAP UID 的增量拉取，仅获取上次同步之后的新邮件，避免重复处理
- **初始同步跳过** — 首次启动或 UIDValidity 变更时不触发 Webhook，防止历史邮件洪水
- **HTML → Markdown 转换** — 自动将 HTML 正文转为 Markdown，方便下游服务处理和展示
- **附件支持** — 提取附件元信息（文件名、MIME 类型、大小），可选择 Base64 编码附件内容
- **指数退避重试** — Webhook 投递失败后自动重试，采用指数退避 + 随机抖动（jitter），避免惊群效应
- **过期清理** — 超过配置时限的队列项自动丢弃，防止内存无限增长
- **进度持久化** — 基于 JSON 文件的状态存储，支持崩溃恢复（原子写入）
- **结构化日志** — 基于 [zap](https://github.com/uber-go/zap) 的高性能日志，支持 console / JSON 两种格式
- **静态二进制发布** — 通过 GoReleaser 构建 `CGO_ENABLED=0` 的纯静态二进制，支持 Linux / macOS（amd64 / arm64）

## 快速开始

### 1. 创建配置文件

复制示例配置并根据你的 IMAP 账户信息修改：

```bash
cp config.example.yaml mailhooks.yaml
```

编辑 `mailhooks.yaml`，至少填写一个账户的 `host`、`username`、`password`、`address` 和 `webhook_url`。

### 2. 运行

#### 使用 Go 安装（需要 Go 1.25+）

```bash
go install github.com/lipaysamart/mailhooks/cmd/mailhooks@latest
mailhooks -config mailhooks.yaml
```

#### 下载预编译二进制

从 [Releases](https://github.com/lipaysamart/mailhooks/releases) 页面下载对应平台的二进制文件：

```bash
# macOS arm64 (Apple Silicon)
tar xzf mailhooks_Darwin_aarch64.tar.gz
./mailhooks -config mailhooks.yaml

# Linux amd64
tar xzf mailhooks_Linux_x86_64.tar.gz
./mailhooks -config mailhooks.yaml
```

#### 从源码构建

```bash
git clone https://github.com/lipaysamart/mailhooks.git
cd mailhooks
go build -o mailhooks ./cmd/mailhooks/
./mailhooks -config mailhooks.yaml
```

### 3. 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-config` | `mailhooks.yaml` | 配置文件路径 |

## 配置说明

完整的配置文件格式如下：

```yaml
# 账户列表 — 每个账户独立同步
accounts:
  - name: "personal"                # 账户标识（用于状态文件名）
    host: "imap.example.com"        # IMAP 服务器地址
    port: 993                       # 端口（TLS 默认 993，非 TLS 默认 143）
    tls: true                       # 是否启用 TLS
    username: "user@example.com"    # 登录用户名
    password: "your-password"       # 登录密码
    address: "user@example.com"     # 邮件地址（用于 Webhook payload）
    webhook_url: "https://hooks.example.com/email"  # Webhook 接收 URL
    webhook_timeout: "30s"          # Webhook 请求超时（默认 30s）
    sync_interval: "60s"            # IMAP 同步间隔（默认 60s）
    include_attachment_content: false  # 是否在 payload 中包含附件 Base64 内容

# 队列配置 — 控制 Webhook 投递和重试行为
queue:
  poll_interval: "5s"      # 消费循环轮询间隔（默认 5s）
  max_retries: 3           # 最大重试次数（默认 3）
  retry_delay: "30s"       # 重试基础延迟 — 退避公式: delay × 2^(n-1) ± 25% jitter（默认 30s）
  expire_after: "24h"      # 队列项过期时间，超时自动丢弃（默认 24h）
  cleanup_interval: "5m"   # 过期清理间隔（默认 5m）

# 日志配置
log:
  level: "info"            # 日志级别: debug / info / warn / error（默认 info）
  format: "console"        # 日志格式: console（文本）/ json（默认 console，留空则 production JSON）
```

### 配置默认值速查

| 字段 | 默认值 |
|------|--------|
| `accounts[].port` | 993（TLS 时）/ 143（非 TLS 时） |
| `accounts[].webhook_timeout` | `30s` |
| `accounts[].sync_interval` | `60s` |
| `queue.poll_interval` | `5s` |
| `queue.max_retries` | `3` |
| `queue.retry_delay` | `30s` |
| `queue.expire_after` | `24h` |
| `queue.cleanup_interval` | `5m` |
| `log.level` | `info` |
| `log.format` | `console` |

## 架构概览

```text
cmd/mailhooks/main.go          — 程序入口，组装所有组件并启动 goroutine
internal/config/config.go      — YAML 配置解析、默认值填充、Duration 校验
internal/syncer/syncer.go      — IMAP 连接、UID 增量查询、MIME 解析、入队
internal/converter/converter.go — HTML → Markdown 转换（单行封装）
internal/queue/queue.go        — 内存队列、Push/PopReady/MarkDone/MarkFailed、指数退避
internal/webhook/webhook.go    — JSON payload 序列化、HTTP POST 发送
internal/state/state.go        — JSON 文件状态持久化（原子写入）
internal/model/model.go        — 领域数据结构定义
internal/logger/logger.go      — zap 日志初始化
```

### 启动流程

1. `LoadConfig` → 解析 YAML 配置文件
2. `logger.New` → 初始化结构化日志
3. `queue.New` → 创建内存队列
4. `state.NewStore("data")` → 创建文件状态存储
5. 遍历每个账户：
   - `syncer.New(...)` → 创建同步器
   - `go s.Run(ctx)` → 启动独立 goroutine 执行同步循环
6. `go q.Consume(ctx)` → 启动队列消费循环
7. `go q.CleanupLoop(ctx)` → 启动过期清理循环
8. 等待 `SIGINT` / `SIGTERM` → 优雅关闭

## 数据流

```text
┌───────────────┐     IMAP FETCH      ┌───────────┐
│  IMAP Server  │ ◄────────────────── │  Syncer   │  (per-account goroutine)
│  (INBOX)      │ ── raw MIME ──────► │           │
└───────────────┘                     └─────┬─────┘
                                            │ parseMIME()
                                            │ + HTML→Markdown
                                            ▼
                                     ┌─────────────┐
                                     │   Queue     │  (memory, mutex-protected)
                                     │   Push()    │
                                     └─────┬───────┘
                                           │ Consume() ticker (poll_interval)
                                           ▼
                                     ┌───────────┐
                                     │  Webhook  │  HTTP POST (JSON)
                                     │  Send()   │ ───────────────────► 目标 URL
                                     └───────────┘
                                           │
                                    success → MarkDone()
                                    fail    → MarkFailed() → 指数退避重入队
```

### 状态持久化

- 同步完成后，每个账户的 `UIDValidity` 和 `LastUID` 保存到 `data/{account_name}.json`
- 下次启动自动恢复，仅获取上次 UID 之后的新邮件
- 若 `UIDValidity` 发生变更（邮箱重建/迁移），自动触发全量重同步，且不触发 Webhook
- 文件写入采用 `tmp + rename` 原子方式，防止崩溃损坏状态文件

## Webhook Payload 格式

mailhooks 向配置的 `webhook_url` 发送 `POST` 请求，`Content-Type: application/json`，格式如下：

```json
{
  "id": "<message-id>",
  "accountName": "personal",
  "folder": "INBOX",
  "from": {
    "name": "张三",
    "address": "zhangsan@example.com"
  },
  "to": ["recipient@example.com"],
  "subject": "邮件主题",
  "text": "纯文本正文内容",
  "body": "**Markdown** 格式的正文内容",
  "date": "2026-06-01T12:00:00Z",
  "syncedAt": "2026-06-01T12:01:30Z",
  "flags": ["\\Seen"],
  "attachments": [
    {
      "filename": "report.pdf",
      "contentType": "application/pdf",
      "size": 1048576
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 邮件 Message-ID |
| `accountName` | string | 来源账户名称（对应配置中的 `name`） |
| `folder` | string | 邮箱文件夹，固定为 `"INBOX"` |
| `from` | object | 发件人信息（`name` + `address`） |
| `to` | string[] | 收件人地址列表 |
| `subject` | string | 邮件主题 |
| `text` | string | 纯文本正文（`text/plain` 部分） |
| `body` | string | Markdown 正文（由 `text/html` 转换而来；若邮件无 HTML 部分则不含此字段） |
| `date` | string | 邮件日期，RFC3339 格式 |
| `syncedAt` | string | 同步时间，RFC3339 格式 |
| `flags` | string[] | IMAP 标记（如 `\Seen`、`\Flagged`） |
| `attachments[]` | array | 附件列表（不含附件内容，除非配置了 `include_attachment_content: true`） |
| `attachments[].filename` | string | 附件文件名 |
| `attachments[].contentType` | string | MIME 类型 |
| `attachments[].size` | int | 文件大小（字节） |

## 许可证

本项目尚未添加开源许可证文件，留待后续补充。
