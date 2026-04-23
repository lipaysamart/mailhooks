// ABOUTME: Email sync process entry point
// ABOUTME: Runs IMAP sync loop and cleanup independently

import { getEnv } from './utils/env'
import { createLogger, type LogLevel, type LogFormat } from './utils/logger'
import { loadConfig, getDefaultSyncInterval, getDefaultLogLevel, getDefaultLogFormat } from './config/loader'
import { MailHooksDatabase } from './storage/database'
import { EmailSyncer } from './imap/syncer'

async function main() {
  const configPath = getEnv('CONFIG_PATH', './config.yaml')
  const databasePath = getEnv('DATABASE_PATH', './data/mailhooks.db')
  
  const config = await loadConfig(configPath)
  
  const logLevel = (config.log_level ?? getDefaultLogLevel()) as LogLevel
  const logFormat = (config.log_format ?? getDefaultLogFormat()) as LogFormat
  const logger = createLogger(logLevel, logFormat)
  
  const syncInterval = config.sync_interval ?? getDefaultSyncInterval()
  const cleanupDays = config.cleanup_days ?? 7
  
  logger.info('[SYNC] Starting sync process')
  logger.info({ configPath, databasePath, syncInterval }, '[SYNC] Configuration loaded')
  
  const db = new MailHooksDatabase(databasePath)
  db.init()
  
  const syncer = new EmailSyncer(db, config, logger)
  
  await Promise.all([
    runSyncLoop(syncer, syncInterval, logger),
    runCleanupLoop(db, cleanupDays, logger)
  ])
}

async function runSyncLoop(
  syncer: EmailSyncer, 
  interval: number, 
  logger: ReturnType<typeof createLogger>
) {
  logger.info('[SYNC] Starting initial sync')
  await syncer.syncAll()
  
  logger.info({ interval }, '[SYNC] Starting sync loop')
  
  while (true) {
    await sleep(interval * 1000)
    await syncer.syncAll()
  }
}

async function runCleanupLoop(
  db: MailHooksDatabase, 
  cleanupDays: number, 
  logger: ReturnType<typeof createLogger>
) {
  const cleanupInterval = 24 * 3600 * 1000
  
  while (true) {
    await sleep(cleanupInterval)
    
    db.cleanupQueue(cleanupDays)
    logger.info({ days: cleanupDays }, '[SYNC] Queue cleanup completed')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('[SYNC] Fatal error:', err)
  process.exit(1)
})