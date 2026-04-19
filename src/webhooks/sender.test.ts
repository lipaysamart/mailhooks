// ABOUTME: Tests for HTTP webhook sender
// ABOUTME: Sends JSON payloads to target endpoints

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { WebhookSender } from './sender'
import { createLogger } from '../utils/logger'
import type { Email } from '../types'
import type { WebhookConfig } from '../config/types'

describe('WebhookSender', () => {
  let sender: WebhookSender
  let logger: ReturnType<typeof createLogger>
  const originalFetch = global.fetch

  beforeEach(() => {
    logger = createLogger('error', 'json')
    sender = new WebhookSender(logger)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const testEmail: Email = {
    id: 'email-123',
    accountName: 'gmail',
    folder: 'INBOX',
    fromAddr: 'sender@example.com',
    fromName: 'Sender Name',
    toAddrs: ['recipient@example.com'],
    subject: 'Test Subject',
    text: 'Test body',
    html: '<p>Test body</p>',
    date: '2024-01-01T00:00:00Z',
    flags: ['\\Seen'],
    attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', size: 1000 }],
    syncedAt: '2024-01-02T00:00:00Z'
  }

  const testConfig: WebhookConfig = {
    url: 'https://example.com/webhook',
    method: 'POST',
    headers: { 'Authorization': 'Bearer token' },
    timeout: 10
  }

  test('send returns success when HTTP response is ok', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(null, { status: 200 }))) as unknown as typeof fetch
    
    const result = await sender.send(testConfig, testEmail)
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('send returns failure when HTTP response is not ok', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(null, { status: 500, statusText: 'Internal Server Error' }))) as unknown as typeof fetch
    
    const result = await sender.send(testConfig, testEmail)
    expect(result.success).toBe(false)
    expect(result.error).toContain('HTTP 500')
  })

  test('send returns failure when HTTP response is 404', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }))) as unknown as typeof fetch
    
    const result = await sender.send(testConfig, testEmail)
    expect(result.success).toBe(false)
    expect(result.error).toContain('HTTP 404')
  })

  test('send returns failure when fetch throws error', async () => {
    global.fetch = mock(() => Promise.reject(new Error('Network error'))) as unknown as typeof fetch
    
    const result = await sender.send(testConfig, testEmail)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  test('send returns failure on timeout', async () => {
    global.fetch = mock(() => new Promise((_, reject) => {
      setTimeout(() => reject(new DOMException('The operation was aborted', 'AbortError')), 100)
    })) as unknown as typeof fetch
    
    const result = await sender.send({ ...testConfig, timeout: 0.05 }, testEmail)
    expect(result.success).toBe(false)
  })

  test('builds correct payload structure', async () => {
    let capturedBody: string = ''
    global.fetch = mock((url, options) => {
      capturedBody = options.body as string
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    await sender.send(testConfig, testEmail)
    
    const payload = JSON.parse(capturedBody)
    expect(payload.meta.id).toBe('email-123')
    expect(payload.meta.accountName).toBe('gmail')
    expect(payload.meta.folder).toBe('INBOX')
    expect(payload.meta.date).toBe('2024-01-01T00:00:00Z')
    expect(payload.meta.flags).toEqual(['\\Seen'])
    expect(payload.from.name).toBe('Sender Name')
    expect(payload.from.address).toBe('sender@example.com')
    expect(payload.to).toEqual(['recipient@example.com'])
    expect(payload.subject).toBe('Test Subject')
    expect(payload.content.text).toBe('Test body')
    expect(payload.content.html).toBe('<p>Test body</p>')
    expect(payload.attachments).toEqual([{ filename: 'doc.pdf', contentType: 'application/pdf', size: 1000 }])
  })

  test('uses default method when not specified', async () => {
    let capturedMethod: string = ''
    global.fetch = mock((url, options) => {
      capturedMethod = options.method as string
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    await sender.send({ url: 'https://example.com/webhook' }, testEmail)
    expect(capturedMethod).toBe('POST')
  })

  test('uses custom method when specified', async () => {
    let capturedMethod: string = ''
    global.fetch = mock((url, options) => {
      capturedMethod = options.method as string
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    await sender.send({ url: 'https://example.com/webhook', method: 'PUT' }, testEmail)
    expect(capturedMethod).toBe('PUT')
  })

  test('merges custom headers with Content-Type', async () => {
    let capturedHeaders: Record<string, string> = {}
    global.fetch = mock((url, options) => {
      capturedHeaders = options.headers as Record<string, string>
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    await sender.send({
      url: 'https://example.com/webhook',
      headers: { 'X-Custom': 'value' }
    }, testEmail)
    
    expect(capturedHeaders['Content-Type']).toBe('application/json')
    expect(capturedHeaders['X-Custom']).toBe('value')
  })

  test('uses default timeout when not specified', async () => {
    const configWithoutTimeout: WebhookConfig = {
      url: 'https://example.com/webhook'
    }
    
    global.fetch = mock(() => Promise.resolve(new Response(null, { status: 200 }))) as unknown as typeof fetch
    
    const result = await sender.send(configWithoutTimeout, testEmail)
    expect(result.success).toBe(true)
  })

  test('handles email with null fields', async () => {
    let capturedBody: string = ''
    global.fetch = mock((url, options) => {
      capturedBody = options.body as string
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    const emailWithNulls: Email = {
      id: 'email-456',
      accountName: 'gmail',
      folder: 'INBOX',
      fromAddr: 'sender@example.com',
      fromName: null,
      toAddrs: ['recipient@example.com'],
      subject: null,
      text: null,
      html: null,
      date: '2024-01-01T00:00:00Z',
      flags: [],
      attachments: [],
      syncedAt: '2024-01-02T00:00:00Z'
    }
    
    await sender.send(testConfig, emailWithNulls)
    
    const payload = JSON.parse(capturedBody)
    expect(payload.from.name).toBeNull()
    expect(payload.subject).toBeNull()
    expect(payload.content.text).toBeNull()
    expect(payload.content.html).toBeNull()
  })

  test('serializes attachments correctly', async () => {
    let capturedBody: string = ''
    global.fetch = mock((url, options) => {
      capturedBody = options.body as string
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof fetch
    
    const emailWithAttachments: Email = {
      ...testEmail,
      attachments: [
        { filename: 'file1.pdf', contentType: 'application/pdf', size: 5000 },
        { filename: 'file2.png', contentType: 'image/png', size: 2000 }
      ]
    }
    
    await sender.send(testConfig, emailWithAttachments)
    
    const payload = JSON.parse(capturedBody)
    expect(payload.attachments).toHaveLength(2)
    expect(payload.attachments[0].filename).toBe('file1.pdf')
    expect(payload.attachments[1].filename).toBe('file2.png')
  })
})