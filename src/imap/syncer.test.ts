// ABOUTME: Tests for email synchronization logic
// ABOUTME: Validates UID tracking and new email detection

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { EmailSyncer, type ImapClientFactory } from './syncer'
import { MailHooksDatabase } from '../storage/database'
import { createLogger } from '../utils/logger'
import type { AppConfig } from '../config/types'
import type { ImapClient } from './client'

function createMockClient(
  openBoxResult: { uidnext: number },
  searchResult: number[],
  fetchResult?: Array<{ uid: number; raw: string }>
): ImapClient {
  let fetchMessages = fetchResult ?? []
  
  return {
    connect: async () => {},
    disconnect: () => {},
    openBox: async (folder: string) => openBoxResult,
    search: async (criteria: unknown[]) => searchResult,
    fetch: (uids: number[], options: { bodies: string[] }) => {
      const messages = fetchMessages.filter(m => uids.includes(m.uid))
      let messageIndex = 0
      
      return {
        on: (event: string, cb: Function) => {
          if (event === 'message') {
            for (const msg of messages) {
              const m = {
                on: (e: string, callback: Function) => {
                  if (e === 'body') {
                    callback({
                      on: (ev: string, c: Function) => {
                        if (ev === 'data') c(Buffer.from(msg.raw))
                        if (ev === 'end') c()
                      }
                    })
                  }
                  if (e === 'attributes') callback({ uid: msg.uid })
                  if (e === 'end') callback()
                }
              }
              cb(m)
            }
          }
          if (event === 'end') cb()
        }
      }
    }
  } as ImapClient
}

describe('EmailSyncer', () => {
  let db: MailHooksDatabase
  let logger: ReturnType<typeof createLogger>
  let config: AppConfig

  beforeEach(() => {
    db = new MailHooksDatabase(':memory:')
    db.init()
    logger = createLogger('debug', 'json')
    config = {
      accounts: [{
        name: 'gmail',
        host: 'imap.gmail.com',
        port: 993,
        username: 'test@gmail.com',
        password: 'test',
        folders: ['INBOX']
      }],
      webhook: {
        url: 'https://test.com/webhook',
        method: 'POST',
        headers: {},
        timeout: 10
      },
      sync_interval: 300,
      poll_interval: 30,
      expires_hours: 24
    }
  })

  afterEach(() => {
    db.close()
  })

  describe('UID tracking bug', () => {
    test('detects new email when UID equals previously saved uidnext', async () => {
      const mockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 8451 },
          [8450, 8451]
        )
      }
      
      const syncer = new EmailSyncer(db, config, logger, mockFactory)
      await syncer.syncAccount(config.accounts[0])
      
      const syncState = db.getSyncState('gmail', 'INBOX')
      expect(syncState).not.toBeNull()
      
      const updatedMockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 8452 },
          [8450, 8451],
          [{ uid: 8451, raw: 'From: test@test.com\r\nTo: recipient@test.com\r\nSubject: New Email\r\nDate: 2024-01-01T00:00:00Z\r\n\r\nBody text' }]
        )
      }
      
      const updatedSyncer = new EmailSyncer(db, config, logger, updatedMockFactory)
      await updatedSyncer.syncAccount(config.accounts[0])
      
      const emails = db.getEmailsByAccount('gmail')
      const queueItems = db.getPendingQueueItems(100)
      
      expect(emails.length).toBe(1)
      expect(emails[0].id).toBe('8451')
      expect(queueItems.length).toBe(1)
    })

    test('first sync saves correct lastUid for future email detection', async () => {
      const mockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 100 },
          [98, 99]
        )
      }
      
      const syncer = new EmailSyncer(db, config, logger, mockFactory)
      await syncer.syncAccount(config.accounts[0])
      
      const syncState = db.getSyncState('gmail', 'INBOX')
      expect(syncState).not.toBeNull()
      
      const lastUid = parseInt(syncState!.lastUid, 10)
      
      const updatedMockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 101 },
          [98, 99, 100],
          [{ uid: 100, raw: 'From: test@test.com\r\nTo: recipient@test.com\r\nSubject: New Email\r\nDate: 2024-01-01T00:00:00Z\r\n\r\nBody text' }]
        )
      }
      
      const updatedSyncer = new EmailSyncer(db, config, logger, updatedMockFactory)
      await updatedSyncer.syncAccount(config.accounts[0])
      
      const emails = db.getEmailsByAccount('gmail')
      expect(emails.length).toBe(1)
      expect(emails[0].id).toBe('100')
    })
  })

  describe('normal sync behavior', () => {
    test('first sync records uidnext without processing emails', async () => {
      const mockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 100 },
          [1, 2, 3]
        )
      }
      
      const syncer = new EmailSyncer(db, config, logger, mockFactory)
      await syncer.syncAccount(config.accounts[0])
      
      const syncState = db.getSyncState('gmail', 'INBOX')
      expect(syncState).not.toBeNull()
      expect(syncState!.accountName).toBe('gmail')
      expect(syncState!.folder).toBe('INBOX')
      
      const emails = db.getEmailsByAccount('gmail')
      expect(emails.length).toBe(0)
    })

    test('subsequent sync detects new emails with higher UIDs', async () => {
      const mockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 100 },
          [95, 96, 97]
        )
      }
      
      const syncer = new EmailSyncer(db, config, logger, mockFactory)
      await syncer.syncAccount(config.accounts[0])
      
      const syncState = db.getSyncState('gmail', 'INBOX')
      expect(syncState).not.toBeNull()
      
      const updatedMockFactory: ImapClientFactory = (options, logger, proxy) => {
        return createMockClient(
          { uidnext: 102 },
          [95, 96, 97, 101],
          [{ uid: 101, raw: 'From: test@test.com\r\nTo: recipient@test.com\r\nSubject: New Email\r\nDate: 2024-01-01T00:00:00Z\r\n\r\nBody text' }]
        )
      }
      
      const updatedSyncer = new EmailSyncer(db, config, logger, updatedMockFactory)
      await updatedSyncer.syncAccount(config.accounts[0])
      
      const emails = db.getEmailsByAccount('gmail')
      expect(emails.length).toBe(1)
      expect(emails[0].id).toBe('101')
      
      const queueItems = db.getPendingQueueItems(100)
      expect(queueItems.length).toBe(1)
      expect(queueItems[0].emailId).toBe('101')
    })
  })
})