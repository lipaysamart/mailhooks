// ABOUTME: Webhook queue consumer process entry point
// ABOUTME: Polls queue and sends webhooks independently

import { getEnv } from './utils/env'
import { createLogger, type LogLevel, type LogFormat } from './utils/logger'
import { loadConfig, getDefaultLogLevel, getDefaultLogFormat } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { WebhookSender } from './webhooks/sender'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logFormat = (config.log_format ?? getDefaultLogFormat()) as LogFormat
  const logger = createLogger(logLevel, logFormat)
  
  const pollInterval = config.poll_interval ?? 30
  
  logger.info('[CONSUMER] Starting webhook queue consumer')
  logger.info({ configPath, databasePath, pollInterval }, '[CONSUMER] Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const webhookSender = new WebhookSender(logger)
  
  await runQueueConsumer(db, webhookSender, config.webhook, pollInterval, logger)
}

async function runQueueConsumer(
  db: MailHooksDatabase,
  sender: WebhookSender,
  webhookConfig: { url: string; method?: string; headers?: Record<string, string>; timeout?: number },
  pollInterval: number,
  logger: ReturnType<typeof createLogger>
) {
  while (true) {
    await sleep(pollInterval * 1000)
    
    const items = db.claimQueueItems(50)
    
    if (items.length === 0) {
      continue
    }
    
    logger.info({ count: items.length }, '[CONSUMER] Processing webhook queue')
    
    for (const item of items) {
      try {
        const email = db.getEmail(item.emailId)
        if (!email) {
          db.markQueueExpired(item.id, 'Email not found in database')
          logger.warn({ itemId: item.id, emailId: item.emailId }, '[CONSUMER] Email not found')
          continue
        }
        
        const result = await sender.send(webhookConfig, email)
        
        if (result.success) {
          db.markQueueSuccess(item.id)
        } else {
          if (new Date() > new Date(item.expiresAt)) {
            db.markQueueExpired(item.id, result.error ?? 'Expired')
            logger.warn({ itemId: item.id }, '[CONSUMER] Queue item expired')
          } else {
            db.markQueuePending(item.id, result.error ?? 'Unknown error')
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        db.markQueuePending(item.id, error)
        logger.error({ err, itemId: item.id }, '[CONSUMER] Queue processing error')
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('[CONSUMER] Fatal error:', err)
  process.exit(1)
})