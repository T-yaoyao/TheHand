/**
 * RunLogger — 捕获每次 CLI 运行的终端输出，写入日志文件
 *
 * 用法:
 *   import { RunLogger } from './log.mjs'
 *   const logger = new RunLogger('orchestrator')  // or 'cli'
 *   logger.start(pmInput)
 *   // ... 所有 console.log / console.error 自动捕获 ...
 *   logger.end()
 *
 * 日志文件存储在 ./logs/ 目录，格式: {type}-{ISO时间}.log
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = resolve(__dirname, 'logs')

export class RunLogger {
  /**
   * @param {'orchestrator'|'cli'} type — 运行类型，影响日志文件名前缀
   */
  constructor(type = 'orchestrator') {
    this.type = type
    this.logFile = null
    this.startTime = null
    this._originalConsole = {}
  }

  /**
   * 开始记录：创建日志文件，劫持 console 方法
   * @param {string} pmInput — PM 输入的需求描述
   */
  start(pmInput) {
    mkdirSync(LOG_DIR, { recursive: true })

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    this.logFile = resolve(LOG_DIR, `${this.type}-${ts}.log`)
    this.startTime = Date.now()

    // 写入日志头
    const header = [
      `# TheHand Run Log`,
      `type: ${this.type}`,
      `started: ${new Date().toISOString()}`,
      `pm_input: ${pmInput}`,
      `${'─'.repeat(60)}`,
      '',
    ].join('\n')
    writeFileSync(this.logFile, header, 'utf-8')

    // 劫持 console 方法
    this._originalConsole.log = console.log
    this._originalConsole.error = console.error
    this._originalConsole.warn = console.warn

    const self = this

    console.log = (...args) => {
      self._originalConsole.log(...args)
      self._write('LOG', args)
    }

    console.error = (...args) => {
      self._originalConsole.error(...args)
      self._write('ERR', args)
    }

    console.warn = (...args) => {
      self._originalConsole.warn(...args)
      self._write('WRN', args)
    }
  }

  /**
   * 结束记录：写入日志尾，恢复 console
   */
  end() {
    // 恢复 console
    if (this._originalConsole.log) {
      console.log = this._originalConsole.log
      console.error = this._originalConsole.error
      console.warn = this._originalConsole.warn
    }

    if (!this.logFile) return

    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1)
    const footer = [
      '',
      `${'─'.repeat(60)}`,
      `finished: ${new Date().toISOString()}`,
      `duration: ${duration}s`,
    ].join('\n')
    appendFileSync(this.logFile, footer, 'utf-8')

    return this.logFile
  }

  /** @private */
  _write(level, args) {
    if (!this.logFile) return
    const ts = new Date().toISOString().slice(11, 23)
    const msg = args
      .map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
      .join(' ')
    appendFileSync(this.logFile, `[${ts}] [${level}] ${msg}\n`, 'utf-8')
  }
}
