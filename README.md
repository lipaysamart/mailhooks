# mailhooks

**邮件 → Webhook 桥接服务** — 监听 IMAP 邮箱，将收到的邮件以 HTTP POST 转发到指定 URL。

```
┌──────────┐    IMAP     ┌──────────┐   enqueue    ┌──────────┐
│  邮箱    │ ──────────→ │  Poller  │ ──────────→  │  SQLite  │
│ (Gmail…) │             │ (解析+路由)│              │  (队列)   │
└──────────┘             └──────────┘              └────┬─────┘
                                                        │ dequeue
                                                        ▼
┌──────────┐   HTTP POST  ┌──────────┐   markDone   ┌──────────┐
│ Webhook  │ ←─────────── │  Worker  │ ←─────────── │  Queue   │
│  Server  │              │ (发送)     │              │  CRUD    │
└──────────┘              └──────────┘              └──────────┘
                                  ↑ retry (指数退避, max 5次)
```

## 特性

- **IMAP 轮询** — 定时拉取未读邮件，支持任意 IMAP 服务器
- **路由匹配** — 按收件人地址匹配不同 Webhook URL
- **持久化队列** — SQLite WAL 模式，崩溃恢复，不丢邮件
- **指数退避** — 投递失败自动重试 5 次（60s → 120s → 240s → 480s → 960s）
- **优雅关闭** — SIGINT/SIGTERM 信号处理，等待进行中的投递完成

## 快速开始

### 前置条件

- **Node.js 22.6+**（`--experimental-strip-types` 直接运行 TypeScript；Node 23.6+/24 起默认开启，无需 flag）
- **npm**

### 安装

```bash
git clone https://github.com/lipaysamart/mailhooks.git
cd mailhooks
npm install
```

### 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入真实配置：

```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "secure": true,
  "username": "you@gmail.com",
  "password": "your-app-password",
  "routes": [
    {
      "address": "alerts@yourdomain.com",
      "url": "https://hooks.example.com/alerts"
    }
  ]
}
```

> 💡 Gmail 用户需使用 [App Password](https://myaccount.google.com/apppasswords)（需先开启两步验证）。

### 启动

```bash
npm run dev
```

### Docker 部署

```bash
# 注意：config.json 中需设置 "dbPath": "./data/mailhooks.db" 以持久化队列数据
docker compose up -d
```

## 配置参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:----:|--------|------|
| `host` | `string` | ✅ | — | IMAP 服务器地址 |
| `port` | `number` | ✅ | — | IMAP 端口（通常 993） |
| `secure` | `boolean` | ✅ | — | 是否启用 TLS |
| `username` | `string` | ✅ | — | IMAP 用户名 |
| `password` | `string` | ✅ | — | IMAP 密码 |
| `routes` | `array` | ✅ | — | 路由规则数组（见下表） |
| `proxy` | `string` | — | — | SOCKS 代理（如 `socks5://127.0.0.1:1080`） |
| `mailbox` | `string` | — | `INBOX` | 监听文件夹 |
| `pollIntervalSeconds` | `number` | — | `60` | 轮询间隔（秒） |
| `dbPath` | `string` | — | `./mailhooks.db` | SQLite 数据库路径 |

**routes 子项：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `address` | `string` | 匹配的收件人地址（不区分大小写） |
| `url` | `string` | 转发目标 Webhook URL |

## Webhook 格式

邮件到达后，服务向匹配的 URL 发送 `POST` 请求：

```
POST /your-webhook HTTP/1.1
Content-Type: application/json
```

```json
{
  "from": "sender@example.com",
  "to": "alerts@yourdomain.com",
  "subject": "服务器告警",
  "text_body": "CPU 使用率超过 90%",
  "html_body": "<p>CPU 使用率超过 90%</p>",
  "received_at": "2025-01-15T08:30:00.000Z"
}
```

| 字段 | 说明 |
|------|------|
| `from` | 发件人地址 |
| `to` | 匹配到的收件人地址 |
| `subject` | 邮件主题 |
| `text_body` | 纯文本正文 |
| `html_body` | HTML 正文（无 HTML 时为空字符串 `""`） |
| `received_at` | 收件时间（ISO 8601） |

## 重试策略

投递失败后自动重试，采用指数退避：

| 尝试次数 | 延迟 | 累计等待 |
|:--------:|:----:|:--------:|
| 1（初始） | — | — |
| 2 | 60s | 1 分钟 |
| 3 | 120s | 3 分钟 |
| 4 | 240s | 7 分钟 |
| 5 | 480s | 15 分钟 |
| 6 | 960s | 31 分钟 |

超过 6 次尝试后标记为 `failed`，不再投递。

## 安全注意事项

- **Webhook 无鉴权**：当前版本的投递不包含签名或鉴权机制，任何拿到 URL 的人都可以伪造投递。请务必使用 HTTPS 的接收端，并不要把 Webhook URL 暴露给不可信方。如需来源验证，可在接收端校验 payload 中的 `from` 字段，或在部署层自行增加签名（历史版本曾内置 HMAC-SHA256 签名，后移除，可在 git 历史中查看实现）。
- **IMAP 凭据**：`config.json` 以明文存放 IMAP 密码。Gmail 等主流服务请使用 [App Password](https://myaccount.google.com/apppasswords)（需先开启两步验证），不要直接使用账号主密码；并注意 `config.json` 的文件权限（已加入 `.gitignore`，不会提交到仓库）。

## 开发

```bash
# 安装依赖
npm install

# 启动（watch 模式）
npm run dev:watch

# 测试
npm test

# 类型检查
npx tsc --noEmit

# 代码检查
npm run lint
npm run format
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 22+ (`--experimental-strip-types`) |
| 语言 | TypeScript 6 (strict, ESM) |
| IMAP | [imapflow](https://imapflow.com/) |
| 邮件解析 | [mailparser](https://nodemailer.com/extras/mailparser/) |
| 队列存储 | SQLite (better-sqlite3, WAL 模式) |
| 测试 | vitest |
| 代码规范 | biome |
| 容器化 | Docker (multi-stage build) |

## License

MIT
