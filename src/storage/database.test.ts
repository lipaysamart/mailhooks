// ABOUTME: Tests for SQLite database operations
// ABOUTME: Provides CRUD operations for emails, logs, and sync state

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MailHooksDatabase } from './database'
import type { Email, SyncState } from '../types'

describe('MailHooksDatabase', () => {
  let db: MailHooksDatabase
  const testDbPath = ':memory:'

  beforeEach(() => {
    db = new MailHooksDatabase(testDbPath)
    db.init()
  })

  afterEach(() => {
    db.close()
  })

  describe('emails', () => {
    const testEmail: Email = {
      id: '123',
      accountName: 'gmail',
      folder: 'INBOX',
      fromAddr: 'sender@example.com',
      fromName: 'Sender Name',
      toAddrs: ['recipient@example.com'],
      subject: 'Test Subject',
      text: 'Test body',
      html: '<p>Test body</p>',
      date: '2024-01-01T00:00:00Z',
      flags: ['\\Seen'],
      attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', size: 1000 }],
      syncedAt: '2024-01-02T00:00:00Z'
    }

    test('saveEmail and getEmail', () => {
      db.saveEmail(testEmail)
      const retrieved = db.getEmail('123')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('123')
      expect(retrieved!.accountName).toBe('gmail')
      expect(retrieved!.folder).toBe('INBOX')
      expect(retrieved!.fromAddr).toBe('sender@example.com')
      expect(retrieved!.fromName).toBe('Sender Name')
      expect(retrieved!.toAddrs).toEqual(['recipient@example.com'])
      expect(retrieved!.subject).toBe('Test Subject')
      expect(retrieved!.text).toBe('Test body')
      expect(retrieved!.html).toBe('<p>Test body</p>')
      expect(retrieved!.date).toBe('2024-01-01T00:00:00Z')
      expect(retrieved!.flags).toEqual(['\\Seen'])
      expect(retrieved!.attachments).toEqual([{ filename: 'doc.pdf', contentType: 'application/pdf', size: 1000 }])
      expect(retrieved!.syncedAt).toBe('2024-01-02T00:00:00Z')
    })

    test('getEmail returns null for non-existent email', () => {
      const retrieved = db.getEmail('nonexistent')
      expect(retrieved).toBeNull()
    })

    test('saveEmail replaces existing email', () => {
      db.saveEmail(testEmail)
      const updatedEmail = { ...testEmail, subject: 'Updated Subject' }
      db.saveEmail(updatedEmail)
      const retrieved = db.getEmail('123')
      expect(retrieved!.subject).toBe('Updated Subject')
    })

    test('saveEmail handles null fields', () => {
      const emailWithNulls: Email = {
        id: '456',
        accountName: 'gmail',
        folder: 'INBOX',
        fromAddr: 'sender@example.com',
        fromName: null,
        toAddrs: ['recipient@example.com'],
        subject: null,
        text: null,
        html: null,
        date: '2024-01-01T00:00:00Z',
        flags: [],
        attachments: [],
        syncedAt: '2024-01-02T00:00:00Z'
      }
      db.saveEmail(emailWithNulls)
      const retrieved = db.getEmail('456')
      expect(retrieved!.fromName).toBeNull()
      expect(retrieved!.subject).toBeNull()
      expect(retrieved!.text).toBeNull()
      expect(retrieved!.html).toBeNull()
      expect(retrieved!.flags).toEqual([])
      expect(retrieved!.attachments).toEqual([])
    })
  })

  describe('sync state', () => {
    const testState: SyncState = {
      accountName: 'gmail',
      folder: 'INBOX',
      lastUid: '1000',
      lastSyncAt: '2024-01-01T00:00:00Z'
    }

    test('saveSyncState and getSyncState', () => {
      db.saveSyncState(testState)
      const retrieved = db.getSyncState('gmail', 'INBOX')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.accountName).toBe('gmail')
      expect(retrieved!.folder).toBe('INBOX')
      expect(retrieved!.lastUid).toBe('1000')
      expect(retrieved!.lastSyncAt).toBe('2024-01-01T00:00:00Z')
    })

    test('getSyncState returns null for non-existent state', () => {
      const retrieved = db.getSyncState('nonexistent', 'INBOX')
      expect(retrieved).toBeNull()
    })

    test('saveSyncState replaces existing state', () => {
      db.saveSyncState(testState)
      const updatedState = { ...testState, lastUid: '2000' }
      db.saveSyncState(updatedState)
      const retrieved = db.getSyncState('gmail', 'INBOX')
      expect(retrieved!.lastUid).toBe('2000')
    })

    test('handles different folders', () => {
      db.saveSyncState(testState)
      db.saveSyncState({
        accountName: 'gmail',
        folder: 'Sent',
        lastUid: '500',
        lastSyncAt: '2024-01-01T00:00:00Z'
      })
      const inboxState = db.getSyncState('gmail', 'INBOX')
      const sentState = db.getSyncState('gmail', 'Sent')
      expect(inboxState!.lastUid).toBe('1000')
      expect(sentState!.lastUid).toBe('500')
    })

    test('handles different accounts', () => {
      db.saveSyncState(testState)
      db.saveSyncState({
        accountName: 'outlook',
        folder: 'INBOX',
        lastUid: '300',
        lastSyncAt: '2024-01-01T00:00:00Z'
      })
      const gmailState = db.getSyncState('gmail', 'INBOX')
      const outlookState = db.getSyncState('outlook', 'INBOX')
      expect(gmailState!.lastUid).toBe('1000')
      expect(outlookState!.lastUid).toBe('300')
    })
  })

  describe('queue', () => {
    const testEmail: Email = {
      id: '123',
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

    beforeEach(() => {
      db.saveEmail(testEmail)
    })

    test('createQueueItem and getPendingQueueItems', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      expect(items.length).toBe(1)
      expect(items[0].emailId).toBe('123')
      expect(items[0].accountName).toBe('gmail')
      expect(items[0].folder).toBe('INBOX')
      expect(items[0].status).toBe('pending')
      expect(items[0].attempts).toBe(0)
    })

    test('createQueueItem ignores duplicate', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      expect(items.length).toBe(1)
    })

    test('markQueueProcessing', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      db.markQueueProcessing(items[0].id)
      const pending = db.getPendingQueueItems(10)
      expect(pending.length).toBe(0)
    })

    test('markQueueSuccess', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      db.markQueueProcessing(items[0].id)
      db.markQueueSuccess(items[0].id)
      const pending = db.getPendingQueueItems(10)
      expect(pending.length).toBe(0)
    })

    test('markQueuePending increments attempts', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      db.markQueueProcessing(items[0].id)
      db.markQueuePending(items[0].id, 'Connection failed')
      const pending = db.getPendingQueueItems(10)
      expect(pending.length).toBe(1)
      expect(pending[0].attempts).toBe(1)
      expect(pending[0].lastError).toBe('Connection failed')
    })

    test('markQueueExpired', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      db.markQueueProcessing(items[0].id)
      db.markQueueExpired(items[0].id, 'Timeout')
      const pending = db.getPendingQueueItems(10)
      expect(pending.length).toBe(0)
    })

    test('getPendingQueueItems respects limit', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      for (let i = 1; i <= 5; i++) {
        db.saveEmail({ ...testEmail, id: `email-${i}` })
        db.createQueueItem({
          emailId: `email-${i}`,
          accountName: 'gmail',
          folder: 'INBOX',
          expiresAt
        })
      }
      const items = db.getPendingQueueItems(3)
      expect(items.length).toBe(3)
    })

    test('getPendingQueueItems excludes expired items', () => {
      const pastExpiresAt = new Date(Date.now() - 1000).toISOString()
      db.saveEmail({ ...testEmail, id: 'expired-email' })
      db.createQueueItem({
        emailId: 'expired-email',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt: pastExpiresAt
      })
      const items = db.getPendingQueueItems(10)
      expect(items.length).toBe(0)
    })

    test('cleanupQueue removes old completed items', () => {
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      db.createQueueItem({
        emailId: '123',
        accountName: 'gmail',
        folder: 'INBOX',
        expiresAt
      })
      const items = db.getPendingQueueItems(10)
      db.markQueueProcessing(items[0].id)
      db.markQueueSuccess(items[0].id)
      db.cleanupQueue(0)
      const pending = db.getPendingQueueItems(10)
      expect(pending.length).toBe(0)
    })
  })

  describe('webhook logs', () => {
    test('createWebhookLog', () => {
      const id = db.createWebhookLog('email-123', 'telegram')
      expect(id).toBeGreaterThan(0)
    })

    test('updateWebhookLog', () => {
      const id = db.createWebhookLog('email-123', 'telegram')
      db.updateWebhookLog(id, 'success', 1)
      const logs = db.getPendingWebhookLogs()
      expect(logs.length).toBe(0)
    })

    test('getPendingWebhookLogs', () => {
      db.createWebhookLog('email-1', 'telegram')
      db.createWebhookLog('email-2', 'slack')
      const logs = db.getPendingWebhookLogs()
      expect(logs.length).toBe(2)
      expect(logs.every(l => l.status === 'pending')).toBe(true)
    })
  })
})