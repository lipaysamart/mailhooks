// ABOUTME: MailHooks entry point and orchestration
// ABOUTME: Coordinates config, storage, syncer, rules, and webhooks

import { getEnv } from './utils/env'
import { createLogger, type LogLevel } from './utils/logger'
import { loadConfig, getDefaultSyncInterval, getDefaultLogLevel } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { EmailSyncer } from './imap/syncer'
import { RuleEngine } from './rules/engine'
import { WebhookSender } from './webhooks/sender'
import type { Email } from './types'
import type { WebhookConfig } from './config/types'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logger = createLogger(logLevel)
  
  const syncInterval = config.sync_interval ?? getDefaultSyncInterval()
  
  logger.info('Starting MailHooks')
  logger.info({ configPath, databasePath, syncInterval }, 'Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const syncer = new EmailSyncer(db, config, logger)
  const ruleEngine = new RuleEngine(config, logger)
  const webhookSender = new WebhookSender(db, logger)
  
  for (const webhook of config.webhooks) {
    webhookSender.registerTemplate(webhook.name, webhook.template)
  }
  
  syncer.setEmailHandler(async (email: Email) => {
    const match = ruleEngine.match(email)
    
    if (!match) {
      return
    }
    
    const webhookNames = ruleEngine.getWebhooksForRule(match.rule)
    
    if (webhookNames.length === 0) {
      return
    }
    
    const webhookConfigs = ruleEngine.getWebhookConfigs(webhookNames)
    
    for (const [name, wh] of webhookConfigs) {
      await webhookSender.send(wh as WebhookConfig, email)
    }
  })
  
  logger.info('Starting initial sync')
  await syncer.syncAll()
  
  logger.info({ interval: syncInterval }, 'Starting sync loop')
  
  while (true) {
    await sleep(syncInterval * 1000)
    await syncer.syncAll()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})