# MailHooks 设计文档

## ABOUTME: MailHooks 邮件同步与分发系统设计规范
## ABOUTME: 定义架构、数据结构、配置格式和核心流程

## 概述

MailHooks 是一个轻量级的邮件同步与分发工具，支持多邮箱账户聚合同步，并通过 Webhook 方式将邮件内容实时推送到任意目标平台。

### 核心特性

- 多邮箱账户管理（IMAP 协议）
- 基于规则的邮件过滤
- 通用 Webhook 推送
- SQLite 本地存储
- Docker 容器化部署
- 配置文件驱动

### 技术栈

- **运行时**: Bun + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **IMAP 客户端**: node-imap + mailparser
- **模板引擎**: Handlebars
- **日志**: Pino
- **部署**: Docker

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    MailHooks Service                    │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ IMAP Syncer  │───▶│ Rule Engine  │───▶│  Webhook  │ │
│  │  (轮询监听)   │    │  (规则匹配)   │    │  Sender   │ │
│  └──────────────┘    └──────────────┘    └───────────┘ │
│         │                   │                  │        │
│         ▼                   ▼                  ▼        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              SQLite (邮件存储 + 状态)              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Config Manager (YAML 配置)              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 职责 |
|------|------|
| Config Manager | 加载和验证 YAML 配置文件 |
| IMAP Syncer | 连接邮箱服务器，轮询新邮件 |
| Rule Engine | 根据规则过滤邮件，决定推送目标 |
| Webhook Sender | 发送 HTTP 请求到目标平台，处理重试 |
| Storage | SQLite 数据持久化，邮件和状态管理 |

---

## 项目结构

```
mailhooks/
├── src/
│   ├── index.ts              # 入口文件
│   ├── config/
│   │   ├── loader.ts         # 配置加载器
│   │   └── schema.ts         # 配置验证
│   ├── imap/
│   │   ├── client.ts         # IMAP 客户端封装
│   │   ├── syncer.ts         # 邮件同步器
│   │   └── types.ts          # IMAP 相关类型
│   ├── rules/
│   │   ├── engine.ts         # 规则引擎
│   │   ├── matcher.ts        # 匹配器（from/subject等）
│   │   └── types.ts          # 规则相关类型
│   ├── webhooks/
│   │   ├── sender.ts         # Webhook 发送器
│   │   ├── retry.ts          # 重试逻辑
│   │   └── types.ts          # Webhook 相关类型
│   ├── storage/
│   │   ├── database.ts       # SQLite 数据库操作
│   │   ├── migrations.ts     # 数据库迁移
│   │   └── types.ts          # 存储相关类型
│   ├── utils/
│   │   ├── logger.ts         # 日志工具
│   │   └── template.ts       # 模板渲染
│   └── types.ts              # 全局类型定义
├── config.example.yaml        # 示例配置文件
├── Dockerfile                 # Docker 构建文件
├── package.json
├── tsconfig.json
└── README.md
```

---

## 数据库设计

### 表结构

#### emails 表

存储邮件元数据和内容。

```sql
CREATE TABLE emails (
  id TEXT PRIMARY KEY,           -- 邮件 UID
  account_name TEXT NOT NULL,    -- 账户名称
  folder TEXT NOT NULL,          -- 文件夹
  from_addr TEXT NOT NULL,       -- 发件人地址
  from_name TEXT,                -- 发件人名称
  to_addrs TEXT NOT NULL,        -- 收件人列表 (JSON)
  subject TEXT,                  -- 主题
  text TEXT,                     -- 纯文本内容
  html TEXT,                     -- HTML 内容
  date TEXT NOT NULL,            -- 发送时间 (ISO 8601)
  flags TEXT,                    -- 标签/标记 (JSON)
  attachments TEXT,              -- 附件信息 (JSON)
  synced_at TEXT NOT NULL,       -- 同步时间 (ISO 8601)
  UNIQUE(account_name, folder, id)
);

CREATE INDEX idx_emails_account ON emails(account_name);
CREATE INDEX idx_emails_date ON emails(date);
```

#### webhook_logs 表

