// ABOUTME: Configuration file type definitions
// ABOUTME: Defines structure for YAML config validation

export interface AccountConfig {
  name: string
  host: string
  port: number
  username: string
  password: string
  folders?: string[]
}

export interface WebhookRetryConfig {
  count: number
  delay: number
}

export interface WebhookConfig {
  name: string
  url: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
  retry?: WebhookRetryConfig
  template: string
}

export interface MatchCondition {
  from?: string[]
  subject?: string[]
  folders?: string[]
  catch_all?: boolean
}

export interface RuleConfig {
  name: string
  enabled?: boolean
  match: MatchCondition
  webhooks: string[]
}

export interface AppConfig {
  log_level?: string
  sync_interval?: number
  socks_proxy?: string
  accounts: AccountConfig[]
  webhooks: WebhookConfig[]
  rules: RuleConfig[]
}