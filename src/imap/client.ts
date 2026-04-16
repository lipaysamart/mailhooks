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