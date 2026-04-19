// ABOUTME: Tests for configuration validation
// ABOUTME: Validates YAML config structure and required fields

import { describe, test, expect } from 'bun:test'
import { validateConfig } from './schema'
import type { AppConfig } from './types'

describe('validateConfig', () => {
  const validAccount = {
    name: 'gmail',
    host: 'imap.gmail.com',
    port: 993,
    username: 'user@gmail.com',
    password: 'secret'
  }

  const validWebhook = {
    url: 'https://example.com/webhook'
  }

  test('validates minimal valid config', () => {
    const config = {
      accounts: [validAccount],
      webhook: validWebhook
    }
    const result = validateConfig(config)
    expect(result.accounts).toHaveLength(1)
    expect(result.webhook.url).toBe('https://example.com/webhook')
  })

  test('validates full valid config', () => {
    const config = {
      log_level: 'debug',
      log_format: 'json',
      sync_interval: 300,
      socks_proxy: 'socks5://localhost:1080',
      poll_interval: 30,
      expires_hours: 48,
      cleanup_days: 14,
      accounts: [{
        ...validAccount,
        folders: ['INBOX', 'Sent']
      }],
      webhook: {
        url: 'https://example.com/webhook',
        method: 'POST',
        headers: { 'Authorization': 'Bearer token' },
        timeout: 15
      }
    }
    const result = validateConfig(config)
    expect(result.log_level).toBe('debug')
    expect(result.log_format).toBe('json')
    expect(result.sync_interval).toBe(300)
    expect(result.socks_proxy).toBe('socks5://localhost:1080')
    expect(result.poll_interval).toBe(30)
    expect(result.expires_hours).toBe(48)
    expect(result.cleanup_days).toBe(14)
    expect(result.accounts[0].folders).toEqual(['INBOX', 'Sent'])
    expect(result.webhook.method).toBe('POST')
    expect(result.webhook.headers).toEqual({ 'Authorization': 'Bearer token' })
    expect(result.webhook.timeout).toBe(15)
  })

  test('throws when config is not an object', () => {
    expect(() => validateConfig(null)).toThrow('Config must be an object')
    expect(() => validateConfig(undefined)).toThrow('Config must be an object')
    expect(() => validateConfig('string')).toThrow('Config must be an object')
    expect(() => validateConfig(123)).toThrow('Config must be an object')
  })

  test('throws when accounts is missing', () => {
    const config = { webhook: validWebhook }
    expect(() => validateConfig(config)).toThrow('accounts: required and must be array')
  })

  test('throws when accounts is not an array', () => {
    const config = { accounts: 'not-array', webhook: validWebhook }
    expect(() => validateConfig(config)).toThrow('accounts: required and must be array')
  })

  test('throws when account is not an object', () => {
    const config = {
      accounts: ['not-object'],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0 must be an object')
  })

  test('throws when account name is missing', () => {
    const config = {
      accounts: [{
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com',
        password: 'secret'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: name is required and must be string')
  })

  test('throws when account host is missing', () => {
    const config = {
      accounts: [{
        name: 'gmail',
        port: 993,
        username: 'user@gmail.com',
        password: 'secret'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: host is required and must be string')
  })

  test('throws when account port is missing', () => {
    const config = {
      accounts: [{
        name: 'gmail',
        host: 'imap.gmail.com',
        username: 'user@gmail.com',
        password: 'secret'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: port is required and must be number')
  })

  test('throws when account username is missing', () => {
    const config = {
      accounts: [{
        name: 'gmail',
        host: 'imap.gmail.com',
        port: 993,
        password: 'secret'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: username is required and must be string')
  })

  test('throws when account password is missing', () => {
    const config = {
      accounts: [{
        name: 'gmail',
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: password is required and must be string')
  })

  test('throws when account folders is not an array', () => {
    const config = {
      accounts: [{
        ...validAccount,
        folders: 'not-array'
      }],
      webhook: validWebhook
    }
    expect(() => validateConfig(config)).toThrow('Account 0: folders must be an array')
  })

  test('validates multiple accounts', () => {
    const config = {
      accounts: [
        validAccount,
        {
          name: 'outlook',
          host: 'outlook.office365.com',
          port: 993,
          username: 'user@outlook.com',
          password: 'secret2'
        }
      ],
      webhook: validWebhook
    }
    const result = validateConfig(config)
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0].name).toBe('gmail')
    expect(result.accounts[1].name).toBe('outlook')
  })

  test('throws when webhook is missing', () => {
    const config = { accounts: [validAccount] }
    expect(() => validateConfig(config)).toThrow('webhook: required and must be object')
  })

  test('throws when webhook is not an object', () => {
    const config = {
      accounts: [validAccount],
      webhook: 'not-object'
    }
    expect(() => validateConfig(config)).toThrow('webhook: required and must be object')
  })

  test('throws when webhook url is missing', () => {
    const config = {
      accounts: [validAccount],
      webhook: {}
    }
    expect(() => validateConfig(config)).toThrow('webhook.url: required and must be string')
  })

  test('accepts webhook with only url', () => {
    const config = {
      accounts: [validAccount],
      webhook: { url: 'https://example.com/webhook' }
    }
    const result = validateConfig(config)
    expect(result.webhook.url).toBe('https://example.com/webhook')
    expect(result.webhook.method).toBeUndefined()
    expect(result.webhook.headers).toBeUndefined()
    expect(result.webhook.timeout).toBeUndefined()
  })
})