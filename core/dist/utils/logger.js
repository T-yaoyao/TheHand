/**
 * 结构化日志模块
 * 统一的日志接口，支持级别控制和结构化输出
 */
const LOG_LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function getEnvLogLevel() {
    const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
    if (env in LOG_LEVEL_PRIORITY)
        return env;
    return 'info';
}
const globalLevel = getEnvLogLevel();
function shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalLevel];
}
function formatTimestamp() {
    return new Date().toISOString();
}
function formatEntry(entry) {
    const { timestamp, level, module, message, data } = entry;
    const prefix = `${timestamp} [${level.toUpperCase()}] [${module}] ${message}`;
    if (data !== undefined) {
        const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        return `${prefix}\n${serialized}`;
    }
    return prefix;
}
export class Logger {
    module;
    constructor(module) {
        this.module = module;
    }
    debug(message, data) {
        if (!shouldLog('debug'))
            return;
        const entry = { timestamp: formatTimestamp(), level: 'debug', module: this.module, message, data };
        console.debug(formatEntry(entry));
    }
    info(message, data) {
        if (!shouldLog('info'))
            return;
        const entry = { timestamp: formatTimestamp(), level: 'info', module: this.module, message, data };
        console.info(formatEntry(entry));
    }
    warn(message, data) {
        if (!shouldLog('warn'))
            return;
        const entry = { timestamp: formatTimestamp(), level: 'warn', module: this.module, message, data };
        console.warn(formatEntry(entry));
    }
    error(message, data) {
        if (!shouldLog('error'))
            return;
        const entry = { timestamp: formatTimestamp(), level: 'error', module: this.module, message, data };
        console.error(formatEntry(entry));
    }
    /** 创建子模块 logger */
    child(subModule) {
        return new Logger(`${this.module}:${subModule}`);
    }
}
/** 创建模块 logger 的工厂函数 */
export function createLogger(module) {
    return new Logger(module);
}
/** 全局默认 logger */
export const logger = createLogger('thehand');
//# sourceMappingURL=logger.js.map