import type { EmailSummary } from "../types.ts";
import type { ParsedMail } from "mailparser";

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
