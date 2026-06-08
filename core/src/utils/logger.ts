/**
 * 结构化日志模块
 * 统一的日志接口，支持级别控制和结构化输出
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: unknown
}

function getEnvLogLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  if (env in LOG_LEVEL_PRIORITY) return env as LogLevel
  return 'info'
}

const globalLevel = getEnvLogLevel()

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalLevel]
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function formatEntry(entry: LogEntry): string {
  const { timestamp, level, module, message, data } = entry
  const prefix = `${timestamp} [${level.toUpperCase()}] [${module}] ${message}`
  if (data !== undefined) {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    return `${prefix}\n${serialized}`
  }
  return prefix
}

export class Logger {
  constructor(private module: string) {}

  debug(message: string, data?: unknown): void {
    if (!shouldLog('debug')) return
    const entry: LogEntry = { timestamp: formatTimestamp(), level: 'debug', module: this.module, message, data }
    console.debug(formatEntry(entry))
  }

  info(message: string, data?: unknown): void {
    if (!shouldLog('info')) return
    const entry: LogEntry = { timestamp: formatTimestamp(), level: 'info', module: this.module, message, data }
    console.info(formatEntry(entry))
  }

  warn(message: string, data?: unknown): void {
    if (!shouldLog('warn')) return
    const entry: LogEntry = { timestamp: formatTimestamp(), level: 'warn', module: this.module, message, data }
    console.warn(formatEntry(entry))
  }

  error(message: string, data?: unknown): void {
    if (!shouldLog('error')) return
    const entry: LogEntry = { timestamp: formatTimestamp(), level: 'error', module: this.module, message, data }
    console.error(formatEntry(entry))
  }

  /** 创建子模块 logger */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`)
  }
}

/** 创建模块 logger 的工厂函数 */
export function createLogger(module: string): Logger {
  return new Logger(module)
}

/** 全局默认 logger */
export const logger = createLogger('thehand')
