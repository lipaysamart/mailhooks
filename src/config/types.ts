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

export interface WebhookConfig {
  url: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
  poll_interval?: number
  expires_hours?: number
  cleanup_days?: number
}

export interface AppConfig {
  log_level?: string
  sync_interval?: number
  socks_proxy?: string
  accounts: AccountConfig[]
  webhook: WebhookConfig
}