import Database from "better-sqlite3";

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(
    `CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_address TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  );

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_queue_status_retry ON queue(status, next_retry_at)`,
  );

  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}
