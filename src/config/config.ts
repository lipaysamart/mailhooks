import { readFile } from "node:fs/promises";
import type { LogFormat, LogLevel } from "../log/logger.ts";
import type { WebhookRoute } from "../types.ts";

export interface Config {
  host: string;
  port: number;
  secure: boolean;
  proxy?: string;
  username: string;
  password: string;
  mailbox: string;
  pollIntervalSeconds: number;
  dbPath: string;
  routes: WebhookRoute[];
  logLevel: LogLevel;
  logFormat: LogFormat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Config validation failed: "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function validateOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return validateRequiredString(value, field);
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const LOG_FORMATS: readonly LogFormat[] = ["auto", "pretty", "json"];

function validateOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new Error(
      `Config validation failed: "${field}" must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
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

  const routes = parsed.routes as unknown;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error(
      'Config validation failed: "routes" must be a non-empty array',
    );
  }

  const validatedRoutes: WebhookRoute[] = routes.map((route, index) => {
    if (!isRecord(route)) {
      throw new Error(
        `Config validation failed: "routes[${index}]" must be an object`,
      );
    }
    return {
      address: validateRequiredString(
        route.address,
        `routes[${index}].address`,
      ),
      url: validateRequiredString(route.url, `routes[${index}].url`),
    };
  });

  const host = validateRequiredString(parsed.host, "host");
  const username = validateRequiredString(parsed.username, "username");
  const password = validateRequiredString(parsed.password, "password");

  if (
    typeof parsed.port !== "number" ||
    !Number.isInteger(parsed.port) ||
    parsed.port <= 0
  ) {
    throw new Error(
      'Config validation failed: "port" must be a positive integer',
    );
  }

  if (typeof parsed.secure !== "boolean") {
    throw new Error('Config validation failed: "secure" must be a boolean');
  }

  let pollIntervalSeconds = 60;
  if (parsed.pollIntervalSeconds !== undefined) {
    if (
      typeof parsed.pollIntervalSeconds !== "number" ||
      !Number.isFinite(parsed.pollIntervalSeconds) ||
      parsed.pollIntervalSeconds <= 0
    ) {
      throw new Error(
        'Config validation failed: "pollIntervalSeconds" must be a positive number',
      );
    }
    pollIntervalSeconds = parsed.pollIntervalSeconds;
  }

  const mailbox =
    parsed.mailbox === undefined
      ? "INBOX"
      : validateRequiredString(parsed.mailbox, "mailbox");
  const dbPath =
    parsed.dbPath === undefined
      ? "./mailhooks.db"
      : validateRequiredString(parsed.dbPath, "dbPath");
  const proxy = validateOptionalString(parsed.proxy, "proxy");
  const logLevel =
    validateOptionalEnum(parsed.logLevel, "logLevel", LOG_LEVELS) ?? "info";
  const logFormat =
    validateOptionalEnum(parsed.logFormat, "logFormat", LOG_FORMATS) ?? "auto";

  return {
    host,
    port: parsed.port,
    secure: parsed.secure,
    proxy,
    username,
    password,
    mailbox,
    pollIntervalSeconds,
    dbPath,
    routes: validatedRoutes,
    logLevel,
    logFormat,
  };
}
