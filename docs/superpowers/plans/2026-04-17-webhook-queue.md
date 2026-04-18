# Webhook Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement async webhook queue to ensure emails are never lost due to network failures

**Architecture:** Replace synchronous webhook sending with SQLite-based queue. All synced emails enqueue immediately; background consumer polls and sends. Failed messages retry until expired.

**Tech Stack:** Bun, SQLite, TypeScript

---

## File Structure

| File | Purpose |
|------|---------|
| `src/storage/migrations.ts` | Add webhook_queue table schema |
| `src/storage/types.ts` | Add QueueItem type definition |
| `src/storage/database.ts` | Add queue CRUD methods |
| `src/webhooks/queue.ts` | New: Queue operations wrapper |
| `src/config/types.ts` | Simplify webhook config, remove rules |
| `src/config/schema.ts` | Update validation for single webhook |
| `src/config/loader.ts` | Update config loading |
| `src/imap/syncer.ts` | Replace rule matching with queue enqueue |
| `src/webhooks/sender.ts` | Simplify for single webhook |
| `src/index.ts` | Start queue consumer loop |
| `config.example.yaml` | Update example config |
| `src/rules/engine.ts` | DELETE |
| `src/rules/matcher.ts` | DELETE |
| `src/rules/types.ts` | DELETE |

---

### Task 1: Add Queue Table Schema

**Files:**
- Modify: `src/storage/migrations.ts`

- [ ] **Step 1: Add webhook_queue table to migrations**

```typescript
const MIGRATIONS = [
  // ... existing migrations ...
  
  `CREATE TABLE IF NOT EXISTS webhook_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    folder TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(account_name, folder, email_id)
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_webhook_queue_status ON webhook_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_queue_expires ON webhook_queue(expires_at)`
]
```

- [ ] **Step 2: Run application to create table**

Run: `bun run start`
Expected: Starts successfully, creates webhook_queue table

- [ ] **Step 3: Verify table exists**

Run: `sqlite3 data/mailhooks.db ".tables"`
Expected: `emails  sync_state  webhook_logs  webhook_queue`

- [ ] **Step 4: Commit**

```bash
git add src/storage/migrations.ts
git commit -m "feat: add webhook_queue table schema"
```

---

### Task 2: Add Queue Type Definitions

**Files:**
- Modify: `src/storage/types.ts`

- [ ] **Step 1: Add QueueItem interface to storage/types.ts**

```typescript
export interface QueueItem {
  id: number
  emailId: string
  accountName: string
  folder: string
  status: 'pending' | 'processing' | 'success' | 'expired'
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export interface QueueCreateInput {
  emailId: string
  accountName: string
  folder: string
  expiresAt: string
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/storage/types.ts
git commit -m "feat: add QueueItem type definitions"
```

---

### Task 3: Add Queue CRUD Methods to Database

**Files:**
- Modify: `src/storage/database.ts`
- Modify: `src/storage/types.ts` (update Database interface)

- [ ] **Step 1: Update Database interface in storage/types.ts**

Add to `Database` interface:

```typescript
export interface Database {
  // ... existing methods ...
  
  createQueueItem(input: QueueCreateInput): number
  getPendingQueueItems(limit: number): QueueItem[]
  markQueueProcessing(id: number): void
  markQueueSuccess(id: number): void
  markQueuePending(id: number, error: string): void
  markQueueExpired(id: number, error: string): void
  cleanupQueue(days: number): void
}
```

- [ ] **Step 2: Implement queue methods in database.ts**

Add methods to `MailHooksDatabase` class:

