// ABOUTME: Tests for email parsing from raw IMAP messages
// ABOUTME: Uses mailparser to extract email content

import { describe, test, expect } from 'bun:test'
import { parseEmail } from './parser'

describe('parseEmail', () => {
  test('parses simple email', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Test Subject
Date: Mon, 1 Jan 2024 00:00:00 +0000

This is the email body text.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.fromAddr).toBe('sender@example.com')
    expect(parsed.fromName).toBe('')
    expect(parsed.toAddrs).toEqual(['recipient@example.com'])
    expect(parsed.subject).toBe('Test Subject')
    expect(parsed.text).toBe('This is the email body text.')
    expect(parsed.html).toBeNull()
    expect(parsed.attachments).toEqual([])
  })

  test('parses email with sender name', async () => {
    const rawEmail = `From: John Doe <john@example.com>
To: jane@example.com
Subject: Hello

Hello Jane!`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.fromAddr).toBe('john@example.com')
    expect(parsed.fromName).toBe('John Doe')
  })

  test('parses email with multiple recipients', async () => {
    const rawEmail = `From: sender@example.com
To: recipient1@example.com, recipient2@example.com
Subject: Test

Body text.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.toAddrs).toEqual(['recipient1@example.com', 'recipient2@example.com'])
  })

  test('parses email with HTML body', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: HTML Email
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="boundary"

--boundary
Content-Type: text/plain; charset=UTF-8

Plain text body.

--boundary
Content-Type: text/html; charset=UTF-8

<p>HTML body</p>

--boundary--`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.text).toContain('Plain text body')
    expect(parsed.html).toContain('<p>HTML body</p>')
  })

  test('parses email with attachment', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Email with attachment
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain; charset=UTF-8

Body text.

--boundary
Content-Type: application/pdf; name="document.pdf"
Content-Disposition: attachment; filename="document.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK

--boundary--`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.attachments.length).toBe(1)
    expect(parsed.attachments[0].filename).toBe('document.pdf')
    expect(parsed.attachments[0].contentType).toBe('application/pdf')
    expect(parsed.attachments[0].size).toBeGreaterThan(0)
  })

  test('parses email with multiple attachments', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Multiple attachments
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain; charset=UTF-8

Body.

--boundary
Content-Type: text/plain; name="file1.txt"
Content-Disposition: attachment; filename="file1.txt"

File 1 content.

--boundary
Content-Type: text/plain; name="file2.txt"
Content-Disposition: attachment; filename="file2.txt"

File 2 content.

--boundary--`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.attachments.length).toBe(2)
    expect(parsed.attachments[0].filename).toBe('file1.txt')
    expect(parsed.attachments[1].filename).toBe('file2.txt')
  })

  test('handles email without subject', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com

Body text.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.subject).toBeNull()
  })

  test('handles email without Date header', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: No date

Body text.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.date).toBeDefined()
    expect(new Date(parsed.date).toISOString()).toBeDefined()
  })

  test('handles email with empty body', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Empty body`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.text).toBeNull()
  })

  test('parses email with CC header', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Cc: cc1@example.com, cc2@example.com
Subject: CC test

Body.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.toAddrs).toContain('recipient@example.com')
  })

  test('handles quoted-printable encoding', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: =?UTF-8?Q?Test_Subject?=
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

This is =E2=80=9Cquoted=E2=80=9D text.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.subject).toContain('Test')
    expect(parsed.text).toContain('quoted')
  })

  test('handles encoded subject', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: =?UTF-8?B?VGVzdCBTdWJqZWN0?=

Body.`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.subject).toContain('Test')
  })

  test('preserves newline characters in text', async () => {
    const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Newlines

Line 1
Line 2
Line 3`
    
    const parsed = await parseEmail(rawEmail)
    expect(parsed.text).toContain('Line 1')
    expect(parsed.text).toContain('Line 2')
    expect(parsed.text).toContain('Line 3')
  })
})