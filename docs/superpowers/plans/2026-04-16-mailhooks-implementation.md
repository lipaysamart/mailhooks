# MailHooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight email synchronization and distribution tool that syncs multiple IMAP accounts and pushes emails to webhooks based on configurable rules.

**Architecture:** Single service with IMAP syncer polling accounts, rule engine filtering emails, and webhook sender dispatching to targets. All state stored in SQLite, configuration in YAML file.

**Tech Stack:** Bun + TypeScript, SQLite (better-sqlite3), node-imap, mailparser, Handlebars, Pino

---

## File Structure

```
src/
├── index.ts                # Entry point, orchestrates all modules
├── types.ts                # Global type definitions
├── config/
│   ├── loader.ts           # Load and parse YAML config
│   ├── schema.ts           # Config validation schema
│   └── types.ts            # Config-related types
├── storage/
│   ├── database.ts         # SQLite connection and operations
│   ├── migrations.ts       # Database schema initialization
│   └── types.ts            # Storage-related types
├── utils/
│   ├── logger.ts           # Pino logger setup
│   ├── template.ts         # Handlebars template rendering
│   └── env.ts              # Environment variable handling
├── imap/
│   ├── client.ts           # IMAP connection wrapper
│   ├── syncer.ts           # Email synchronization logic
│   └── parser.ts           # Parse raw email to structured data
│   └── types.ts            # IMAP-related types
├── rules/
│   ├── engine.ts           # Rule matching logic
│   ├── matcher.ts          # Individual matchers (from, subject, etc.)
│   └── types.ts            # Rule-related types
├── webhooks/
│   ├── sender.ts           # HTTP webhook sender
│   ├── retry.ts            # Retry logic
│   └── types.ts            # Webhook-related types
```

---

## Task 1: Project Setup and Dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mailhooks",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "bun test"
  },
  "dependencies": {
    "imap": "^0.8.19",
    "mailparser": "^3.6.5",
    "better-sqlite3": "^9.2.2",
    "js-yaml": "^4.1.0",
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

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
data/
*.db
*.log
config.yaml
.env
bun.lockb
```

- [ ] **Step 4: Install dependencies**

Run: `bun install`

Expected: Dependencies installed successfully

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lockb
git commit -m "chore: initialize project with dependencies"
```

---

## Task 2: Global Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create global types file**

```typescript
// ABOUTME: Global type definitions for MailHooks
// ABOUTME: Defines core data structures used across modules

export interface Email {
  id: string
  accountName: string
  folder: string
  fromAddr: string
  fromName: string | null
  toAddrs: string[]
  subject: string | null
  text: string | null
  html: string | null
  date: string
  flags: string[]
  attachments: Attachment[]
  syncedAt: string
}

export interface Attachment {
  filename: string
  contentType: string
  size: number
}

export interface WebhookLog {
  id: number
  emailId: string
  webhookName: string
  status: 'pending' | 'success' | 'failed'
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface SyncState {
  accountName: string
  folder: string
  lastUid: string
  lastSyncAt: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add global type definitions"
```

---

## Task 3: Environment Variable Utility

**Files:**
- Create: `src/utils/env.ts`

- [ ] **Step 1: Create environment utility**

```typescript
// ABOUTME: Environment variable handling with validation
// ABOUTME: Provides typed access to environment variables

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is required but not set`)
  }
  return value
}

export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value === undefined) {
    return defaultValue
  }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number: ${value}`)
  }
  return parsed
}

export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const value = process.env[key]
    if (value === undefined) {
      throw new Error(`Environment variable ${key} is not set`)
    }
    return value
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/env.ts
git commit -m "feat: add environment variable utility"
```

---

## Task 4: Logger Utility

**Files:**
- Create: `src/utils/logger.ts`

- [ ] **Step 1: Create logger utility**

```typescript
// ABOUTME: Pino logger setup with configurable levels
// ABOUTME: Provides structured logging output to stdout

import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function createLogger(level: LogLevel = 'info') {
  return pino({
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '[{module}] {msg}'
      }
    }
  })
}

export type Logger = ReturnType<typeof createLogger>

export function moduleLogger(logger: Logger, module: string) {
  return logger.child({ module })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: add pino logger utility"
```

---

## Task 5: Template Rendering Utility

**Files:**
- Create: `src/utils/template.ts`

- [ ] **Step 1: Create template utility**

```typescript
// ABOUTME: Handlebars template rendering for webhook payloads
// ABOUTME: Supports email variable substitution in webhook templates

import Handlebars from 'handlebars'
import type { Email } from '../types'

export function compileTemplate(template: string): (email: Email) => string {
  const compiled = Handlebars.compile(template)
  return (email: Email) => {
    const data = {
      id: email.id,
      account_name: email.accountName,
      folder: email.folder,
      from_addr: email.fromAddr,
      from_name: email.fromName ?? '',
      to_addrs: JSON.stringify(email.toAddrs),
      subject: email.subject ?? '',
      text: email.text ?? '',
      html: email.html ?? '',
      date: email.date,
      attachments: JSON.stringify(email.attachments)
    }
    return compiled(data)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/template.ts
git commit -m "feat: add handlebars template utility"
```

