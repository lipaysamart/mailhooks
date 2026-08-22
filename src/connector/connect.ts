import { ImapFlow, type Logger as ImapLogger } from "imapflow";
import type { Config } from "../config/config.ts";
import { type Logger, log } from "../log/logger.ts";

const logger = log.child("imap");

// Bridges ImapFlow's pino-style logger ({msg, err, ...} objects) to ours.
// Lines are emitted at debug level, so they stay hidden unless level=debug.
function imapLoggerBridge(target: Logger): ImapLogger {
  const wrap =
    (level: "debug" | "info" | "warn" | "error") =>
    (obj: unknown): void => {
      const record =
        typeof obj === "object" && obj !== null
          ? (obj as Record<string, unknown>)
          : { msg: String(obj) };
      const { msg, err, ...fields } = record;
      target[level](
        typeof msg === "string" ? msg : "imap",
        err instanceof Error ? { ...fields, err } : fields,
      );
    };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}

export async function connect(config: Config) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    proxy: config.proxy,
    logger: imapLoggerBridge(logger),
    disableAutoIdle: true,
    auth: {
      user: config.username,
      pass: config.password,
    },
  });

  try {
    await client.connect();
    logger.debug("connected", { host: config.host, port: config.port });
    return client;
  } catch (err) {
    client.close();
    throw new Error(
      `Failed to connect: ${err instanceof Error ? err.message : err}`,
    );
  }
}
