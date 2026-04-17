// ABOUTME: Parse raw IMAP email messages to structured format
// ABOUTME: Uses mailparser to extract email content

import { simpleParser } from 'mailparser'
import type { AddressObject, Attachment as MailAttachment } from 'mailparser'
import type { Attachment } from '../types'

export interface ParsedEmail {
  fromAddr: string
  fromName: string | null
  toAddrs: string[]
  subject: string | null
  text: string | null
  html: string | null
  date: string
  attachments: Attachment[]
}

export async function parseEmail(raw: string): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw)
  
  const fromAddr = parsed.from?.value[0]?.address ?? ''
  const fromName = parsed.from?.value[0]?.name ?? null
  
  const toAddrs = (parsed.to as AddressObject)?.value?.map(v => v.address ?? '') ?? []
  
  const attachments: Attachment[] = parsed.attachments.map((att: MailAttachment) => ({
    filename: att.filename ?? 'unknown',
    contentType: att.contentType,
    size: att.size
  }))
  
  return {
    fromAddr,
    fromName,
    toAddrs,
    subject: parsed.subject ?? null,
    text: typeof parsed.text === 'string' ? parsed.text : null,
    html: typeof parsed.html === 'string' ? parsed.html : null,
    date: parsed.date?.toISOString() ?? new Date().toISOString(),
    attachments
  }
}