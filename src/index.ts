// ABOUTME: MailHooks entry point and orchestration
// ABOUTME: Coordinates config, storage, syncer, and webhook queue consumer

import { getEnv } from './utils/env'
import { createLogger, type LogLevel } from './utils/logger'
import { loadConfig, getDefaultSyncInterval, getDefaultLogLevel } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { EmailSyncer } from './imap/syncer'
import { WebhookSender } from './webhooks/sender'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logger = createLogger(logLevel)
  
  const syncInterval = config.sync_interval ?? getDefaultSyncInterval()
  const pollInterval = config.webhook.poll_interval ?? 30
  const cleanupDays = config.webhook.cleanup_days ?? 7
  
  logger.info('Starting MailHooks')
  logger.info({ configPath, databasePath, syncInterval, pollInterval }, 'Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const syncer = new EmailSyncer(db, config, logger)
  const webhookSender = new WebhookSender(config.webhook, logger)
  
  // Start queue consumer
  logger.info({ interval: pollInterval }, 'Starting webhook queue consumer')
  
  // Run sync and consumer in parallel
  await Promise.all([
    runSyncLoop(syncer, syncInterval, logger),
    runQueueConsumer(db, webhookSender, config.webhook, pollInterval, logger),
    runCleanupLoop(db, cleanupDays, logger)
  ])
}

async function runSyncLoop(syncer: EmailSyncer, interval: number, logger: ReturnType<typeof createLogger>) {
  logger.info('Starting initial sync')
  await syncer.syncAll()
  
  logger.info({ interval }, 'Starting sync loop')
  
  while (true) {
    await sleep(interval * 1000)
    await syncer.syncAll()
  }
}

async function runQueueConsumer(
  db: MailHooksDatabase,
  sender: WebhookSender,
  webhookConfig: { url: string; method?: string; headers?: Record<string, string>; timeout?: number; retry?: { count: number; delay: number }; template: string; poll_interval?: number; expires_hours?: number; cleanup_days?: number },
  pollInterval: number,
  logger: ReturnType<typeof createLogger>
) {
  while (true) {
    await sleep(pollInterval * 1000)
    
    const items = db.getPendingQueueItems(50)
    
    if (items.length === 0) {
      continue
    }
    
    logger.info({ count: items.length }, 'Processing webhook queue')
    
    for (const item of items) {
      try {
        db.markQueueProcessing(item.id)
        
        const email = db.getEmail(item.emailId)
        if (!email) {
          db.markQueueExpired(item.id, 'Email not found in database')
          logger.warn({ itemId: item.id, emailId: item.emailId }, 'Email not found')
          continue
        }
        
        const result = await sender.send(webhookConfig, email)
        
        if (result.success) {
          db.markQueueSuccess(item.id)
        } else {
          // Check if expired
          if (new Date() > new Date(item.expiresAt)) {
            db.markQueueExpired(item.id, result.error ?? 'Expired')
            logger.warn({ itemId: item.id }, 'Queue item expired')
          } else {
            db.markQueuePending(item.id, result.error ?? 'Unknown error')
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        db.markQueuePending(item.id, error)
        logger.error({ err, itemId: item.id }, 'Queue processing error')
      }
    }
  }
}

async function runCleanupLoop(db: MailHooksDatabase, cleanupDays: number, logger: ReturnType<typeof createLogger>) {
  // Run cleanup once per day
  const cleanupInterval = 24 * 3600 * 1000
  
  while (true) {
    await sleep(cleanupInterval)
    
    db.cleanupQueue(cleanupDays)
    logger.info({ days: cleanupDays }, 'Queue cleanup completed')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})