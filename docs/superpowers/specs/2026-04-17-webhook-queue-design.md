# Webhook Queue Design

## Overview

将 webhook 发送机制从同步改为异步队列模式，确保邮件同步不会因网络问题丢失。

**核心改动**：
- 删除规则引擎（rules），不再过滤邮件
- 简化为单个 webhook 配置
- 所有同步邮件入队，异步发送
- 失败消息保留过期时间，自动清理

## Architecture

### Current Flow (Before)

```
IMAP Sync → Rule Match → Immediate Webhook Send → Log Result
                ↓ (no match)
              Skip
```

**问题**：
- 网络抖动时 webhook 发送失败，邮件不会被重试
- 规则引擎增加配置复杂度

### New Flow (After)

```
IMAP Sync → All Emails → Queue (webhook_queue) → Background Consumer → Webhook Send → Success/Expired
                                                              ↓ (failure)
                                                          Retry until expired
```

**优势**：
- 队列持久化，不丢失邮件
- 异步发送，不阻塞同步流程
- 自动过期清理，避免无限重试

## Database Schema

### New Table: webhook_queue

```sql
CREATE TABLE webhook_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL,              -- 邮件 UID
  account_name TEXT NOT NULL,          -- 账户名称
  folder TEXT NOT NULL,                -- IMAP 文件夹
  status TEXT NOT NULL,                -- pending/processing/success/expired
  attempts INTEGER DEFAULT 0,          -- 发送尝试次数
  last_error TEXT,                     -- 最后一次错误信息
  created_at TEXT NOT NULL,            -- 入队时间
  updated_at TEXT NOT NULL,            -- 更新时间
  expires_at TEXT NOT NULL             -- 过期时间
);

CREATE INDEX idx_webhook_queue_status ON webhook_queue(status);
CREATE INDEX idx_webhook_queue_expires ON webhook_queue(expires_at);
```

### Keep Table: webhook_logs (审计日志)

现有的 `webhook_logs` 表保留，作为审计日志：
- 发送成功时写入一条 `success` 日志
- 过期时写入一条 `expired` 日志
- 用于查看历史发送记录

### Remove: rules 表（不存在）

当前 rules 仅在配置中定义，无需数据库迁移。

## Configuration Changes

### Before

```yaml
webhooks:
  - name: "mattermost"
    url: "..."
    template: "..."
    
rules:
  - name: "from-163"
    match:
      from: ["lipaysamart@163.com"]
    webhooks: ["mattermost"]
```

### After

```yaml
webhook:
  url: "https://mattermost.homelab-dev.com/hooks/..."
  method: "POST"
  headers:
    Content-Type: "application/json"
  timeout: 10
  retry:
    count: 3
    delay: 5
  template: |
    {
      "text": "📧 新邮件\n发件人: {{from_name}} <{{from_addr}}>\n主题: {{subject}}\n\n{{text}}"
    }
  expires_hours: 24                 -- 队列消息过期时间（小时）
  cleanup_days: 7                   -- 成功/过期消息保留天数

# rules 配置完全删除
```

## Implementation Details

### 1. Queue Producer (在 EmailSyncer 中)

邮件同步完成后，将邮件信息入队：

```typescript
interface QueueItem {
  emailId: string
  accountName: string
  folder: string
  expiresAt: Date  // created_at + expires_hours
}

// syncer.ts 中
async syncFolder(...) {
  // ... 同步邮件
  
  // 入队（所有邮件，不再过滤）
  for (const email of emails) {
    await this.queue.enqueue({
      emailId: email.id,
      accountName: email.accountName,
      folder: email.folder,
      expiresAt: new Date(Date.now() + config.webhook.expires_hours * 3600 * 1000)
    })
  }
}
```

### 2. Queue Consumer (后台定时轮询)

在主进程中启动定时轮询：

```typescript
// index.ts 中
async function startQueueConsumer() {
  while (true) {
    await sleep(config.webhook.poll_interval * 1000)  // 默认 30 秒
    
    const items = await queue.getPending(limit: 50)
    
    for (const item of items) {
      await queue.markProcessing(item.id)
      
      const email = db.getEmail(item.email_id)
      if (!email) {
        await queue.markExpired(item.id, 'Email not found')
        continue
      }
      
      const result = await webhookSender.send(email)
      
      if (result.success) {
        await queue.markSuccess(item.id)
      } else {
        await queue.markFailed(item.id, result.error)
        
        // 检查是否过期
        if (new Date() > item.expiresAt) {
          await queue.markExpired(item.id, 'Expired after retries')
        }
      }
    }
  }
}
```

### 3. Cleanup (定期清理)

成功/过期消息保留 `cleanup_days` 后删除：

```typescript
async function cleanupQueue() {
  const cutoff = new Date(Date.now() - config.webhook.cleanup_days * 24 * 3600 * 1000)
  
  await queue.deleteWhere({
    status: ['success', 'expired'],
    updated_at: { $lt: cutoff.toISOString() }
  })
}
```

## Error Handling

| 场景 | 处理 |
|------|------|
| Webhook 发送失败 | 增加 attempts，下次轮询继续尝试 |
| 达到过期时间 | 标记 expired，写入日志，不再重试 |
| 邮件不存在 | 标记 expired，写入日志 |
| 队列消费异常 | 记录错误，下次轮询继续 |

## Testing Plan

1. **队列入队测试**：同步邮件后验证队列表有记录
2. **消费成功测试**：手动触发消费，验证 webhook 发送成功
3. **消费失败测试**：模拟 webhook 失败，验证重试机制
4. **过期测试**：设置短过期时间，验证过期标记
5. **清理测试**：验证过期消息自动清理

## Migration Notes

- 无需迁移现有数据（队列表是新表）
- 现有 `webhook_logs` 表保留不变
- 配置文件需要更新（删除 rules，简化 webhook）
- `config.example.yaml` 需要同步更新

## Files to Modify

| 文件 | 改动 |
|------|------|
| `src/storage/migrations.ts` | 添加 webhook_queue 表 |
| `src/storage/database.ts` | 添加队列 CRUD 方法 |
| `src/storage/types.ts` | 添加 QueueItem 类型 |
| `src/config/types.ts` | 简化 webhook 配置，删除 rules |
| `src/config/schema.ts` | 更新配置验证逻辑 |
| `src/config/loader.ts` | 更新配置加载逻辑 |
| `src/imap/syncer.ts` | 入队逻辑替代规则匹配 |
| `src/webhooks/sender.ts` | 简化为单 webhook 发送 |
| `src/index.ts` | 启动队列消费者 + 清理任务 |
| `config.example.yaml` | 更新示例配置 |