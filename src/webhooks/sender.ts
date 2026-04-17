// ABOUTME: HTTP webhook sender with retry support
// ABOUTME: Sends templated payloads to target endpoints

import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email } from '../types'
import { compileTemplate } from '../utils/template'
import { retry } from './retry'

export class WebhookSender {
  private logger: Logger
  private templateFn: (email: Email) => string
  
  constructor(config: WebhookConfig, logger: Logger) {
    this.logger = logger.child({ module: 'webhook' })
    this.templateFn = compileTemplate(config.template)
  }
  
  async send(config: WebhookConfig, email: Email): Promise<{ success: boolean; error?: string }> {
    const body = this.templateFn(email)
    
    const method = config.method ?? 'POST'
    const headers = config.headers ?? {}
    const timeout = config.timeout ?? 10
    const retryCount = config.retry?.count ?? 3
    const retryDelay = config.retry?.delay ?? 5
    
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