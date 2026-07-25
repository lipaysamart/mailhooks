declare module "mailparser" {
  export interface AddressObject {
    text?: string;
    value?: Array<{ address: string; name: string }>;
  }

  export interface ParsedMail {
    from?: AddressObject | null;
    to?: AddressObject | null;
    subject?: string;
    text?: string;
    html?: string | boolean;
    date?: Date | string | null;
  }

  export function simpleParser(
    source: Buffer | string,
    options?: Record<string, unknown>,
  ): Promise<ParsedMail>;
}
