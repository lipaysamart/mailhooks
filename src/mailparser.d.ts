declare module "mailparser" {
  export function simpleParser(
    source: Buffer | string,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
