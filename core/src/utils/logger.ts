import type { LogLevel, LogEntry } from '../types.js'

/**
 * 结构化日志系统
 * 
 * 替代散落的 console.log/console.warn，提供：
 * 1. 统一日志格式（JSON 结构化）
 * 2. 日志级别控制
 * 3. 模块标签
 * 4. 可选 traceId / requirementId 关联
 */
export class Logger {
  private static globalLevel: LogLevel = 'info'
  private static instances: Map<string, Logger> = new Map()
  
  private readonly module: string
  private traceId?: string
  private requirementId?: string

  private constructor(module: string) {
    this.module = module
  }

  /**
   * 获取或创建指定模块的 Logger 实例
   */
  static for(module: string): Logger {
    let instance = Logger.instances.get(module)
    if (!instance) {
      instance = new Logger(module)
      Logger.instances.set(module, instance)
    }
    return instance
  }

  /**
   * 设置全局日志级别
   */
  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level
  }

  /**
   * 获取当前全局日志级别
   */
  static getLevel(): LogLevel {
    return Logger.globalLevel
  }

  /**
   * 创建带 trace 上下文信息的子 logger
   */
  withContext(traceId?: string, requirementId?: string): Logger {
    const child = new Logger(this.module)
    child.traceId = traceId
    child.requirementId = requirementId
    return child
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data)
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data)
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data)
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data,
      traceId: this.traceId,
      requirementId: this.requirementId,
    }

    const formatted = this.format(entry)

    switch (level) {
      case 'error':
        console.error(formatted)
        break
      case 'warn':
        console.warn(formatted)
        break
      case 'debug':
        console.debug(formatted)
        break
      default:
        console.log(formatted)
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(Logger.globalLevel)
  }

  private format(entry: LogEntry): string {
    const parts: string[] = [`[${entry.module}]`]
    
    if (entry.traceId) {
      parts.push(`[trace:${entry.traceId.slice(0, 12)}]`)
    }
    if (entry.requirementId) {
      parts.push(`[req:${entry.requirementId.slice(0, 8)}]`)
    }

    parts.push(entry.message)

    if (entry.data && Object.keys(entry.data).length > 0) {
      parts.push(JSON.stringify(entry.data))
    }

    return parts.join(' ')
  }
}

/**
 * 工厂函数，兼容旧代码中 createLogger(moduleName) 的用法
 * 等价于 Logger.for(moduleName)
 */
export function createLogger(module: string): Logger {
  return Logger.for(module)
}
