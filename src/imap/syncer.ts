// ABOUTME: Email synchronization logic for IMAP accounts
// ABOUTME: Fetches new emails and triggers processing pipeline

import type { Logger } from '../utils/logger'
import type { Database } from '../storage/types'
import type { AppConfig, AccountConfig } from '../config/types'
import type { Email } from '../types'
import type { ImapConnectionOptions } from './types'
import { ImapClient } from './client'
import { parseEmail } from './parser'
import { getDefaultFolders } from '../config/loader'

export type ImapClientFactory = (options: ImapConnectionOptions, logger: Logger, proxy?: string) => ImapClient

const defaultClientFactory: ImapClientFactory = (options, logger, proxy) => {
  return new ImapClient(options, logger, proxy)
}

export class EmailSyncer {
  private logger: Logger
  private db: Database
  private config: AppConfig
  private clientFactory: ImapClientFactory
  
  constructor(db: Database, config: AppConfig, logger: Logger, clientFactory?: ImapClientFactory) {
    this.db = db
    this.config = config
    this.logger = logger.child({ module: 'syncer' })
    this.clientFactory = clientFactory ?? defaultClientFactory
  }
  
  async syncAccount(account: AccountConfig): Promise<void> {
    this.logger.info({ account: account.name }, 'Starting sync for account')
    
    const client = this.clientFactory({
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
    const uids = allUids.filter(uid => uid >= lastUid)
    
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
        const expiresHours = this.config.expires_hours ?? 24
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