// ABOUTME: Configuration validation logic
// ABOUTME: Validates YAML config structure and required fields

import type { AppConfig, AccountConfig, WebhookConfig, RuleConfig } from './types'
import type { MatchCondition, WebhookRetryConfig } from './types'

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

function validateWebhook(webhook: unknown, index: number): WebhookConfig {
  if (!webhook || typeof webhook !== 'object') {
    throw new Error(`Webhook ${index} must be an object`)
  }
  const wh = webhook as Record<string, unknown>
  
  if (!wh.name || typeof wh.name !== 'string') {
    throw new Error(`Webhook ${index}: name is required and must be string`)
  }
  if (!wh.url || typeof wh.url !== 'string') {
    throw new Error(`Webhook ${index}: url is required and must be string`)
  }
  if (!wh.template || typeof wh.template !== 'string') {
    throw new Error(`Webhook ${index}: template is required and must be string`)
  }
  
  return {
    name: wh.name,
    url: wh.url,
    method: wh.method as string | undefined,
    headers: wh.headers as Record<string, string> | undefined,
    timeout: wh.timeout as number | undefined,
    retry: wh.retry as WebhookRetryConfig | undefined,
    template: wh.template
  }
}

function validateRule(rule: unknown, index: number): RuleConfig {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Rule ${index} must be an object`)
  }
  const r = rule as Record<string, unknown>
  
  if (!r.name || typeof r.name !== 'string') {
    throw new Error(`Rule ${index}: name is required and must be string`)
  }
  if (!r.match || typeof r.match !== 'object') {
    throw new Error(`Rule ${index}: match is required and must be object`)
  }
  if (!r.webhooks || !Array.isArray(r.webhooks)) {
    throw new Error(`Rule ${index}: webhooks is required and must be array`)
  }
  
  return {
    name: r.name,
    enabled: r.enabled as boolean | undefined,
    match: r.match as MatchCondition,
    webhooks: r.webhooks as string[]
  }
}

export function validateConfig(config: unknown): AppConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object')
  }
  const c = config as Record<string, unknown>
  
  if (!c.accounts || !Array.isArray(c.accounts)) {
    throw new Error('accounts is required and must be an array')
  }
  if (!c.webhooks || !Array.isArray(c.webhooks)) {
    throw new Error('webhooks is required and must be an array')
  }
  if (!c.rules || !Array.isArray(c.rules)) {
    throw new Error('rules is required and must be an array')
  }
  
  const accounts = c.accounts.map((a, i) => validateAccount(a, i))
  const webhooks = c.webhooks.map((w, i) => validateWebhook(w, i))
  const rules = c.rules.map((r, i) => validateRule(r, i))
  
  const webhookNames = new Set(webhooks.map(w => w.name))
  for (const rule of rules) {
    for (const whName of rule.webhooks) {
      if (!webhookNames.has(whName)) {
        throw new Error(`Rule "${rule.name}" references unknown webhook "${whName}"`)
      }
    }
  }
  
  return {
    log_level: c.log_level as string | undefined,
    sync_interval: c.sync_interval as number | undefined,
    accounts,
    webhooks,
    rules
  }
}