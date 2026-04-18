// ABOUTME: HTTP webhook sender with retry support
// ABOUTME: Sends JSON payloads to target endpoints

import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email, WebhookPayload } from '../types'
import { retry } from './retry'

export class WebhookSender {
  private logger: Logger
  
  constructor(logger: Logger) {
    this.logger = logger.child({ module: 'webhook' })
  }
  
  private buildPayload(email: Email): WebhookPayload {
    const text = email.text ?? ''
    const truncatedText = text.length > 500 
      ? text.substring(0, 500) + '...(内容过长已截断)' 
      : text
    
    return {
      subject: email.subject ?? '',
      from_name: email.fromName ?? '',
      context: {
        text: truncatedText,
        date: email.date
      }
    }
  }
  
  async send(config: WebhookConfig, email: Email): Promise<{ success: boolean; error?: string }> {
    const payload = this.buildPayload(email)
    const body = JSON.stringify(payload)
    
    const method = config.method ?? 'POST'
    const headers = {
      'Content-Type': 'application/json',
      ...config.headers
    }
    const timeout = config.timeout ?? 10
    const retryCount = config.retry?.count ?? 3
    const retryDelay = config.retry?.delay ?? 5
    
    this.logger.debug({ payload }, 'Sending webhook payload')
    this.logger.info({ emailId: email.id }, 'Sending webhook')
    
    const result = await retry(
      () => this.makeRequest(config.url, method, headers, body, timeout),
      retryCount,
      retryDelay
    )
    
    if (result.success) {
      this.logger.info({ attempts: result.attempts }, 'Webhook sent')
      return { success: true }
    } else {
      this.logger.error({ 
        attempts: result.attempts,
        error: result.lastError 
      }, 'Webhook failed')
      return { success: false, error: result.lastError }
    }
  }
  
  private async makeRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    timeout: number
  ): Promise<void> {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout * 1000)
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  }
}