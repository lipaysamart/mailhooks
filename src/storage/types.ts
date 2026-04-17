// ABOUTME: Storage module type definitions
// ABOUTME: Defines types for database operations

import type { Email, WebhookLog, SyncState } from '../types'

export interface Database {
  init(): void
  saveEmail(email: Email): void
  getEmail(id: string): Email | null
  getSyncState(accountName: string, folder: string): SyncState | null
  saveSyncState(state: SyncState): void
  createWebhookLog(emailId: string, webhookName: string): number
  updateWebhookLog(id: number, status: string, attempts: number, error?: string): void
  getPendingWebhookLogs(): WebhookLog[]
}

export interface QueueItem {
  id: number
  emailId: string
  accountName: string
  folder: string
  status: 'pending' | 'processing' | 'success' | 'expired'
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export interface QueueCreateInput {
  emailId: string
  accountName: string
  folder: string
  expiresAt: string
}