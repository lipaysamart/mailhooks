// ABOUTME: Pino logger setup with configurable levels
// ABOUTME: Provides structured logging output to stdout

import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function createLogger(level: LogLevel = 'info') {
  return pino({
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '[{module}] {msg}'
      }
    }
  })
}

export type Logger = ReturnType<typeof createLogger>

export function moduleLogger(logger: Logger, module: string) {
  return logger.child({ module })
}