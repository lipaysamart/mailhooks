// ABOUTME: Pino logger setup with configurable levels
// ABOUTME: Provides structured logging output to stdout

import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

export function createLogger(
  level: LogLevel = "info",
  format: LogFormat = "pretty",
) {
  if (format === "json") {
    return pino({
      level,
      base: {},
    });
  }

  return pino({
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;

export function moduleLogger(logger: Logger, module: string) {
  return logger.child({ module });
}
