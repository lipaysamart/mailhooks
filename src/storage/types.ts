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