---

## Task 6: Config Types

**Files:**
- Create: `src/config/types.ts`

- [ ] **Step 1: Create config types**

```typescript
// ABOUTME: Configuration file type definitions
// ABOUTME: Defines structure for YAML config validation

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
  name: string
  url: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
  retry?: WebhookRetryConfig
  template: string
}

export interface MatchCondition {
  from?: string[]
  subject?: string[]
  folders?: string[]
  catch_all?: boolean
}

export interface RuleConfig {
  name: string
  enabled?: boolean
  match: MatchCondition
  webhooks: string[]
}

export interface AppConfig {
  log_level?: string
  sync_interval?: number
  accounts: AccountConfig[]
  webhooks: WebhookConfig[]
  rules: RuleConfig[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/types.ts
git commit -m "feat: add configuration types"
```

---

## Task 7: Config Schema Validation

**Files:**
- Create: `src/config/schema.ts`

- [ ] **Step 1: Create config validation**

```typescript
// ABOUTME: Configuration validation logic
// ABOUTME: Validates YAML config structure and required fields

import type { AppConfig, AccountConfig, WebhookConfig, RuleConfig } from './types'

function validateAccount(account: unknown, index: number): AccountConfig {
  if (!account || typeof account !== 'object') {
    throw new Error(`Account ${index} must be an object`)
  }
  const acc = account as Record<string, unknown>
  
  if (!acc.name || typeof acc.name !== 'string') {
    throw new Error(`Account ${index}: name is required and must be string`)
  }
  if (!acc.host || typeof acc.host !== 'string') {
    throw new Error(`Account ${index}: host is required and must be string`)
  }
  if (!acc.port || typeof acc.port !== 'number') {
    throw new Error(`Account ${index}: port is required and must be number`)
  }
  if (!acc.username || typeof acc.username !== 'string') {
    throw new Error(`Account ${index}: username is required and must be string`)
  }
  if (!acc.password || typeof acc.password !== 'string') {
    throw new Error(`Account ${index}: password is required and must be string`)
  }
  
  const folders = acc.folders
  if (folders !== undefined && !Array.isArray(folders)) {
    throw new Error(`Account ${index}: folders must be an array`)
  }
  
  return {
    name: acc.name,
    host: acc.host,
    port: acc.port,
    username: acc.username,
    password: acc.password,
    folders: folders as string[] | undefined
  }
}

function validateWebhook(webhook: unknown, index: number): WebhookConfig {
  if (!webhook || typeof webhook !== 'object') {
    throw new Error(`Webhook ${index} must be an object`)
  }
  const wh = webhook as Record<string, unknown>
  
  if (!wh.name || typeof wh.name !== 'string') {
    throw new Error(`Webhook ${index}: name is required and must be string`)
  }
  if (!wh.url || typeof wh.url !== 'string') {
    throw new Error(`Webhook ${index}: url is required and must be string`)
  }
  if (!wh.template || typeof wh.template !== 'string') {
    throw new Error(`Webhook ${index}: template is required and must be string`)
  }
  
  return {
    name: wh.name,
    url: wh.url,
    method: wh.method as string | undefined,
    headers: wh.headers as Record<string, string> | undefined,
    timeout: wh.timeout as number | undefined,
    retry: wh.retry as WebhookRetryConfig | undefined,
    template: wh.template
  }
}

function validateRule(rule: unknown, index: number): RuleConfig {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Rule ${index} must be an object`)
  }
  const r = rule as Record<string, unknown>
  
  if (!r.name || typeof r.name !== 'string') {
    throw new Error(`Rule ${index}: name is required and must be string`)
  }
  if (!r.match || typeof r.match !== 'object') {
    throw new Error(`Rule ${index}: match is required and must be object`)
  }
  if (!r.webhooks || !Array.isArray(r.webhooks)) {
    throw new Error(`Rule ${index}: webhooks is required and must be array`)
  }
  
  return {
    name: r.name,
    enabled: r.enabled as boolean | undefined,
    match: r.match as MatchCondition,
    webhooks: r.webhooks as string[]
  }
}

