# mailhooks

[![CI](https://github.com/lipaysamart/mailhooks/actions/workflows/ci.yml/badge.svg)](https://github.com/lipaysamart/mailhooks/actions/workflows/ci.yml)

mailhooks 把 IMAP 邮箱的新邮件转到 Webhook。定时拉取 INBOX，解析后 POST 到你指定的 URL。多账户、自动重试、断点续传都内置了。

## 能做什么

- **多账户** — 同时监听多个邮箱，各跑各的，互不阻塞
- **增量同步** — 只拉上次之后的新邮件，靠 IMAP UID 判断，不会重复处理
- **初始同步跳过** — 首次启动或 UIDValidity 变了不推 Webhook，免得历史邮件轰炸
- **HTML → Markdown** — 自动把 HTML 正文转成 Markdown
- **附件** — 提取文件名、MIME 类型、大小，可以选择把内容 Base64 编码塞进去
- **指数退避重试** — Webhook 失败自动重试，指数退避 + 随机抖动，不会扎堆重试
- **过期清理** — 超时的队列项自动丢掉，内存不会无限涨
- **进度持久化** — 同步进度存 JSON 文件，崩了重启接着来（原子写入）
- **结构化日志** — 用 [zap](https://github.com/uber-go/zap)，console 和 JSON 两种格式
- **静态二进制** — GoReleaser 打 `CGO_ENABLED=0` 的纯静态包，Linux / macOS 都行（amd64 / arm64）

## 快速开始

### 1. 准备配置文件

把示例配置复制一份，填上你的 IMAP 账户信息：

```bash
cp config.example.yaml mailhooks.yaml
```

编辑 `mailhooks.yaml`，至少填一个账户的 `host`、`username`、`password`、`address` 和 `webhook_url`。

### 2. 运行

#### 用 Go 安装（需要 Go 1.25+）

```bash
go install github.com/lipaysamart/mailhooks/cmd/mailhooks@latest
mailhooks -config mailhooks.yaml
```

#### 下载预编译二进制

从 [Releases](https://github.com/lipaysamart/mailhooks/releases) 页面下载：

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

### 3. 用 Docker 跑

```bash
# 构建镜像
docker compose build

# 启动（前台）
docker compose up

# 启动（后台）
docker compose up -d

# 查看日志
docker compose logs -f
```

### 4. 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-config` | `mailhooks.yaml` | 配置文件路径 |

## 配置说明

完整的配置文件：

```yaml
# 账户列表，每个账户独立同步
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

# 队列配置，控制投递和重试
queue:
  poll_interval: "5s"      # 消费循环轮询间隔（默认 5s）
  max_retries: 3           # 最大重试次数（默认 3）
  retry_delay: "30s"       # 重试基础延迟 — 退避公式: delay × 2^(n-1) ± 25% jitter（默认 30s）
  expire_after: "24h"      # 队列项过期时间，超时丢弃（默认 24h）
  cleanup_interval: "5m"   # 过期清理间隔（默认 5m）

# 日志
log:
  level: "info"            # debug / info / warn / error（默认 info）
  format: "console"        # console（文本）/ json（默认 console，留空则 production JSON）
```

### 默认值速查

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

## 代码结构

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

1. `LoadConfig` → 解析 YAML
2. `logger.New` → 初始化日志
3. `queue.New` → 创建内存队列
4. `state.NewStore("data")` → 创建状态存储
5. 遍历每个账户：
   - `syncer.New(...)` → 创建同步器
   - `go s.Run(ctx)` → 启动同步循环
6. `go q.Consume(ctx)` → 启动队列消费
7. `go q.CleanupLoop(ctx)` → 启动过期清理
8. 等待 `SIGINT` / `SIGTERM` → 关闭

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

- 每次同步完，每个账户的 `UIDValidity` 和 `LastUID` 存到 `data/{account_name}.json`
- 重启后自动接着来，只拉上次 UID 之后的新邮件
- UIDValidity 变了（邮箱重建/迁移），会全量重同步但不推 Webhook
- 文件写入用 `tmp + rename` 原子方式，不会写出半截损坏文件

## Webhook Payload

往 `webhook_url` 发 `POST`，`Content-Type: application/json`：

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
| `id` | string | Message-ID |
| `accountName` | string | 来源账户名，对应配置里的 `name` |
| `folder` | string | 邮箱文件夹，固定 `"INBOX"` |
| `from` | object | 发件人（`name` + `address`） |
| `to` | string[] | 收件人地址列表 |
| `subject` | string | 邮件主题 |
| `text` | string | 纯文本正文 |
| `body` | string | Markdown 正文，由 HTML 部分转换；没有 HTML 的话这个字段就没有 |
| `date` | string | 邮件日期，RFC3339 |
| `syncedAt` | string | 同步时间，RFC3339 |
| `flags` | string[] | IMAP 标记（如 `\Seen`、`\Flagged`） |
| `attachments[]` | array | 附件列表（不含内容，除非开了 `include_attachment_content`） |
| `attachments[].filename` | string | 文件名 |
| `attachments[].contentType` | string | MIME 类型 |
| `attachments[].size` | int | 文件大小（字节） |

## 许可证

[MIT](LICENSE)
