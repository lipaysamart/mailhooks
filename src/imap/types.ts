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
  fetch(uids: number[], bodies: string[]): unknown
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