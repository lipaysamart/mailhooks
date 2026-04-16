// ABOUTME: Handlebars template rendering for webhook payloads
// ABOUTME: Supports email variable substitution in webhook templates

import Handlebars from 'handlebars'
import type { Email } from '../types'

export function compileTemplate(template: string): (email: Email) => string {
  const compiled = Handlebars.compile(template)
  return (email: Email) => {
    const data = {
      id: email.id,
      account_name: email.accountName,
      folder: email.folder,
      from_addr: email.fromAddr,
      from_name: email.fromName ?? '',
      to_addrs: JSON.stringify(email.toAddrs),
      subject: email.subject ?? '',
      text: email.text ?? '',
      html: email.html ?? '',
      date: email.date,
      attachments: JSON.stringify(email.attachments)
    }
    return compiled(data)
  }
}