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
    static globalLevel = 'info';
    static instances = new Map();
    module;
    traceId;
    requirementId;
    constructor(module) {
        this.module = module;
    }
    /**
     * 获取或创建指定模块的 Logger 实例
     */
    static for(module) {
        let instance = Logger.instances.get(module);
        if (!instance) {
            instance = new Logger(module);
            Logger.instances.set(module, instance);
        }
        return instance;
    }
    /**
     * 设置全局日志级别
     */
    static setLevel(level) {
        Logger.globalLevel = level;
    }
    /**
     * 获取当前全局日志级别
     */
    static getLevel() {
        return Logger.globalLevel;
    }
    /**
     * 创建带 trace 上下文信息的子 logger
     */
    withContext(traceId, requirementId) {
        const child = new Logger(this.module);
        child.traceId = traceId;
        child.requirementId = requirementId;
        return child;
    }
    debug(message, data) {
        this.log('debug', message, data);
    }
    info(message, data) {
        this.log('info', message, data);
    }
    warn(message, data) {
        this.log('warn', message, data);
    }
    error(message, data) {
        this.log('error', message, data);
    }
    log(level, message, data) {
        if (!this.shouldLog(level))
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            module: this.module,
            message,
            data,
            traceId: this.traceId,
            requirementId: this.requirementId,
        };
        const formatted = this.format(entry);
        switch (level) {
            case 'error':
                console.error(formatted);
                break;
            case 'warn':
                console.warn(formatted);
                break;
            case 'debug':
                console.debug(formatted);
                break;
            default:
                console.log(formatted);
        }
    }
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(Logger.globalLevel);
    }
    format(entry) {
        const parts = [`[${entry.module}]`];
        if (entry.traceId) {
            parts.push(`[trace:${entry.traceId.slice(0, 12)}]`);
        }
        if (entry.requirementId) {
            parts.push(`[req:${entry.requirementId.slice(0, 8)}]`);
        }
        parts.push(entry.message);
        if (entry.data && Object.keys(entry.data).length > 0) {
            parts.push(JSON.stringify(entry.data));
        }
        return parts.join(' ');
    }
}
/**
 * 工厂函数，兼容旧代码中 createLogger(moduleName) 的用法
 * 等价于 Logger.for(moduleName)
 */
export function createLogger(module) {
    return Logger.for(module);
}
//# sourceMappingURL=logger.js.map