export function validateConfig(config: unknown): AppConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object')
  }
  const c = config as Record<string, unknown>
  
  if (!c.accounts || !Array.isArray(c.accounts)) {
    throw new Error('accounts is required and must be an array')
  }
  if (!c.webhooks || !Array.isArray(c.webhooks)) {
    throw new Error('webhooks is required and must be an array')
  }
  if (!c.rules || !Array.isArray(c.rules)) {
    throw new Error('rules is required and must be an array')
  }
  
  const accounts = c.accounts.map((a, i) => validateAccount(a, i))
  const webhooks = c.webhooks.map((w, i) => validateWebhook(w, i))
  const rules = c.rules.map((r, i) => validateRule(r, i))
  
  const webhookNames = new Set(webhooks.map(w => w.name))
  for (const rule of rules) {
    for (const whName of rule.webhooks) {
      if (!webhookNames.has(whName)) {
        throw new Error(`Rule "${rule.name}" references unknown webhook "${whName}"`)
      }
    }
  }
  
  return {
    log_level: c.log_level as string | undefined,
    sync_interval: c.sync_interval as number | undefined,
    accounts,
    webhooks,
    rules
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat: add config validation logic"
```

---

## Task 8: Config Loader

**Files:**
- Create: `src/config/loader.ts`

- [ ] **Step 1: Create config loader**

```typescript
// ABOUTME: YAML configuration file loader
// ABOUTME: Loads, parses, validates and expands env vars in config

import yaml from 'js-yaml'
import { readFile } from 'fs/promises'
import { expandEnvVars } from '../utils/env'
import { validateConfig } from './schema'
import type { AppConfig } from './types'

function expandConfigEnvVars(config: Record<string, unknown>): Record<string, unknown> {
  function expandValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return expandEnvVars(value)
    }
    if (Array.isArray(value)) {
      return value.map(expandValue)
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = expandValue(v)
      }
      return result
    }
    return value
  }
  
  return expandValue(config) as Record<string, unknown>
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const content = await readFile(path, 'utf-8')
  const rawConfig = yaml.load(content) as Record<string, unknown>
  const expandedConfig = expandConfigEnvVars(rawConfig)
  return validateConfig(expandedConfig)
}

export function getDefaultFolders(): string[] {
  return ['INBOX']
}

export function getDefaultSyncInterval(): number {
  return 300
}

