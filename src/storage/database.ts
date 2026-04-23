// ABOUTME: SQLite database connection and operations
// ABOUTME: Provides CRUD operations for emails, logs, and sync state

import { Database } from 'bun:sqlite'
import { runMigrations } from './migrations'
import type { Email, WebhookLog, SyncState } from '../types'
import type { Database as DatabaseInterface, QueueItem, QueueCreateInput } from './types'

export class MailHooksDatabase implements DatabaseInterface {
  private db: Database
  private enqueueFn: ((email: Email, queueInput: QueueCreateInput, syncState: SyncState) => void) | null = null
  
  constructor(path: string) {
    this.db = new Database(path)
  }
  
  init(): void {
    runMigrations(this.db)
    
    const saveEmailStmt = this.db.prepare(`
      INSERT OR REPLACE INTO emails (
        id, account_name, folder, from_addr, from_name, to_addrs,
        subject, text, html, date, flags, attachments, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    const createQueueStmt = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_queue (
        email_id, account_name, folder, status, attempts, 
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
    `)
    
    const saveSyncStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_state (
        account_name, folder, last_uid, last_sync_at
      ) VALUES (?, ?, ?, ?)
    `)
    
    this.enqueueFn = this.db.transaction((email: Email, queueInput: QueueCreateInput, syncState: SyncState) => {
      saveEmailStmt.run(
        email.id, email.accountName, email.folder, email.fromAddr, email.fromName,
        JSON.stringify(email.toAddrs), email.subject, email.text, email.html,
        email.date, JSON.stringify(email.flags), JSON.stringify(email.attachments), email.syncedAt
      )
      
      const now = new Date().toISOString()
      createQueueStmt.run(
        queueInput.emailId, queueInput.accountName, queueInput.folder,
        now, now, queueInput.expiresAt
      )
      
      saveSyncStmt.run(
        syncState.accountName, syncState.folder, syncState.lastUid, syncState.lastSyncAt
      )
    })
  }
  
  enqueueEmail(email: Email, queueInput: QueueCreateInput, syncState: SyncState): void {
    if (!this.enqueueFn) {
      throw new Error('Database not initialized')
    }
    this.enqueueFn(email, queueInput, syncState)
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
  
  getEmailsByAccount(accountName: string): Email[] {
    const stmt = this.db.prepare('SELECT * FROM emails WHERE account_name = ? ORDER BY date DESC')
    const rows = stmt.all(accountName) as Record<string, unknown>[]
    return rows.map(this.rowToEmail)
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
  
  claimQueueItems(limit: number): QueueItem[] {
    const now = new Date().toISOString()
    
    const updateStmt = this.db.prepare(`
      UPDATE webhook_queue 
      SET status = 'processing', updated_at = ?
      WHERE id IN (
        SELECT id FROM webhook_queue 
        WHERE status = 'pending' AND expires_at > ?
        ORDER BY created_at ASC 
        LIMIT ?
      )
    `)
    
    updateStmt.run(now, now, limit)
    
    const selectStmt = this.db.prepare(`
      SELECT * FROM webhook_queue 
      WHERE status = 'processing' AND updated_at = ?
      ORDER BY created_at ASC
    `)
    
    const rows = selectStmt.all(now) as Record<string, unknown>[]
    return rows.map(this.rowToQueueItem.bind(this))
  }
  
  getPendingQueueItems(limit: number): QueueItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM webhook_queue 
      WHERE status = 'pending' AND expires_at > ?
      ORDER BY created_at ASC LIMIT ?
    `)
    const rows = stmt.all(new Date().toISOString(), limit) as Record<string, unknown>[]
    return rows.map(this.rowToQueueItem.bind(this))
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