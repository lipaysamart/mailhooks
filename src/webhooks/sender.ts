// ABOUTME: HTTP webhook sender with retry support
// ABOUTME: Sends templated payloads to target endpoints

import type { Logger } from '../utils/logger'
import type { WebhookConfig } from '../config/types'
import type { Email } from '../types'
import type { Database } from '../storage/types'
import { compileTemplate } from '../utils/template'
import { retry } from './retry'

export class WebhookSender {
  private db: Database
  private logger: Logger
  private templates: Map<string, (email: Email) => string>
  
  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger.child({ module: 'webhook' })
    this.templates = new Map()
  }
  
  registerTemplate(name: string, template: string): void {
    this.templates.set(name, compileTemplate(template))
  }
  
  async send(webhook: WebhookConfig, email: Email): Promise<void> {
    const templateFn = this.templates.get(webhook.name)
    if (!templateFn) {
      this.logger.error({ webhook: webhook.name }, 'Template not registered')
      return
    }
    
    const body = templateFn(email)
    const logId = this.db.createWebhookLog(email.id, webhook.name)
    
    const method = webhook.method ?? 'POST'
    const headers = webhook.headers ?? {}
    const timeout = webhook.timeout ?? 10
    const retryCount = webhook.retry?.count ?? 3
    const retryDelay = webhook.retry?.delay ?? 5
    
    this.logger.info({ webhook: webhook.name, emailId: email.id }, 'Sending webhook')
    
    const result = await retry(
      () => this.makeRequest(webhook.url, method, headers, body, timeout),
      retryCount,
      retryDelay
    )
    
    if (result.success) {
      this.db.updateWebhookLog(logId, 'success', result.attempts)
      this.logger.info({ webhook: webhook.name, attempts: result.attempts }, 'Webhook sent')
    } else {
      this.db.updateWebhookLog(logId, 'failed', result.attempts, result.lastError)
      this.logger.error({ 
        webhook: webhook.name, 
        attempts: result.attempts,
        error: result.lastError 
      }, 'Webhook failed')
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