export function getDefaultLogLevel(): string {
  return 'info'
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: add config loader with env var expansion"
```

---

## Task 9: Storage Types

**Files:**
- Create: `src/storage/types.ts`

- [ ] **Step 1: Create storage types**

```typescript
// ABOUTME: Storage module type definitions
// ABOUTME: Defines types for database operations

import type { Email, WebhookLog, SyncState } from '../types'

export interface Database {
  init(): void
  saveEmail(email: Email): void
  getEmail(id: string): Email | null
  getSyncState(accountName: string, folder: string): SyncState | null
  saveSyncState(state: SyncState): void
  createWebhookLog(emailId: string, webhookName: string): number
  updateWebhookLog(id: number, status: string, attempts: number, error?: string): void
  getPendingWebhookLogs(): WebhookLog[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/types.ts
git commit -m "feat: add storage types"
```

---

## Task 10: Database Migrations

**Files:**
- Create: `src/storage/migrations.ts`

- [ ] **Step 1: Create migrations**

```typescript
// ABOUTME: SQLite database schema initialization
// ABOUTME: Creates tables for emails, webhook_logs, and sync_state

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    account_name TEXT NOT NULL,
    folder TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    from_name TEXT,
    to_addrs TEXT NOT NULL,
    subject TEXT,
    text TEXT,
    html TEXT,
    date TEXT NOT NULL,
    flags TEXT,
    attachments TEXT,
    synced_at TEXT NOT NULL,
    UNIQUE(account_name, folder, id)
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_name)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)`,
  
  `CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT NOT NULL,
    webhook_name TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_webhook_logs_email ON webhook_logs(email_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status)`,
  
  `CREATE TABLE IF NOT EXISTS sync_state (
    account_name TEXT NOT NULL,
    folder TEXT NOT NULL,
    last_uid TEXT NOT NULL,
    last_sync_at TEXT NOT NULL,
    PRIMARY KEY(account_name, folder)
  )`
]

export function runMigrations(db: unknown): void {
  const database = db as { exec: (sql: string) => void }
  for (const sql of MIGRATIONS) {
    database.exec(sql)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/migrations.ts
git commit -m "feat: add database migrations"
```

---

## Task 11: Database Operations

**Files:**
- Create: `src/storage/database.ts`

- [ ] **Step 1: Create database module**

```typescript
// ABOUTME: SQLite database connection and operations
// ABOUTME: Provides CRUD operations for emails, logs, and sync state

import Database from 'better-sqlite3'
import { runMigrations } from './migrations'
import type { Email, WebhookLog, SyncState } from '../types'
import type { Database as DatabaseInterface } from './types'

export class MailHooksDatabase implements DatabaseInterface {
  private db: Database.Database
  
  constructor(path: string) {
    this.db = new Database(path)
  }
  
  init(): void {
    runMigrations(this.db)
  }
  
  saveEmail(email: Email): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO emails (
        id, account_name, folder, from_addr, from_name, to_addrs,
        subject, text, html, date, flags, attachments, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      email.id,
      email.accountName,
      email.folder,
      email.fromAddr,
      email.fromName,
      JSON.stringify(email.toAddrs),
      email.subject,
      email.text,
      email.html,
      email.date,
      JSON.stringify(email.flags),
      JSON.stringify(email.attachments),
      email.syncedAt
    )
  }
  
  getEmail(id: string): Email | null {
    const stmt = this.db.prepare('SELECT * FROM emails WHERE id = ?')
    const row = stmt.get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return this.rowToEmail(row)
  }
  
  getSyncState(accountName: string, folder: string): SyncState | null {
    const stmt = this.db.prepare(
      'SELECT * FROM sync_state WHERE account_name = ? AND folder = ?'
    )
    const row = stmt.get(accountName, folder) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      accountName: row.account_name as string,
      folder: row.folder as string,
      lastUid: row.last_uid as string,
      lastSyncAt: row.last_sync_at as string
    }
  }
  
  saveSyncState(state: SyncState): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_state (
        account_name, folder, last_uid, last_sync_at
      ) VALUES (?, ?, ?, ?)
    `)
    stmt.run(state.accountName, state.folder, state.lastUid, state.lastSyncAt)
  }
  
  createWebhookLog(emailId: string, webhookName: string): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO webhook_logs (
        email_id, webhook_name, status, attempts, created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, ?)
    `)
    const result = stmt.run(emailId, webhookName, now, now)
    return result.lastInsertRowid as number
  }
  
  updateWebhookLog(id: number, status: string, attempts: number, error?: string): void {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      UPDATE webhook_logs 
      SET status = ?, attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(status, attempts, error ?? null, now, id)
  }
  
  getPendingWebhookLogs(): WebhookLog[] {
    const stmt = this.db.prepare(
      "SELECT * FROM webhook_logs WHERE status = 'pending'"
    )
    const rows = stmt.all() as Record<string, unknown>[]
    return rows.map(this.rowToWebhookLog)
  }
  
  private rowToEmail(row: Record<string, unknown>): Email {
    return {
      id: row.id as string,
      accountName: row.account_name as string,
      folder: row.folder as string,
      fromAddr: row.from_addr as string,
      fromName: row.from_name as string | null,
      toAddrs: JSON.parse(row.to_addrs as string),
      subject: row.subject as string | null,
      text: row.text as string | null,
      html: row.html as string | null,
      date: row.date as string,
      flags: JSON.parse(row.flags as string || '[]'),
      attachments: JSON.parse(row.attachments as string || '[]'),
      syncedAt: row.synced_at as string
    }
  }
  
  private rowToWebhookLog(row: Record<string, unknown>): WebhookLog {
    return {
      id: row.id as number,
      emailId: row.email_id as string,
      webhookName: row.webhook_name as string,
      status: row.status as 'pending' | 'success' | 'failed',
      attempts: row.attempts as number,
      lastError: row.last_error as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }
  
  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/database.ts
git commit -m "feat: add SQLite database operations"
```

---

## Task 12: IMAP Types

**Files:**
- Create: `src/imap/types.ts`

- [ ] **Step 1: Create IMAP types**

```typescript
// ABOUTME: IMAP module type definitions
// ABOUTME: Defines types for IMAP client and sync operations

import type Imap from 'imap'

export interface ImapConnectionOptions {
  user: string
  password: string
  host: string
  port: number
  tls: boolean
}

export interface ImapClientInterface {
  connect(): Promise<void>
  disconnect(): void
  openBox(folder: string): Promise<{ uidnext: number }>
  search(criteria: unknown[]): Promise<number[]>
  fetch(uids: number[], options: { bodies: string[] }): Promise<ImapMessage[]>
}

export interface ImapMessage {
  on(event: 'body', listener: (stream: NodeJS.ReadableStream, info: unknown) => void): void
  on(event: 'attributes', listener: (attrs: ImapAttributes) => void): void
  on(event: 'end', listener: () => void): void
}

export interface ImapAttributes {
  uid: number
  date: Date
  flags: string[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/imap/types.ts
git commit -m "feat: add IMAP types"
```

---

## Task 13: IMAP Email Parser

**Files:**
- Create: `src/imap/parser.ts`

- [ ] **Step 1: Create email parser**

```typescript
// ABOUTME: Parse raw IMAP email messages to structured format
// ABOUTME: Uses mailparser to extract email content

import { simpleParser } from 'mailparser'
import type { Email, Attachment } from '../types'

export interface ParsedEmail {
  fromAddr: string
  fromName: string | null
  toAddrs: string[]
  subject: string | null
  text: string | null
  html: string | null
  date: string
  attachments: Attachment[]
}

export async function parseEmail(raw: string): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw)
  
  const fromAddr = parsed.from?.value[0]?.address ?? ''
  const fromName = parsed.from?.value[0]?.name ?? null
  
  const toAddrs = parsed.to?.value.map(v => v.address) ?? []
  
  const attachments: Attachment[] = parsed.attachments.map(att => ({
    filename: att.filename ?? 'unknown',
    contentType: att.contentType,
    size: att.size
  }))
  
  return {
    fromAddr,
    fromName,
    toAddrs,
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    date: parsed.date?.toISOString() ?? new Date().toISOString(),
    attachments
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/imap/parser.ts
git commit -m "feat: add email parser using mailparser"
```

