// ABOUTME: SQLite database connection and operations
// ABOUTME: Provides CRUD operations for emails, logs, and sync state

import { Database } from 'bun:sqlite'
import { runMigrations } from './migrations'
import type { Email, WebhookLog, SyncState } from '../types'
import type { Database as DatabaseInterface } from './types'

export class MailHooksDatabase implements DatabaseInterface {
  private db: Database
  
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