记录 Webhook 调用历史。

```sql
CREATE TABLE webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL,        -- 邮件 ID
  webhook_name TEXT NOT NULL,    -- Webhook 名称
  status TEXT NOT NULL,          -- pending/success/failed
  attempts INTEGER DEFAULT 0,    -- 尝试次数
  last_error TEXT,               -- 最后错误信息
  created_at TEXT NOT NULL,      -- 创建时间 (ISO 8601)
  updated_at TEXT NOT NULL       -- 更新时间 (ISO 8601)
);

CREATE INDEX idx_webhook_logs_email ON webhook_logs(email_id);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
```

#### sync_state 表

记录每个账户的同步进度。

```sql
CREATE TABLE sync_state (
  account_name TEXT NOT NULL,
  folder TEXT NOT NULL,
  last_uid TEXT NOT NULL,        -- 最后同步的 UID
  last_sync_at TEXT NOT NULL,    -- 最后同步时间 (ISO 8601)
  PRIMARY KEY(account_name, folder)
);
```

---

## 配置文件格式

### 完整配置示例

```yaml
# 日志级别: debug/info/warn/error
log_level: info

# 同步间隔（秒）
sync_interval: 300

# 邮箱账户配置
accounts:
  - name: "work-email"
    host: "imap.gmail.com"
    port: 993
    username: "your-email@gmail.com"
    password: "${GMAIL_PASSWORD}"  # 环境变量
    folders:
      - "INBOX"
      - "[Gmail]/重要"

# Webhook 配置
webhooks:
  - name: "telegram-notify"
    url: "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
    method: "POST"
    headers:
      Content-Type: "application/json"
    timeout: 10
    retry:
      count: 3
      delay: 5
    template: |
      {
        "chat_id": "${TELEGRAM_CHAT_ID}",
        "text": "📧 新邮件\n发件人: {{from_name}} <{{from_addr}}>\n主题: {{subject}}\n\n{{text}}"
      }

# 邮件过滤规则
rules:
  - name: "urgent-emails"
    enabled: true
    match:
      from:
        - "boss@company.com"
        - "*@urgent.com"
      subject:
        - "紧急"
        - "URGENT"
    webhooks:
      - "telegram-notify"

  - name: "catch-all"
    enabled: true
    match:
      catch_all: true
    webhooks:
      - "telegram-notify"
```

### 配置字段说明

#### 全局配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `log_level` | string | `info` | 日志级别 |
| `sync_interval` | number | `300` | 同步间隔（秒） |

#### accounts 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 账户唯一标识 |
| `host` | string | 是 | IMAP 服务器地址 |
| `port` | number | 是 | IMAP 服务器端口 |
| `username` | string | 是 | 登录用户名 |
| `password` | string | 是 | 登录密码（支持环境变量） |
| `folders` | string[] | 否 | 要同步的文件夹，默认 `["INBOX"]` |

#### webhooks 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Webhook 唯一标识 |
| `url` | string | 是 | 目标 URL（支持环境变量） |
| `method` | string | 否 | HTTP 方法，默认 `POST` |
| `headers` | object | 否 | HTTP 请求头 |
| `timeout` | number | 否 | 超时时间（秒），默认 `10` |
| `retry.count` | number | 否 | 重试次数，默认 `3` |
| `retry.delay` | number | 否 | 重试间隔（秒），默认 `5` |
| `template` | string | 是 | 请求体模板 |

#### rules 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 规则唯一标识 |
| `enabled` | boolean | 否 | 是否启用，默认 `true` |
| `match` | object | 是 | 匹配条件 |
| `webhooks` | string[] | 是 | 关联的 Webhook 名称列表 |

#### match 条件

| 字段 | 类型 | 说明 |
|------|------|------|
| `from` | string[] | 发件人匹配（支持通配符 `*`） |
| `subject` | string[] | 主题关键词匹配 |
| `folders` | string[] | 文件夹过滤 |
| `catch_all` | boolean | 匹配所有邮件 |

### 匹配规则

