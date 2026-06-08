/**
 * 结构化日志模块
 * 统一的日志接口，支持级别控制和结构化输出
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export declare class Logger {
    private module;
    constructor(module: string);
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    /** 创建子模块 logger */
    child(subModule: string): Logger;
}
/** 创建模块 logger 的工厂函数 */
export declare function createLogger(module: string): Logger;
/** 全局默认 logger */
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map