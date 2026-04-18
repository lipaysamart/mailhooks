// ABOUTME: HTTP webhook sender for queue-based delivery
// ABOUTME: Sends JSON payloads to target endpoints, queue handles retries

import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email, WebhookPayload } from '../types'

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
    
    const context: WebhookPayload['context'] = {
      text: truncatedText,
      date: email.date
    }
    
    if (email.html) {
      context.html = email.html
    }
    
    if (email.attachments.length > 0) {
      context.attachments = email.attachments
    }
    
    return {
      subject: email.subject ?? '',
      from: email.fromName ?? '',
      context
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
    
    this.logger.debug({ payload }, 'Sending webhook payload')
    this.logger.info({ emailId: email.id }, 'Sending webhook')
    
    try {
      await this.makeRequest(config.url, method, headers, body, timeout)
      this.logger.info('Webhook sent')
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.error({ error }, 'Webhook failed')
      return { success: false, error }
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