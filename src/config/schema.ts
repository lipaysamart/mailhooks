// ABOUTME: Configuration validation logic
// ABOUTME: Validates YAML config structure and required fields

import type { AppConfig, AccountConfig, WebhookConfig, WebhookRetryConfig } from './types'

function validateAccounts(accounts: unknown): AccountConfig[] {
  if (!accounts || !Array.isArray(accounts)) {
    throw new Error('accounts: required and must be array')
  }
  return accounts.map((a, i) => validateAccount(a, i))
}

function validateAccount(account: unknown, index: number): AccountConfig {
  if (!account || typeof account !== 'object') {
    throw new Error(`Account ${index} must be an object`)
  }
  const acc = account as Record<string, unknown>
  
  if (!acc.name || typeof acc.name !== 'string') {
    throw new Error(`Account ${index}: name is required and must be string`)
  }
  if (!acc.host || typeof acc.host !== 'string') {
    throw new Error(`Account ${index}: host is required and must be string`)
  }
  if (!acc.port || typeof acc.port !== 'number') {
    throw new Error(`Account ${index}: port is required and must be number`)
  }
  if (!acc.username || typeof acc.username !== 'string') {
    throw new Error(`Account ${index}: username is required and must be string`)
  }
  if (!acc.password || typeof acc.password !== 'string') {
    throw new Error(`Account ${index}: password is required and must be string`)
  }
  
  const folders = acc.folders
  if (folders !== undefined && !Array.isArray(folders)) {
    throw new Error(`Account ${index}: folders must be an array`)
  }
  
  return {
    name: acc.name,
    host: acc.host,
    port: acc.port,
    username: acc.username,
    password: acc.password,
    folders: folders as string[] | undefined
  }
}

function validateWebhook(wh: unknown): WebhookConfig {
  if (!wh || typeof wh !== 'object') {
    throw new Error('webhook: required and must be object')
  }
  
  const webhook = wh as Record<string, unknown>
  
  if (!webhook.url || typeof webhook.url !== 'string') {
    throw new Error('webhook.url: required and must be string')
  }
  
  if (!webhook.template || typeof webhook.template !== 'string') {
    throw new Error('webhook.template: required and must be string')
  }
  
  return {
    url: webhook.url,
    method: webhook.method as string | undefined,
    headers: webhook.headers as Record<string, string> | undefined,
    timeout: webhook.timeout as number | undefined,
    retry: webhook.retry as WebhookRetryConfig | undefined,
    template: webhook.template,
    poll_interval: webhook.poll_interval as number | undefined,
    expires_hours: webhook.expires_hours as number | undefined,
    cleanup_days: webhook.cleanup_days as number | undefined
  }
}

export function validateConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Config must be an object')
  }
  
  const config = raw as Record<string, unknown>
  
  const accounts = validateAccounts(config.accounts)
  
  const webhook = validateWebhook(config.webhook)
  
  return {
    log_level: config.log_level as string | undefined,
    sync_interval: config.sync_interval as number | undefined,
    socks_proxy: config.socks_proxy as string | undefined,
    accounts,
    webhook
  }
}