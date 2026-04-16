// ABOUTME: Rule matching engine for email filtering
// ABOUTME: Applies rules in order to determine webhook targets

import type { Logger } from '../utils/logger'
import type { AppConfig, RuleConfig } from '../config/types'
import type { Email } from '../types'
import type { MatchResult } from './types'
import { matchCondition } from './matcher'

export class RuleEngine {
  private config: AppConfig
  private logger: Logger
  
  constructor(config: AppConfig, logger: Logger) {
    this.config = config
    this.logger = logger.child({ module: 'rules' })
  }
  
  match(email: Email): MatchResult | null {
    const ctx = {
      fromAddr: email.fromAddr,
      subject: email.subject,
      folder: email.folder
    }
    
    for (const rule of this.config.rules) {
      if (rule.enabled === false) {
        continue
      }
      
      if (matchCondition(rule.match, ctx)) {
        this.logger.info({ 
          emailId: email.id, 
          rule: rule.name 
        }, 'Email matched rule')
        
        return { matched: true, rule }
      }
    }
    
    this.logger.info({ emailId: email.id }, 'Email did not match any rule')
    return null
  }
  
  getWebhooksForRule(rule: RuleConfig): string[] {
    return rule.webhooks
  }
  
  getWebhookConfigs(names: string[]): Map<string, unknown> {
    const result = new Map<string, unknown>()
    
    for (const name of names) {
      const webhook = this.config.webhooks.find(w => w.name === name)
      if (webhook) {
        result.set(name, webhook)
      }
    }
    
    return result
  }
}