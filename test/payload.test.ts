import { describe, expect, it } from "vitest";
import { buildPayload } from "../src/webhook/payload.ts";

// Match the local ParsedMail interface from payload.ts
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

function makeMail(overrides: Partial<ParsedMail> = {}): ParsedMail {
  return {
    from: { text: "sender@example.com" },
    subject: "Test Subject",
    text: "Hello world",
    html: "<p>Hello world</p>",
    date: new Date("2025-01-15T12:00:00Z"),
    ...overrides,
  };
}

describe("buildPayload", () => {
  it("maps all fields from a complete mail", () => {
    const mail = makeMail();
    const result = buildPayload(mail, "alerts@example.com");

    expect(result.from).toBe("sender@example.com");
    expect(result.to).toBe("alerts@example.com");
    expect(result.subject).toBe("Test Subject");
    expect(result.text_body).toBe("Hello world");
    expect(result.html_body).toBe("<p>Hello world</p>");
    expect(result.received_at).toBe("2025-01-15T12:00:00.000Z");
  });

  it("sets html_body to empty string when html is boolean", () => {
    const mail = makeMail({ html: false });
    expect(buildPayload(mail, "a@e.com").html_body).toBe("");
  });

  it("sets html_body to empty string when html is missing", () => {
    const mail = makeMail();
    delete mail.html;
    expect(buildPayload(mail, "a@e.com").html_body).toBe("");
  });

  it("defaults from to empty string when missing", () => {
    const mail = makeMail();
    delete mail.from;
    expect(buildPayload(mail, "a@e.com").from).toBe("");
  });

  it("defaults from to empty string when from.text is null", () => {
    const mail = makeMail({ from: { text: undefined } });
    expect(buildPayload(mail, "a@e.com").from).toBe("");
  });

  it("defaults from to empty string when from is null", () => {
    const mail = makeMail({ from: null });
    expect(buildPayload(mail, "a@e.com").from).toBe("");
  });

  it("defaults subject to empty string when missing", () => {
    const mail = makeMail();
    delete mail.subject;
    expect(buildPayload(mail, "a@e.com").subject).toBe("");
  });

  it("defaults text_body to empty string when missing", () => {
    const mail = makeMail();
    delete mail.text;
    expect(buildPayload(mail, "a@e.com").text_body).toBe("");
  });

  it("uses current ISO string when date is missing", () => {
    const mail = makeMail();
    delete mail.date;
    const result = buildPayload(mail, "a@e.com");
    // Should be an ISO string roughly around now
    expect(result.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const parsed = new Date(result.received_at);
    expect(parsed.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("uses date string directly when date is a string", () => {
    const mail = makeMail({ date: "2025-06-01T08:00:00Z" });
    expect(buildPayload(mail, "a@e.com").received_at).toBe(
      "2025-06-01T08:00:00Z",
    );
  });

  it("passes through matchedAddress as to field", () => {
    const mail = makeMail();
    expect(buildPayload(mail, "custom@domain.com").to).toBe(
      "custom@domain.com",
    );
  });
});
