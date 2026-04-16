// ABOUTME: Global type definitions for MailHooks
// ABOUTME: Defines core data structures used across modules

export interface Email {
  id: string
  accountName: string
  folder: string
  fromAddr: string
  fromName: string | null
  toAddrs: string[]
  subject: string | null
  text: string | null
  html: string | null
  date: string
  flags: string[]
  attachments: Attachment[]
  syncedAt: string
}

export interface Attachment {
  filename: string
  contentType: string
  size: number
}

export interface WebhookLog {
  id: number
  emailId: string
  webhookName: string
  status: 'pending' | 'success' | 'failed'
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface SyncState {
  accountName: string
  folder: string
  lastUid: string
  lastSyncAt: string
}