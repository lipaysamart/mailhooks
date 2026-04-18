// ABOUTME: YAML configuration file loader
// ABOUTME: Loads, parses and validates config

import yaml from 'js-yaml'
import { readFile } from 'fs/promises'
import { validateConfig } from './schema'
import type { AppConfig } from './types'

export async function loadConfig(path: string): Promise<AppConfig> {
  const content = await readFile(path, 'utf-8')
  const raw = yaml.load(content)
  return validateConfig(raw)
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