---

## Task 14: IMAP Client Wrapper

**Files:**
- Create: `src/imap/client.ts`

- [ ] **Step 1: Create IMAP client wrapper**

```typescript
// ABOUTME: IMAP connection wrapper with async operations
// ABOUTME: Provides promise-based interface for node-imap

import Imap from 'imap'
import type { Logger } from '../utils/logger'
import type { ImapConnectionOptions } from './types'

export class ImapClient {
  private imap: Imap
  private logger: Logger
  private connected: boolean = false
  
  constructor(options: ImapConnectionOptions, logger: Logger) {
    this.imap = new Imap({
      user: options.user,
      password: options.password,
      host: options.host,
      port: options.port,
      tls: options.tls,
      tlsOptions: { rejectUnauthorized: false }
    })
    this.logger = logger
  }
  
  async connect(): Promise<void> {
    if (this.connected) return
    
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        this.connected = true
        this.logger.info('Connected to IMAP server')
        resolve()
      })
      
      this.imap.once('error', (err: Error) => {
        this.logger.error({ err }, 'IMAP connection error')
        reject(err)
      })
      
      this.imap.connect()
    })
  }
  
  disconnect(): void {
    if (!this.connected) return
    this.imap.end()
    this.connected = false
    this.logger.info('Disconnected from IMAP server')
  }
  
  async openBox(folder: string): Promise<{ uidnext: number }> {
    return new Promise((resolve, reject) => {
      this.imap.openBox(folder, false, (err, box) => {
        if (err) {
          this.logger.error({ err, folder }, 'Failed to open folder')
          reject(err)
        } else {
          this.logger.info({ folder, uidnext: box.uidnext }, 'Opened folder')
          resolve({ uidnext: box.uidnext })
        }
      })
    })
  }
  
  async search(criteria: unknown[]): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.imap.search(criteria, (err, results) => {
        if (err) {
          reject(err)
        } else {
          resolve(results ?? [])
        }
      })
    })
  }
  
  fetch(uids: number[], bodies: string[]): Imap.Fetch {
    const source = { uid: true }
    const bodySource = uids.map(uid => uid.toString()).join(',')
    const fetcher = this.imap.fetch(bodySource, { bodies, source })
    return fetcher
  }
  
  getImap(): Imap {
    return this.imap
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/imap/client.ts
git commit -m "feat: add IMAP client wrapper"
```

---

## Task 15: IMAP Syncer

**Files:**
- Create: `src/imap/syncer.ts`

- [ ] **Step 1: Create IMAP syncer**

```typescript
// ABOUTME: Email synchronization logic for IMAP accounts
// ABOUTME: Fetches new emails and triggers processing pipeline

import type { Logger } from '../utils/logger'
import type { Database } from '../storage/types'
import type { AppConfig, AccountConfig } from '../config/types'
import type { Email } from '../types'
import { ImapClient } from './client'
import { parseEmail } from './parser'
import { getDefaultFolders } from '../config/loader'

export class EmailSyncer {
  private logger: Logger
  private db: Database
  private config: AppConfig
  private onEmail: ((email: Email) => void) | null = null
  
  constructor(db: Database, config: AppConfig, logger: Logger) {
    this.db = db
    this.config = config
    this.logger = logger.child({ module: 'syncer' })
  }
  
  setEmailHandler(handler: (email: Email) => void): void {
    this.onEmail = handler
  }
  
  async syncAccount(account: AccountConfig): Promise<void> {
    this.logger.info({ account: account.name }, 'Starting sync for account')
    
    const client = new ImapClient({
      user: account.username,
      password: account.password,
      host: account.host,
      port: account.port,
      tls: account.port === 993
    }, this.logger)
    
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
    const lastUid = syncState ? parseInt(syncState.lastUid, 10) : 0
    
    const criteria = ['UID', `${lastUid + 1}:*`]
    const uids = await client.search(criteria)
    
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
        
        if (this.onEmail) {
          this.onEmail(email)
        }
        
        this.db.saveSyncState({
          accountName,
          folder,
          lastUid: email.id,
          lastSyncAt: new Date().toISOString()
        })
      } catch (err) {
        this.logger.warn({ err, uid: message.uid }, 'Failed to process email')
      }
    }
  }
  
  private async *fetchMessages(fetcher: unknown): AsyncGenerator<{ uid: number; raw: string }> {
    const f = fetcher as { on: (event: string, cb: Function) => void }
    
    const messages: { uid: number; raw: string }[] = []
    
    f.on('message', (msg: unknown) => {
      const m = msg as { 
        on: (event: string, cb: Function) => void
        uid?: number
      }
      
      let raw = ''
      let uid = 0
      
      m.on('body', (stream: NodeJS.ReadableStream) => {
        stream.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8')
        })
      })
      
      m.on('attributes', (attrs: unknown) => {
        const a = attrs as { uid: number }
        uid = a.uid
      })
      
      m.on('end', () => {
        messages.push({ uid, raw })
      })
    })
    
    await new Promise<void>((resolve) => {
      f.on('end', () => resolve())
    })
    
    for (const msg of messages) {
      yield msg
    }
  }
  
  private async processMessage(
    message: { uid: number; raw: string },
    accountName: string,
    folder: string
  ): Promise<Email> {
    const parsed = await parseEmail(message.raw)
    
    return {
      id: message.uid.toString(),
      accountName,
      folder,
      fromAddr: parsed.fromAddr,
      fromName: parsed.fromName,
      toAddrs: parsed.toAddrs,
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.html,
      date: parsed.date,
      flags: [],
      attachments: parsed.attachments,
      syncedAt: new Date().toISOString()
    }
  }
  
  async syncAll(): Promise<void> {
    this.logger.info('Starting sync for all accounts')
    
    for (const account of this.config.accounts) {
      await this.syncAccount(account)
    }
    
    this.logger.info('Completed sync for all accounts')
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/imap/syncer.ts
git commit -m "feat: add email syncer"
```