```typescript
createQueueItem(input: QueueCreateInput): number {
  const now = new Date().toISOString()
  const stmt = this.db.prepare(`
    INSERT OR IGNORE INTO webhook_queue (
      email_id, account_name, folder, status, attempts, 
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
  `)
  const result = stmt.run(
    input.emailId, input.accountName, input.folder, 
    now, now, input.expiresAt
  )
  return result.lastInsertRowid as number
}

getPendingQueueItems(limit: number): QueueItem[] {
  const stmt = this.db.prepare(`
    SELECT * FROM webhook_queue 
    WHERE status = 'pending' AND expires_at > ?
    ORDER BY created_at ASC LIMIT ?
  `)
  const rows = stmt.all(new Date().toISOString(), limit) as Record<string, unknown>[]
  return rows.map(this.rowToQueueItem)
}

markQueueProcessing(id: number): void {
  const now = new Date().toISOString()
  const stmt = this.db.prepare(`
    UPDATE webhook_queue SET status = 'processing', updated_at = ? WHERE id = ?
  `)
  stmt.run(now, id)
}

markQueueSuccess(id: number): void {
  const now = new Date().toISOString()
  const stmt = this.db.prepare(`
    UPDATE webhook_queue SET status = 'success', updated_at = ? WHERE id = ?
  `)
  stmt.run(now, id)
  
  // Log success
  const item = this.getQueueItem(id)
  if (item) {
    this.db.prepare(`
      INSERT INTO webhook_logs (email_id, webhook_name, status, attempts, created_at, updated_at)
      VALUES (?, 'webhook', 'success', ?, ?, ?)
    `).run(item.emailId, item.attempts, now, now)
  }
}

markQueuePending(id: number, error: string): void {
  const now = new Date().toISOString()
  const stmt = this.db.prepare(`
    UPDATE webhook_queue 
    SET status = 'pending', attempts = attempts + 1, last_error = ?, updated_at = ? 
    WHERE id = ?
  `)
  stmt.run(error, now, id)
}

markQueueExpired(id: number, error: string): void {
  const now = new Date().toISOString()
  const stmt = this.db.prepare(`
    UPDATE webhook_queue SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ?
  `)
  stmt.run(error, now, id)
  
  // Log expired
  const item = this.getQueueItem(id)
  if (item) {
    this.db.prepare(`
      INSERT INTO webhook_logs (email_id, webhook_name, status, attempts, last_error, created_at, updated_at)
      VALUES (?, 'webhook', 'expired', ?, ?, ?, ?)
    `).run(item.emailId, item.attempts + 1, error, now, now)
  }
}

cleanupQueue(days: number): void {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const stmt = this.db.prepare(`
    DELETE FROM webhook_queue 
    WHERE status IN ('success', 'expired') AND updated_at < ?
  `)
  stmt.run(cutoff)
}

private getQueueItem(id: number): QueueItem | null {
  const stmt = this.db.prepare('SELECT * FROM webhook_queue WHERE id = ?')
  const row = stmt.get(id) as Record<string, unknown> | undefined
  return row ? this.rowToQueueItem(row) : null
}

private rowToQueueItem(row: Record<string, unknown>): QueueItem {
  return {
    id: row.id as number,
    emailId: row.email_id as string,
    accountName: row.account_name as string,
    folder: row.folder as string,
    status: row.status as QueueItem['status'],
    attempts: row.attempts as number,
    lastError: row.last_error as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiresAt: row.expires_at as string
  }
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/storage/database.ts src/storage/types.ts
git commit -m "feat: implement queue CRUD methods in database"
```

---

### Task 4: Update Configuration Types

**Files:**
- Modify: `src/config/types.ts`

- [ ] **Step 1: Replace webhooks/rules with single webhook config**

Replace entire content:

```typescript
export interface AccountConfig {
  name: string
  host: string
  port: number
  username: string
  password: string
  folders?: string[]
}

export interface WebhookRetryConfig {
  count: number
  delay: number
}

export interface WebhookConfig {
  url: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
  retry?: WebhookRetryConfig
  template: string
  poll_interval?: number
  expires_hours?: number
  cleanup_days?: number
}

export interface AppConfig {
  log_level?: string
  sync_interval?: number
  socks_proxy?: string
  accounts: AccountConfig[]
  webhook: WebhookConfig
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in schema.ts, loader.ts, index.ts (expected - will fix in next tasks)

- [ ] **Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat: simplify config to single webhook"
```

---

### Task 5: Update Config Schema Validation

**Files:**
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Update validateWebhook function**

Replace `validateWebhooks` with:

```typescript
function validateWebhook(wh: unknown): WebhookConfig {
  if (!wh || typeof wh !== 'object') {
    throw new Error('webhook: required and must be object')
  }
  
  const webhook = wh as Record<string, unknown>
  
  if (!webhook.url || typeof webhook.url !== 'string') {
    throw new Error('webhook.url: required and must be string')
  }
  
  if (!webhook.template || typeof webhook.template !== 'string') {
    throw new Error('webhook.template: required and must be string')
  }
  
  return {
    url: webhook.url,
    method: webhook.method as string | undefined,
    headers: webhook.headers as Record<string, string> | undefined,
    timeout: webhook.timeout as number | undefined,
    retry: webhook.retry as WebhookRetryConfig | undefined,
    template: webhook.template,
    poll_interval: webhook.poll_interval as number | undefined,
    expires_hours: webhook.expires_hours as number | undefined,
    cleanup_days: webhook.cleanup_days as number | undefined
  }
}
```

- [ ] **Step 2: Update validateConfig function**

Replace validation logic:

```typescript
export function validateConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Config must be an object')
  }
  
  const config = raw as Record<string, unknown>
  
  // Validate accounts
  const accounts = validateAccounts(config.accounts)
  
  // Validate webhook (single)
  const webhook = validateWebhook(config.webhook)
  
  return {
    log_level: config.log_level as string | undefined,
    sync_interval: config.sync_interval as number | undefined,
    socks_proxy: config.socks_proxy as string | undefined,
    accounts,
    webhook
  }
}
```

- [ ] **Step 3: Remove validateWebhooks and validateRules functions**

Delete these functions entirely.

- [ ] **Step 4: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in loader.ts, index.ts only

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat: update config validation for single webhook"
```

---

### Task 6: Update Config Loader

**Files:**
- Modify: `src/config/loader.ts`

- [ ] **Step 1: Update loadConfig function**

Remove webhook template registration loop:

```typescript
export async function loadConfig(path: string): Promise<AppConfig> {
  const content = await readFile(path, 'utf-8')
  const raw = yaml.load(content)
  return validateConfig(raw)
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in index.ts only

- [ ] **Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: simplify config loader"
```

---

### Task 7: Delete Rules Engine Files

**Files:**
- Delete: `src/rules/engine.ts`
- Delete: `src/rules/matcher.ts`
- Delete: `src/rules/types.ts`

- [ ] **Step 1: Delete rules directory**

```bash
rm -rf src/rules
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in index.ts only (rules imports)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: remove rules engine"
```

---

### Task 8: Update Syncer to Enqueue Emails

**Files:**
- Modify: `src/imap/syncer.ts`

- [ ] **Step 1: Remove rule engine imports and handler**

Remove:
- `setEmailHandler` method
- `onEmail` property
- All rule-related imports

- [ ] **Step 2: Add queue enqueue logic**

Replace `syncFolder` to enqueue all emails:

```typescript
import type { Logger } from '../utils/logger'
import type { Database } from '../storage/types'
import type { AppConfig, AccountConfig } from '../config/types'
import { ImapClient } from './client'
import { parseEmail } from './parser'
import { getDefaultFolders } from '../config/loader'

export class EmailSyncer {
  private logger: Logger
  private db: Database
  private config: AppConfig
  
  constructor(db: Database, config: AppConfig, logger: Logger) {
    this.db = db
    this.config = config
    this.logger = logger.child({ module: 'syncer' })
  }
  
  async syncAccount(account: AccountConfig): Promise<void> {
    this.logger.info({ account: account.name }, 'Starting sync for account')
    
    const client = new ImapClient({
      user: account.username,
      password: account.password,
      host: account.host,
      port: account.port,
      tls: account.port === 993
    }, this.logger, this.config.socks_proxy)
    
    try {
      await client.connect()
      
      const folders = account.folders ?? getDefaultFolders()
      for (const folder of folders) {
        await this.syncFolder(client, account.name, folder)
      }
    } catch (err) {
      this.logger.error({ err, account: account.name }, 'Failed to sync account')
    } finally {
      client.disconnect()
    }
  }
  
  private async syncFolder(client: ImapClient, accountName: string, folder: string): Promise<void> {
    this.logger.info({ accountName, folder }, 'Syncing folder')
    
    const box = await client.openBox(folder)
    const syncState = this.db.getSyncState(accountName, folder)
    
    if (!syncState) {
      this.logger.info({ accountName, folder, uidnext: box.uidnext }, 'First sync, recording uidnext')
      this.db.saveSyncState({
        accountName,
        folder,
        lastUid: box.uidnext.toString(),
        lastSyncAt: new Date().toISOString()
      })
      return
    }
    
    const lastUid = parseInt(syncState.lastUid, 10)
    const allUids = await client.search(['ALL'])
    const uids = allUids.filter(uid => uid > lastUid)
    
    if (uids.length === 0) {
      this.logger.info({ accountName, folder }, 'No new emails')
      return
    }
    
    this.logger.info({ accountName, folder, count: uids.length }, 'Found new emails')
    
    const fetcher = client.fetch(uids, ['HEADER', 'TEXT', ''])
    
    for await (const message of this.fetchMessages(fetcher)) {
      try {
        const email = await this.processMessage(message, accountName, folder)
        this.db.saveEmail(email)
        
        // Enqueue for webhook
        const expiresHours = this.config.webhook.expires_hours ?? 24
        const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString()
        
        this.db.createQueueItem({
          emailId: email.id,
          accountName: email.accountName,
          folder: email.folder,
          expiresAt
        })
        
        this.db.saveSyncState({
          accountName,
          folder,
          lastUid: email.id,
          lastSyncAt: new Date().toISOString()
        })
        
        this.logger.info({ emailId: email.id }, 'Email enqueued for webhook')
      } catch (err) {
        this.logger.warn({ err, uid: message.uid }, 'Failed to process email')
      }
    }
  }
  
  // ... fetchMessages and processMessage unchanged ...
  
  async syncAll(): Promise<void> {
    this.logger.info('Starting sync for all accounts')
    
    for (const account of this.config.accounts) {
      await this.syncAccount(account)
    }
    
    this.logger.info('Completed sync for all accounts')
  }
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in index.ts only

- [ ] **Step 4: Commit**

```bash
git add src/imap/syncer.ts
git commit -m "feat: enqueue all emails to webhook queue"
```

---

### Task 9: Simplify Webhook Sender

**Files:**
- Modify: `src/webhooks/sender.ts`

- [ ] **Step 1: Remove template registration, simplify to single webhook**

```typescript
import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email } from '../types'
import { compileTemplate } from '../utils/template'
import { retry } from './retry'

export class WebhookSender {
  private logger: Logger
  private templateFn: (email: Email) => string
  
  constructor(config: WebhookConfig, logger: Logger) {
    this.logger = logger.child({ module: 'webhook' })
    this.templateFn = compileTemplate(config.template)
  }
  
  async send(config: WebhookConfig, email: Email): Promise<{ success: boolean; error?: string }> {
    const body = this.templateFn(email)
    
    const method = config.method ?? 'POST'
    const headers = config.headers ?? {}
    const timeout = config.timeout ?? 10
    const retryCount = config.retry?.count ?? 3
    const retryDelay = config.retry?.delay ?? 5
    
    this.logger.info({ emailId: email.id }, 'Sending webhook')
    
    const result = await retry(
      () => this.makeRequest(config.url, method, headers, body, timeout),
      retryCount,
      retryDelay
    )
    
    if (result.success) {
      this.logger.info({ attempts: result.attempts }, 'Webhook sent')
      return { success: true }
    } else {
      this.logger.error({ 
        attempts: result.attempts,
        error: result.lastError 
      }, 'Webhook failed')
      return { success: false, error: result.lastError }
    }
  }
  
  private async makeRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    timeout: number
  ): Promise<void> {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout * 1000)
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: Errors in index.ts only

- [ ] **Step 3: Commit**

```bash
git add src/webhooks/sender.ts
git commit -m "feat: simplify webhook sender for single webhook"
```

---

### Task 10: Update Main Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace entire index.ts with queue consumer logic**

```typescript
import { getEnv } from './utils/env'
import { createLogger, type LogLevel } from './utils/logger'
import { loadConfig, getDefaultSyncInterval, getDefaultLogLevel } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { EmailSyncer } from './imap/syncer'
import { WebhookSender } from './webhooks/sender'
import type { Email } from './types'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logger = createLogger(logLevel)
  
  const syncInterval = config.sync_interval ?? getDefaultSyncInterval()
  const pollInterval = config.webhook.poll_interval ?? 30
  const cleanupDays = config.webhook.cleanup_days ?? 7
  
  logger.info('Starting MailHooks')
  logger.info({ configPath, databasePath, syncInterval, pollInterval }, 'Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const syncer = new EmailSyncer(db, config, logger)
  const webhookSender = new WebhookSender(config.webhook, logger)
  
  // Start queue consumer
  logger.info({ interval: pollInterval }, 'Starting webhook queue consumer')
  
  // Run sync and consumer in parallel
  await Promise.all([
    runSyncLoop(syncer, syncInterval, logger),
    runQueueConsumer(db, webhookSender, config.webhook, pollInterval, logger),
    runCleanupLoop(db, cleanupDays, logger)
  ])
}

async function runSyncLoop(syncer: EmailSyncer, interval: number, logger: ReturnType<typeof createLogger>) {
  logger.info('Starting initial sync')
  await syncer.syncAll()
  
  logger.info({ interval }, 'Starting sync loop')
  
  while (true) {
    await sleep(interval * 1000)
    await syncer.syncAll()
  }
}

async function runQueueConsumer(
  db: MailHooksDatabase,
  sender: WebhookSender,
  webhookConfig: typeof config.webhook,
  pollInterval: number,
  logger: ReturnType<typeof createLogger>
) {
  while (true) {
    await sleep(pollInterval * 1000)
    
    const items = db.getPendingQueueItems(50)
    
    if (items.length === 0) {
      continue
    }
    
    logger.info({ count: items.length }, 'Processing webhook queue')
    
    for (const item of items) {
      try {
        db.markQueueProcessing(item.id)
        
        const email = db.getEmail(item.emailId)
        if (!email) {
          db.markQueueExpired(item.id, 'Email not found in database')
          logger.warn({ itemId: item.id, emailId: item.emailId }, 'Email not found')
          continue
        }
        
        const result = await sender.send(webhookConfig, email)
        
        if (result.success) {
          db.markQueueSuccess(item.id)
        } else {
          // Check if expired
          if (new Date() > new Date(item.expiresAt)) {
            db.markQueueExpired(item.id, result.error ?? 'Expired')
            logger.warn({ itemId: item.id }, 'Queue item expired')
          } else {
            db.markQueuePending(item.id, result.error ?? 'Unknown error')
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        db.markQueuePending(item.id, error)
        logger.error({ err, itemId: item.id }, 'Queue processing error')
      }
    }
  }
}

async function runCleanupLoop(db: MailHooksDatabase, cleanupDays: number, logger: ReturnType<typeof createLogger>) {
  // Run cleanup once per day
  const cleanupInterval = 24 * 3600 * 1000
  
  while (true) {
    await sleep(cleanupInterval)
    
    db.cleanupQueue(cleanupDays)
    logger.info({ days: cleanupDays }, 'Queue cleanup completed')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Run TypeScript check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: implement queue consumer in main entry"
```

---

### Task 11: Update Example Config

**Files:**
- Modify: `config.example.yaml`

- [ ] **Step 1: Replace config.example.yaml with single webhook**

```yaml
# MailHooks Configuration Example
# Copy this file to config.yaml and modify as needed

# Log level: debug/info/warn/error
log_level: info

# Sync interval in seconds
sync_interval: 300

# SOCKS proxy (optional, leave empty to disable)
# socks_proxy: "socks5://127.0.0.1:7898"

# Email accounts to sync
accounts:
  - name: "gmail"
    host: "imap.gmail.com"
    port: 993
    username: "your-email@gmail.com"
    password: "${GMAIL_PASSWORD}"
    folders:
      - "INBOX"
      
  - name: "outlook"
    host: "imap-mail.outlook.com"
    port: 993
    username: "your-email@outlook.com"
    password: "${OUTLOOK_PASSWORD}"
    folders:
      - "INBOX"

# Webhook configuration (single webhook)
webhook:
  url: "https://your-webhook-url.com/endpoint"
  method: "POST"
  headers:
    Content-Type: "application/json"
  timeout: 10
  retry:
    count: 3
    delay: 5
  template: |
    {
      "text": "📧 New Email\nFrom: {{from_name}} <{{from_addr}}>\nSubject: {{subject}}\n\n{{text}}"
    }
  poll_interval: 30        # Queue poll interval in seconds
  expires_hours: 24        # Queue item expiration in hours
  cleanup_days: 7          # Clean up completed items after N days
```

- [ ] **Step 2: Commit**

```bash
git add config.example.yaml
git commit -m "feat: update example config for single webhook"
```

---

### Task 12: Run Full Application Test

**Files:**
- None (testing)

- [ ] **Step 1: Delete existing database and run application**

```bash
rm -rf data
mkdir -p data
bun run start
```

Expected: Application starts, creates tables, first sync records uidnext

- [ ] **Step 2: Verify queue consumer runs**

Wait 30 seconds, check logs for:
```
Starting webhook queue consumer
Processing webhook queue
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete webhook queue implementation"
```

---

## Self-Review Checklist

- [x] Spec coverage: All requirements from design doc have tasks
- [x] Placeholder scan: No TBD/TODO placeholders
- [x] Type consistency: QueueItem, Database methods match across all files
- [x] File paths: All exact paths specified