1. **通配符匹配**: `*` 匹配任意字符，`*@company.com` 匹配 company.com 域名下所有邮箱
2. **规则顺序**: 按配置文件顺序匹配，首次匹配成功后停止
3. **catch_all**: 放在最后作为默认规则，匹配所有未被前面规则捕获的邮件
4. **多条件 AND**: 同一规则内的多个条件需要全部满足才匹配
5. **空 webhooks**: `webhooks: []` 表示不推送，可用于过滤掉不需要的邮件

---

## 核心流程

### 1. 启动流程

```
加载环境变量
    │
    ▼
加载并验证配置文件
    │
    ├─ 配置错误 ──▶ 报错退出
    │
    ▼
初始化数据库
    │
    ├─ 数据库错误 ──▶ 报错退出
    │
    ▼
初始化日志系统
    │
    ▼
启动定时同步任务
    │
    ▼
进入主循环
```

### 2. 邮件同步流程

```
定时触发（每 N 秒）
    │
    ▼
遍历所有邮箱账户
    │
    ▼
连接 IMAP 服务器
    │
    ├─ 连接失败 ──▶ 记录错误日志，继续下一个账户
    │
    ▼
遍历配置的文件夹
    │
    ▼
查询新邮件 UID（大于上次同步的 UID）
    │
    ▼
过滤已同步邮件（查询数据库）
    │
    ▼
拉取邮件内容
    │
    ├─ 解析失败 ──▶ 记录警告日志，跳过该邮件
    │
    ▼
存储到数据库
    │
    ▼
触发规则引擎
    │
    ▼
更新同步状态
    │
    ▼
关闭 IMAP 连接
```

### 3. 规则匹配流程

```
接收邮件
    │
    ▼
遍历规则（按配置顺序）
    │
    ▼
规则已启用？
    │
    ├─ No ──▶ 跳过，继续下一条规则
    │
    ▼
检查匹配条件
    │
    ├─ from 条件匹配（支持通配符）
    ├─ subject 条件匹配（关键词）
    └─ folders 条件匹配
    │
    ▼
所有条件满足？
    │
    ├─ Yes ──▶ 执行关联的 Webhooks ──▶ 结束
    │
    └─ No ──▶ 继续下一条规则
         │
         ▼
    所有规则都未匹配？
         │
         └─ 检查是否有 catch_all 规则
```

### 4. Webhook 发送流程

```
规则匹配成功
    │
    ▼
获取关联的 Webhook 配置
    │
    ▼
检查 webhooks 列表是否为空
    │
    ├─ 空 ──▶ 不推送，结束
    │
    ▼
遍历 Webhooks
    │
    ▼
渲染模板（替换变量）
    │
    ▼
发送 HTTP 请求
    │
    ├─ 成功 ──▶ 记录日志，继续下一个 Webhook
    │
    └─ 失败
         │
         ▼
    重试次数 < 最大重试次数？
         │
         ├─ Yes ──▶ 等待 N 秒 ──▶ 重试
         │
         └─ No ──▶ 记录错误日志，继续下一个 Webhook
```

---

## 模板变量

Webhook 模板使用 Handlebars 语法，支持以下变量：

| 变量 | 类型 | 说明 |
|------|------|------|
| `{{id}}` | string | 邮件唯一标识 |
| `{{account_name}}` | string | 账户名称 |
| `{{folder}}` | string | 文件夹名称 |
| `{{from_addr}}` | string | 发件人地址 |
| `{{from_name}}` | string | 发件人名称 |
| `{{to_addrs}}` | string | 收件人列表（JSON） |
| `{{subject}}` | string | 邮件主题 |
| `{{text}}` | string | 纯文本内容 |
| `{{html}}` | string | HTML 内容 |
| `{{date}}` | string | 发送时间（ISO 8601） |
| `{{attachments}}` | string | 附件信息（JSON） |

---

## 错误处理

### 错误类型及处理策略

