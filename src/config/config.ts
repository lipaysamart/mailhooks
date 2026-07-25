import { readFile } from "fs/promises";
import type { WebhookRoute } from "../types.ts";

export interface Config {
  host: string;
  port: number;
  secure: boolean;
  proxy?: string;
  username: string;
  password: string;
  mailbox: string;
  signingSecret: string;
  pollIntervalSeconds: number;
  dbPath: string;
  routes: WebhookRoute[];
}

export async function loadConfig(path: string): Promise<Config> {
  if (path === "") {
    throw new Error("Config file path cannot be empty");
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Config file not found: "${path}"`);
    }
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `Config file "${path}" is not valid JSON: ${err.message}`,
      );
    }
    throw err;
  }

  const routes = parsed.routes as WebhookRoute[] | undefined;
  if (!routes || !Array.isArray(routes) || routes.length === 0) {
    throw new Error('Config validation failed: "routes" must be a non-empty array');
  }

  const signingSecret = parsed.signingSecret;
  if (!signingSecret || typeof signingSecret !== "string") {
    throw new Error('Config validation failed: "signingSecret" is required and must be a string');
  }

  return {
    host: parsed.host as string,
    port: parsed.port as number,
    secure: parsed.secure as boolean,
    proxy: parsed.proxy as string | undefined,
    username: parsed.username as string,
    password: parsed.password as string,
    mailbox: (parsed.mailbox as string) ?? "INBOX",
    signingSecret,
    pollIntervalSeconds: (parsed.pollIntervalSeconds as number) ?? 60,
    dbPath: (parsed.dbPath as string) ?? "./mailhooks.db",
    routes,
  };
}
