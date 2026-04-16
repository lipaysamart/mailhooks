// ABOUTME: YAML configuration file loader
// ABOUTME: Loads, parses, validates and expands env vars in config

import yaml from 'js-yaml'
import { readFile } from 'fs/promises'
import { expandEnvVars } from '../utils/env'
import { validateConfig } from './schema'
import type { AppConfig } from './types'

function expandConfigEnvVars(config: Record<string, unknown>): Record<string, unknown> {
  function expandValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return expandEnvVars(value)
    }
    if (Array.isArray(value)) {
      return value.map(expandValue)
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = expandValue(v)
      }
      return result
    }
    return value
  }
  
  return expandValue(config) as Record<string, unknown>
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const content = await readFile(path, 'utf-8')
  const rawConfig = yaml.load(content) as Record<string, unknown>
  const expandedConfig = expandConfigEnvVars(rawConfig)
  return validateConfig(expandedConfig)
}

export function getDefaultFolders(): string[] {
  return ['INBOX']
}

export function getDefaultSyncInterval(): number {
  return 300
}

export function getDefaultLogLevel(): string {
  return 'info'
}