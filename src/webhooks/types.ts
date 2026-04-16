// ABOUTME: Webhook module type definitions
// ABOUTME: Defines types for webhook sending and retry

export interface WebhookSendResult {
  success: boolean
  attempts: number
  lastError?: string
}

export interface WebhookOptions {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  timeout: number
  retryCount: number
  retryDelay: number
}