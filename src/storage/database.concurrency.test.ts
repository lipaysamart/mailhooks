// ABOUTME: Concurrency safety tests for SQLite database
// ABOUTME: Tests WAL mode, busy_timeout, atomic operations, and race conditions

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MailHooksDatabase } from './database'
import { runMigrations } from './migrations'
import { Database } from 'bun:sqlite'
import { unlinkSync, existsSync } from 'fs'
import type { Email, SyncState, QueueItem } from '../types'

function cleanupDb(path: string) {
  if (existsSync(path)) unlinkSync(path)
  if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`)
  if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`)
}

describe('Concurrency Safety', () => {
  describe('SQLite Configuration', () => {
    const walTestDb = './data/test-wal.db'
    
    afterEach(() => {
      cleanupDb(walTestDb)
    })

    test('WAL mode enabled', () => {
      const db = new Database(walTestDb)
      runMigrations(db)
      const result = db.query('PRAGMA journal_mode').get() as { journal_mode: string }
      expect(result.journal_mode.toLowerCase()).toBe('wal')
      db.close()
    })

    test('busy_timeout set to 5000ms', () => {
      const db = new Database(walTestDb)
      runMigrations(db)
      const result = db.query('PRAGMA busy_timeout').get() as { timeout: number }
      expect(result.timeout).toBe(5000)
      db.close()
    })
  })

  describe('enqueueEmail Transaction', () => {
    const enqueueTestDb = './data/test-enqueue.db'
    let db: MailHooksDatabase

    beforeEach(() => {
      cleanupDb(enqueueTestDb)
      db = new MailHooksDatabase(enqueueTestDb)
      db.init()
    })

    afterEach(() => {
      db.close()
      cleanupDb(enqueueTestDb)
    })

    const testEmail: Email = {
      id: 'email-1',
      accountName: 'gmail',
      folder: 'INBOX',
      fromAddr: 'sender@example.com',
      fromName: 'Sender',
      toAddrs: ['recipient@example.com'],
      subject: 'Test',
      text: 'Body',
      html: null,
      date: '2024-01-01T00:00:00Z',
      flags: [],
      attachments: [],
      syncedAt: '2024-01-02T00:00:00Z'
    }

    test('enqueueEmail saves email, queue item, and sync state atomically', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const syncState: SyncState = {
        accountName: 'gmail',
        folder: 'INBOX',
        lastUid: 'email-1',
        lastSyncAt: new Date().toISOString()
      }

      db.enqueueEmail(testEmail, {
        emailId: testEmail.id,
        accountName: testEmail.accountName,
        folder: testEmail.folder,
        expiresAt
      }, syncState)

      expect(db.getEmail('email-1')).not.toBeNull()
      const items = db.claimQueueItems(10)
      expect(items.length).toBe(1)
      expect(items[0].emailId).toBe('email-1')
      
      const state = db.getSyncState('gmail', 'INBOX')
      expect(state).not.toBeNull()
      expect(state!.lastUid).toBe('email-1')
    })
  })

  describe('claimQueueItems Atomic Operation', () => {
    const claimTestDb = './data/test-claim.db'
    let db: MailHooksDatabase

    beforeEach(() => {
      cleanupDb(claimTestDb)
      db = new MailHooksDatabase(claimTestDb)
      db.init()
      
      for (let i = 1; i <= 5; i++) {
        const email: Email = {
          id: `email-${i}`,
          accountName: 'gmail',
          folder: 'INBOX',
          fromAddr: 'sender@example.com',
          fromName: 'Sender',
          toAddrs: ['recipient@example.com'],
          subject: `Test ${i}`,
          text: 'Body',
          html: null,
          date: '2024-01-01T00:00:00Z',
          flags: [],
          attachments: [],
          syncedAt: '2024-01-02T00:00:00Z'
        }
        db.saveEmail(email)
        db.createQueueItem({
          emailId: `email-${i}`,
          accountName: 'gmail',
          folder: 'INBOX',
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
        })
      }
    })

    afterEach(() => {
      db.close()
      cleanupDb(claimTestDb)
    })

    test('claimQueueItems marks items as processing', () => {
      const items = db.claimQueueItems(3)
      expect(items.length).toBe(3)
      expect(items.every(i => i.status === 'processing')).toBe(true)
    })

    test('claimQueueItems respects limit', async () => {
      const items1 = db.claimQueueItems(2)
      expect(items1.length).toBe(2)
      
      await new Promise(r => setTimeout(r, 10))
      
      const items2 = db.claimQueueItems(2)
      expect(items2.length).toBe(2)
      
      await new Promise(r => setTimeout(r, 10))
      
      const items3 = db.claimQueueItems(10)
      expect(items3.length).toBe(1)
    })

    test('claimQueueItems prevents double-claim', async () => {
      const items1 = db.claimQueueItems(5)
      expect(items1.length).toBe(5)
      
      await new Promise(r => setTimeout(r, 10))
      
      const items2 = db.claimQueueItems(5)
      expect(items2.length).toBe(0)
    })

    test('claimQueueItems returns items in order', async () => {
      const items = db.claimQueueItems(5)
      expect(items[0].emailId).toBe('email-1')
      expect(items[1].emailId).toBe('email-2')
      expect(items[2].emailId).toBe('email-3')
    })

    test('claimQueueItems excludes expired items', async () => {
      const pastExpires = new Date(Date.now() - 1000).toISOString()
      db.saveEmail({
        id: 'email-expired',
        accountName: 'gmail',
        folder: 'INBOX',
        fromAddr: 'sender@example.com',
        fromName: 'Sender',
        toAddrs: ['recipient@example.com'],
        subject: 'Expired',
        text: 'Body',
        html: null,
        date: '2024-01-01T00:00:00Z',
        flags: [],
        attachments: [],
        syncedAt: '2024-01-02T00:00:00Z'
      })
      db.createQueueItem({
        emailId: 'email-expired',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt: pastExpires
      })
      
      await new Promise(r => setTimeout(r, 10))
      
      const items = db.claimQueueItems(10)
      expect(items.find(i => i.emailId === 'email-expired')).toBeUndefined()
    })

    test('claimed items can be marked as success', async () => {
      const items = db.claimQueueItems(3)
      for (const item of items) {
        db.markQueueSuccess(item.id)
      }
      
      await new Promise(r => setTimeout(r, 10))
      
      const pending = db.claimQueueItems(10)
      expect(pending.length).toBe(2)
    })

    test('claimed items can be marked as pending again', async () => {
      const items = db.claimQueueItems(2)
      for (const item of items) {
        db.markQueuePending(item.id, 'Retry needed')
      }
      
      await new Promise(r => setTimeout(r, 10))
      
      const reclaimed = db.claimQueueItems(10)
      expect(reclaimed.length).toBe(5)
      expect(reclaimed[0].attempts).toBe(1)
      expect(reclaimed[0].lastError).toBe('Retry needed')
    })
  })

  describe('Multi-Consumer Race Condition', () => {
    const raceTestDb = './data/test-race.db'
    
    afterEach(() => {
      cleanupDb(raceTestDb)
    })

    test('simulated concurrent consumers claim different items', async () => {
      const db = new MailHooksDatabase(raceTestDb)
      db.init()
      
      for (let i = 1; i <= 10; i++) {
        const email: Email = {
          id: `race-email-${i}`,
          accountName: 'gmail',
          folder: 'INBOX',
          fromAddr: 'sender@example.com',
          fromName: 'Sender',
          toAddrs: ['recipient@example.com'],
          subject: `Race Test ${i}`,
          text: 'Body',
          html: null,
          date: '2024-01-01T00:00:00Z',
          flags: [],
          attachments: [],
          syncedAt: '2024-01-02T00:00:00Z'
        }
        db.saveEmail(email)
        db.createQueueItem({
          emailId: `race-email-${i}`,
          accountName: 'gmail',
          folder: 'INBOX',
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
        })
      }
      
      const results: QueueItem[][] = []
      for (let i = 0; i < 3; i++) {
        results.push(db.claimQueueItems(5))
        await new Promise(r => setTimeout(r, 10))
      }
      
      const allClaimedIds = results.flat().map(i => i.id)
      const uniqueIds = new Set(allClaimedIds)
      
      expect(uniqueIds.size).toBe(10)
      expect(results[0].length + results[1].length + results[2].length).toBe(10)
      
      db.close()
    })
  })
})