---

## Task 16: Rule Types

**Files:**
- Create: `src/rules/types.ts`

- [ ] **Step 1: Create rule types**

```typescript
// ABOUTME: Rule engine type definitions
// ABOUTME: Defines types for rule matching and filtering

import type { RuleConfig } from '../config/types'

export interface MatchResult {
  matched: boolean
  rule: RuleConfig
}

export interface MatcherContext {
  fromAddr: string
  subject: string | null
  folder: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/rules/types.ts
git commit -m "feat: add rule types"
```

---

## Task 17: Rule Matcher

**Files:**
- Create: `src/rules/matcher.ts`

- [ ] **Step 1: Create matcher functions**

```typescript
// ABOUTME: Individual rule matching functions
// ABOUTME: Implements from, subject, folder, and wildcard matching

import type { MatchCondition } from '../config/types'
import type { MatcherContext } from './types'

export function matchWildcard(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) {
    return pattern.toLowerCase() === value.toLowerCase()
  }
  
  const parts = pattern.split('*')
  let remaining = value.toLowerCase()
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase()
    
    if (i === 0) {
      if (part && !remaining.startsWith(part)) {
        return false
      }
      remaining = remaining.slice(part.length)
    } else if (i === parts.length - 1) {
      if (part && !remaining.endsWith(part)) {
        return false
      }
    } else {
      const idx = remaining.indexOf(part)
      if (idx === -1) {
        return false
      }
      remaining = remaining.slice(idx + part.length)
    }
  }
  
  return true
}

export function matchFrom(patterns: string[], fromAddr: string): boolean {
  for (const pattern of patterns) {
    if (matchWildcard(pattern, fromAddr)) {
      return true
    }
  }
  return false
}

export function matchSubject(patterns: string[], subject: string | null): boolean {
  if (!subject) return false
  
  const lowerSubject = subject.toLowerCase()
  for (const pattern of patterns) {
    if (lowerSubject.includes(pattern.toLowerCase())) {
      return true
    }
  }
  return false
}

export function matchFolders(patterns: string[], folder: string): boolean {
  for (const pattern of patterns) {
    if (matchWildcard(pattern, folder)) {
      return true
    }
  }
  return false
}

export function matchCondition(condition: MatchCondition, ctx: MatcherContext): boolean {
  if (condition.catch_all) {
    return true
  }
  
  let matched = true
  
  if (condition.from && condition.from.length > 0) {
    matched = matched && matchFrom(condition.from, ctx.fromAddr)
  }
  
  if (condition.subject && condition.subject.length > 0) {
    matched = matched && matchSubject(condition.subject, ctx.subject)
  }
  
  if (condition.folders && condition.folders.length > 0) {
    matched = matched && matchFolders(condition.folders, ctx.folder)
  }
  
  return matched
}
```

- [ ] **Step 2: Commit**

```bash
git add src/rules/matcher.ts
git commit -m "feat: add rule matcher functions"
```

---

## Task 18: Rule Engine

**Files:**
- Create: `src/rules/engine.ts`

- [ ] **Step 1: Create rule engine**

