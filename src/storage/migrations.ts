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
  )`,
  
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

export function runMigrations(db: unknown): void {
  const database = db as { exec: (sql: string) => void }
  
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA busy_timeout = 5000')
  
  for (const sql of MIGRATIONS) {
    database.exec(sql)
  }
}