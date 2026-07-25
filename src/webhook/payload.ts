import type { EmailSummary } from "../types.ts";

// mailparser ships without built-in types, declare minimal shape used here
interface AddressObject {
  text?: string;
  value?: Array<{ address: string; name: string }>;
}

interface ParsedMail {
  from?: AddressObject | null;
  to?: AddressObject | null;
  subject?: string;
  text?: string;
  html?: string | boolean;
  date?: Date | string | null;
}

export function buildPayload(
  mail: ParsedMail,
  matchedAddress: string,
): EmailSummary {
  const date = mail.date ?? new Date();

  return {
    from: mail.from?.text ?? "",
    to: matchedAddress,
    subject: mail.subject ?? "",
    text_body: mail.text ?? "",
    html_body: typeof mail.html === "string" ? mail.html : null,
    received_at: date instanceof Date ? date.toISOString() : String(date),
  };
}