| 场景 | 处理方式 | 日志级别 |
|------|---------|---------|
| 配置文件不存在 | 启动时报错退出 | error |
| 配置文件格式错误 | 启动时报错退出 | error |
| 数据库初始化失败 | 启动时报错退出 | error |
| IMAP 连接失败 | 重试连接，记录错误，继续处理其他账户 | error |
| IMAP 认证失败 | 记录错误，跳过该账户 | error |
| 邮件解析失败 | 记录警告，跳过该邮件 | warn |
| Webhook 发送失败 | 重试配置次数，记录错误 | error |
| 环境变量未定义 | 启动时报错退出 | error |

### 重试策略

Webhook 发送失败时的重试逻辑：

1. 首次发送失败
2. 等待 `retry.delay` 秒
3. 重试发送
4. 重复步骤 2-3，直到成功或达到 `retry.count` 次数
5. 仍失败则记录错误日志

---

## 日志规范

### 日志级别

| 级别 | 使用场景 |
|------|---------|
| `debug` | 详细的调试信息 |
| `info` | 正常的操作信息 |
| `warn` | 警告信息，不影响主流程 |
| `error` | 错误信息，需要关注 |

### 日志格式

输出到 stdout，格式如下：

```
[时间戳] [级别] [模块] 消息
```

示例：

```
[2024-01-15 10:30:45] [info] [imap] Connecting to imap.gmail.com:993
[2024-01-15 10:30:46] [info] [syncer] Syncing folder INBOX for account work-email
[2024-01-15 10:30:47] [info] [syncer] Found 5 new emails
[2024-01-15 10:30:48] [info] [rules] Email matched rule: urgent-emails
[2024-01-15 10:30:48] [info] [webhook] Sending webhook: telegram-notify
[2024-01-15 10:30:49] [error] [webhook] Failed to send webhook: timeout after 10s
```

---

## Docker 部署

### Dockerfile

```dockerfile
FROM oven/bun:1.0.18-alpine

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./
RUN bun build ./src/index.ts --outdir ./dist --target bun

VOLUME ["/app/data", "/app/config"]

ENV LOG_LEVEL=info
ENV SYNC_INTERVAL=300

CMD ["bun", "run", "dist/index.js"]
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_LEVEL` | `info` | 日志级别 |
| `SYNC_INTERVAL` | `300` | 同步间隔（秒） |
| `CONFIG_PATH` | `/app/config/config.yaml` | 配置文件路径 |
| `DATABASE_PATH` | `/app/data/mailhooks.db` | 数据库路径 |

### docker-compose.yml

```yaml
version: '3.8'

services:
  mailhooks:
    build: .
    container_name: mailhooks
    restart: unless-stopped
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    environment:
      - LOG_LEVEL=info
      - SYNC_INTERVAL=300
      - GMAIL_PASSWORD=${GMAIL_PASSWORD}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
```

---

## 依赖清单

```json
{
  "dependencies": {
    "imap": "^0.8.19",
    "mailparser": "^3.6.5",
    "better-sqlite3": "^9.2.2",
    "js-yaml": "^4.1.0",
    "node-fetch": "^3.3.2",
    "handlebars": "^4.7.8",
    "pino": "^8.17.2",
    "pino-pretty": "^10.3.1"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.5",
    "@types/imap": "^0.8.40",
    "@types/better-sqlite3": "^7.6.8",
    "bun-types": "^1.0.18"
  }
}
```

---

## 扩展性考虑

### 未来可能的扩展

1. **多协议支持**: 当前仅支持 IMAP，未来可扩展支持 POP3、JMAP
2. **Web UI**: 提供可视化配置界面和仪表板
3. **多租户**: 支持团队协作场景
4. **插件系统**: 支持自定义 Webhook 格式和处理器
5. **监控指标**: 导出 Prometheus 指标

### 设计预留

- 模块化的代码结构便于扩展
- 配置文件格式预留扩展空间
- 数据库表结构设计考虑未来需求

---

## 成功标准

- [ ] 能够成功连接并同步多个 IMAP 邮箱账户
- [ ] 能够根据规则过滤邮件并推送到 Webhook
- [ ] Webhook 发送失败时能够正确重试
- [ ] 所有配置通过 YAML 文件管理
- [ ] 日志输出到 stdout，支持多个级别
- [ ] Docker 部署正常工作
- [ ] 重启后能够从上次同步位置继续