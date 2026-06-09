import type { LogLevel } from '../types.js';
/**
 * 结构化日志系统
 *
 * 替代散落的 console.log/console.warn，提供：
 * 1. 统一日志格式（JSON 结构化）
 * 2. 日志级别控制
 * 3. 模块标签
 * 4. 可选 traceId / requirementId 关联
 */
export declare class Logger {
    private static globalLevel;
    private static instances;
    private readonly module;
    private traceId?;
    private requirementId?;
    private constructor();
    /**
     * 获取或创建指定模块的 Logger 实例
     */
    static for(module: string): Logger;
    /**
     * 设置全局日志级别
     */
    static setLevel(level: LogLevel): void;
    /**
     * 获取当前全局日志级别
     */
    static getLevel(): LogLevel;
    /**
     * 创建带 trace 上下文信息的子 logger
     */
    withContext(traceId?: string, requirementId?: string): Logger;
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    private log;
    private shouldLog;
    private format;
}
/**
 * 工厂函数，兼容旧代码中 createLogger(moduleName) 的用法
 * 等价于 Logger.for(moduleName)
 */
export declare function createLogger(module: string): Logger;
//# sourceMappingURL=logger.d.ts.map