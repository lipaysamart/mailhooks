# mailhooks

> 邮件转 Webhook 桥接服务

## 功能概览

- 通过 IMAP 轮询邮箱，按收件人地址匹配路由规则，将邮件转发到对应的 Webhook URL
- 请求体为 JSON 格式的邮件摘要，附带 HMAC-SHA256 签名
- SQLite 持久化队列，支持指数退避重试
- 优雅关闭（SIGINT / SIGTERM）

## 快速开始

### 前置条件

- Node.js 22+（使用 `--experimental-strip-types` 直接运行 TS）
- bun 包管理器

### 本地开发

```bash
bun install
cp config.example.json config.json
# 编辑 config.json，填入真实 IMAP 和 Webhook 配置
bun run dev
```

### 使用 Docker

```bash
# 准备 config.json（注意：dbPath 需设为 ./data/mailhooks.db 以持久化队列数据）
docker compose up -d
```

## 配置说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `host` | `string` | 是 | — | IMAP 服务器地址 |
| `port` | `number` | 是 | — | IMAP 端口 |
| `secure` | `boolean` | 是 | — | 是否启用 TLS |
| `proxy` | `string` | 否 | — | SOCKS 代理地址 |
| `username` | `string` | 是 | — | IMAP 登录用户名 |
| `password` | `string` | 是 | — | IMAP 登录密码 |
| `signingSecret` | `string` | 是 | — | Webhook 请求 HMAC 签名密钥 |
| `mailbox` | `string` | 否 | `INBOX` | 监听的邮箱文件夹 |
| `pollIntervalSeconds` | `number` | 否 | `60` | 轮询间隔（秒） |
| `dbPath` | `string` | 否 | `./mailhooks.db` | SQLite 数据库路径 |
| `routes` | `array` | 是 | — | 路由规则数组 |

**routes 子项：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `address` | `string` | 匹配的收件人地址（小写化比较） |
| `url` | `string` | 转发目标 Webhook URL |

## Webhook 格式

收到邮件后，服务会向匹配的 Webhook URL 发送 HTTP POST 请求：

- **Method**: `POST`
- **Content-Type**: `application/json`
- **Header**: `X-Mailhooks-Signature: sha256=<hex>`
- **Timeout**: 10 秒

**请求体结构**（`EmailSummary`）：

```json
{
  "from": "sender@example.com",
  "to": "alerts@example.com",
  "subject": "邮件主题",
  "text_body": "纯文本内容",
  "html_body": "<p>HTML 内容</p>",
  "received_at": "2025-01-01T00:00:00.000Z"
}
```

## 签名验证

签名使用 HMAC-SHA256 算法，对请求体原始字节计算，结果以 `sha256=<hex>` 格式放入 `X-Mailhooks-Signature` header。

**Node.js 验证示例：**

```js
import { createHmac } from "node:crypto";

function verify(body, signature, secret) {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf-8");
  const expected = "sha256=" + hmac.digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  );
}
```

## 重试策略

- 每次投递失败后自动重试，最多 **5 次**（共 6 次投递尝试）
- 使用指数退避延迟：60s → 120s → 240s → 480s
- 超过重试上限后标记为 `failed`，不再投递

## 已知限制

- 单 worker 串行消费，无并发投递
- 路由仅精确匹配 `To` header 地址（小写化后比较），不支持通配符或 `BCC` / `Delivered-To`
- 无邮件去重机制（enqueue 与标记已读之间的崩溃可能导致重复投递）
- 每次轮询新建 IMAP 连接，无连接复用或 IDLE 推送

## 开发

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动服务 |
| `bun run dev:watch` | 启动服务（watch 模式） |
| `bun run test` | 运行测试 |
| `bunx tsc --noEmit` | 类型检查 |