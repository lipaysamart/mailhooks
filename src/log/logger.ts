export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "auto" | "pretty" | "json";
export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  level?: string;
  format?: string;
  /** Output sink; defaults to process.stdout. Injectable for tests. */
  sink?: (line: string) => void;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(component: string): Logger;
}

interface LoggerState {
  level: number;
  format: "pretty" | "json";
  sink: (line: string) => void;
}

const LEVEL_NUM: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function normalizeLevel(level: string | undefined): LogLevel {
  return level !== undefined && level in LEVEL_NUM
    ? (level as LogLevel)
    : "info";
}

function resolveFormat(format: string | undefined): "pretty" | "json" {
  if (format === "pretty" || format === "json") return format;
  return process.stdout.isTTY ? "pretty" : "json";
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function formatTime(date: Date): string {
  return (
    `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:` +
    `${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
  );
}

function prettyValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function serializeField(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function formatPretty(
  date: Date,
  level: LogLevel,
  component: string | undefined,
  msg: string,
  fields: LogFields | undefined,
): string {
  const useColor = Boolean(process.stdout.isTTY);
  const paint = (color: string, text: string) =>
    useColor ? `${color}${text}${RESET}` : text;

  let line = `${formatTime(date)} ${paint(LEVEL_COLOR[level], LEVEL_LABEL[level].padEnd(5))}`;
  if (component) line += ` ${paint(GRAY, `[${component}]`)}`;
  line += ` ${msg}`;

  const stacks: string[] = [];
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      line += ` ${key}=${prettyValue(value)}`;
      if (value instanceof Error && value.stack) {
        stacks.push(
          value.stack
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );
      }
    }
  }
  if (stacks.length > 0) line += `\n${stacks.join("\n")}`;
  return line;
}

function formatJson(
  date: Date,
  level: LogLevel,
  component: string | undefined,
  msg: string,
  fields: LogFields | undefined,
): string {
  const record: Record<string, unknown> = {
    time: date.toISOString(),
    level,
    ...(component ? { component } : {}),
    msg,
  };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      record[key] = serializeField(value);
    }
  }
  return JSON.stringify(record);
}

function makeLogger(state: LoggerState, component: string | undefined): Logger {
  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_NUM[level] < state.level) return;
    const date = new Date();
    const line =
      state.format === "json"
        ? formatJson(date, level, component, msg, fields)
        : formatPretty(date, level, component, msg, fields);
    state.sink(line);
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (childComponent: string) => makeLogger(state, childComponent),
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const state: LoggerState = {
    level: LEVEL_NUM[normalizeLevel(options.level)],
    format: resolveFormat(options.format),
    sink: options.sink ?? ((line) => process.stdout.write(`${line}\n`)),
  };
  return makeLogger(state, undefined);
}

// Module singleton: modules import `log` and derive children from it.
// configureLogger() is called once at startup from index.ts.
const rootState: LoggerState = {
  level: LEVEL_NUM.info,
  format: resolveFormat("auto"),
  sink: (line) => process.stdout.write(`${line}\n`),
};

export const log: Logger = makeLogger(rootState, undefined);

export function configureLogger(options: LoggerOptions = {}): void {
  rootState.level = LEVEL_NUM[normalizeLevel(options.level)];
  rootState.format = resolveFormat(options.format);
  if (options.sink) rootState.sink = options.sink;
}