```typescript
// ABOUTME: Rule matching engine for email filtering
// ABOUTME: Applies rules in order to determine webhook targets

import type { Logger } from '../utils/logger'
import type { AppConfig, RuleConfig } from '../config/types'
import type { Email } from '../types'
import type { MatchResult } from './types'
import { matchCondition } from './matcher'

export class RuleEngine {
  private config: AppConfig
  private logger: Logger
  
  constructor(config: AppConfig, logger: Logger) {
    this.config = config
    this.logger = logger.child({ module: 'rules' })
  }
  
  match(email: Email): MatchResult | null {
    const ctx = {
      fromAddr: email.fromAddr,
      subject: email.subject,
      folder: email.folder
    }
    
    for (const rule of this.config.rules) {
      if (rule.enabled === false) {
        continue
      }
      
      if (matchCondition(rule.match, ctx)) {
        this.logger.info({ 
          emailId: email.id, 
          rule: rule.name 
        }, 'Email matched rule')
        
        return { matched: true, rule }
      }
    }
    
    this.logger.info({ emailId: email.id }, 'Email did not match any rule')
    return null
  }
  
  getWebhooksForRule(rule: RuleConfig): string[] {
    return rule.webhooks
  }
  
  getWebhookConfigs(names: string[]): Map<string, unknown> {
    const result = new Map<string, unknown>()
    
    for (const name of names) {
      const webhook = this.config.webhooks.find(w => w.name === name)
      if (webhook) {
        result.set(name, webhook)
      }
    }
    
    return result
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/rules/engine.ts
git commit -m "feat: add rule engine"
```

---

## Task 19: Webhook Types

**Files:**
- Create: `src/webhooks/types.ts`

- [ ] **Step 1: Create webhook types**

```typescript
// ABOUTME: Webhook module type definitions
// ABOUTME: Defines types for webhook sending and retry

export interface WebhookSendResult {
  success: boolean
  attempts: number
  lastError?: string
}

export interface WebhookOptions {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  timeout: number
  retryCount: number
  retryDelay: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webhooks/types.ts
git commit -m "feat: add webhook types"
```

---

## Task 20: Webhook Retry Logic

**Files:**
- Create: `src/webhooks/retry.ts`

- [ ] **Step 1: Create retry utility**

```typescript
// ABOUTME: Retry logic for webhook sending
// ABOUTME: Implements configurable retry with delay

export async function retry<T>(
  fn: () => Promise<T>,
  count: number,
  delay: number
): Promise<{ success: boolean; result?: T; attempts: number; lastError?: string }> {
  let attempts = 0
  let lastError: string | undefined
  
  while (attempts < count) {
    attempts++
    
    try {
      const result = await fn()
      return { success: true, result, attempts }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      
      if (attempts < count) {
        await sleep(delay * 1000)
      }
    }
  }
  
  return { success: false, attempts, lastError }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webhooks/retry.ts
git commit -m "feat: add webhook retry logic"
```

---

## Task 21: Webhook Sender

**Files:**
- Create: `src/webhooks/sender.ts`

- [ ] **Step 1: Create webhook sender**

```typescript
// ABOUTME: HTTP webhook sender with retry support
// ABOUTME: Sends templated payloads to target endpoints

import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email } from '../types'
import type { Database } from '../storage/types'
import { compileTemplate } from '../utils/template'
import { retry } from './retry'

export class WebhookSender {
  private db: Database
  private logger: Logger
  private templates: Map<string, (email: Email) => string>
  
  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger.child({ module: 'webhook' })
    this.templates = new Map()
  }
  
  registerTemplate(name: string, template: string): void {
    this.templates.set(name, compileTemplate(template))
  }
  
  async send(webhook: WebhookConfig, email: Email): Promise<void> {
    const templateFn = this.templates.get(webhook.name)
    if (!templateFn) {
      this.logger.error({ webhook: webhook.name }, 'Template not registered')
      return
    }
    
    const body = templateFn(email)
    const logId = this.db.createWebhookLog(email.id, webhook.name)
    
    const method = webhook.method ?? 'POST'
    const headers = webhook.headers ?? {}
    const timeout = webhook.timeout ?? 10
    const retryCount = webhook.retry?.count ?? 3
    const retryDelay = webhook.retry?.delay ?? 5
    
    this.logger.info({ webhook: webhook.name, emailId: email.id }, 'Sending webhook')
    
    const result = await retry(
      () => this.makeRequest(webhook.url, method, headers, body, timeout),
      retryCount,
      retryDelay
    )
    
    if (result.success) {
      this.db.updateWebhookLog(logId, 'success', result.attempts)
      this.logger.info({ webhook: webhook.name, attempts: result.attempts }, 'Webhook sent')
    } else {
      this.db.updateWebhookLog(logId, 'failed', result.attempts, result.lastError)
      this.logger.error({ 
        webhook: webhook.name, 
        attempts: result.attempts,
        error: result.lastError 
      }, 'Webhook failed')
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

- [ ] **Step 2: Commit**

```bash
git add src/webhooks/sender.ts
git commit -m "feat: add webhook sender"
```

---

## Task 22: Main Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create main entry point**

```typescript
// ABOUTME: MailHooks entry point and orchestration
// ABOUTME: Coordinates config, storage, syncer, rules, and webhooks

import { getEnv, getEnvNumber } from './utils/env'
import { createLogger, type LogLevel } from './utils/logger'
import { loadConfig, getDefaultSyncInterval, getDefaultLogLevel } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { EmailSyncer } from './imap/syncer'
import { RuleEngine } from './rules/engine'
import { WebhookSender } from './webhooks/sender'
import type { Email } from './types'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logger = createLogger(logLevel)
  
  const syncInterval = config.sync_interval ?? getDefaultSyncInterval()
  
  logger.info('Starting MailHooks')
  logger.info({ configPath, databasePath, syncInterval }, 'Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const syncer = new EmailSyncer(db, config, logger)
  const ruleEngine = new RuleEngine(config, logger)
  const webhookSender = new WebhookSender(db, logger)
  
  for (const webhook of config.webhooks) {
    webhookSender.registerTemplate(webhook.name, webhook.template)
  }
  
  syncer.setEmailHandler(async (email: Email) => {
    const match = ruleEngine.match(email)
    
    if (!match) {
      return
    }
    
    const webhookNames = ruleEngine.getWebhooksForRule(match.rule)
    
    if (webhookNames.length === 0) {
      return
    }
    
    const webhookConfigs = ruleEngine.getWebhookConfigs(webhookNames)
    
    for (const [name, wh] of webhookConfigs) {
      await webhookSender.send(wh as WebhookConfig, email)
    }
  })
  
  logger.info('Starting initial sync')
  await syncer.syncAll()
  
  logger.info({ interval: syncInterval }, 'Starting sync loop')
  
  while (true) {
    await sleep(syncInterval * 1000)
    await syncer.syncAll()
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

- [ ] **Step 2: Import WebhookConfig type fix**

Update `src/index.ts` to add import:

```typescript
import type { WebhookConfig } from './config/types'
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add main entry point"
```

---

## Task 23: Example Configuration

**Files:**
- Create: `config.example.yaml`

- [ ] **Step 1: Create example config**

```yaml
# MailHooks Configuration Example
# Copy this file to config.yaml and modify as needed

# Log level: debug/info/warn/error
log_level: info

# Sync interval in seconds
sync_interval: 300

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

# Webhook endpoints
webhooks:
  - name: "telegram"
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
        "text": "📧 New Email\nFrom: {{from_name}} <{{from_addr}}>\nSubject: {{subject}}\n\n{{text}}"
      }
      
  - name: "custom"
    url: "https://your-server.com/webhook"
    method: "POST"
    headers:
      Authorization: "Bearer ${WEBHOOK_TOKEN}"
    timeout: 10
    retry:
      count: 3
      delay: 5
    template: |
      {
        "email_id": "{{id}}",
        "from": "{{from_addr}}",
        "subject": "{{subject}}",
        "body": "{{text}}"
      }

# Email filtering rules (matched in order)
rules:
  - name: "urgent"
    enabled: true
    match:
      from:
        - "boss@company.com"
        - "*@urgent.com"
      subject:
        - "urgent"
        - "紧急"
        - "URGENT"
    webhooks:
      - "telegram"
      - "custom"
      
  - name: "newsletter-block"
    enabled: true
    match:
      from:
        - "noreply@*"
        - "*@newsletter.com"
    webhooks: []
      
  - name: "catch-all"
    enabled: true
    match:
      catch_all: true
    webhooks:
      - "telegram"
```

- [ ] **Step 2: Commit**

```bash
git add config.example.yaml
git commit -m "docs: add example configuration file"
```

---

## Task 24: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create Dockerfile**

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
ENV CONFIG_PATH=/app/config/config.yaml
ENV DATABASE_PATH=/app/data/mailhooks.db

CMD ["bun", "run", "dist/index.js"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile"
```

---

## Task 25: Docker Compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

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
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - SYNC_INTERVAL=${SYNC_INTERVAL:-300}
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose configuration"
```

---

## Task 26: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Task 27: Final Verification

- [ ] **Step 1: Run TypeScript check**

Run: `bun run build`

Expected: Build succeeds without errors

- [ ] **Step 2: Create test config and verify startup**

Create a minimal test config:

```yaml
log_level: debug
sync_interval: 60
accounts:
  - name: "test"
    host: "imap.example.com"
    port: 993
    username: "test@example.com"
    password: "testpass"
webhooks:
  - name: "test-webhook"
    url: "http://localhost:9999/webhook"
    template: '{"id": "{{id}}"}'
rules:
  - name: "catch-all"
    match:
      catch_all: true
    webhooks: ["test-webhook"]
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete MailHooks implementation"
```