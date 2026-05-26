import { type Database } from 'sql.js';
/**
 * 初始化数据库
 */
export declare function initDB(): Promise<Database>;
/**
 * 持久化数据库到文件
 */
export declare function saveDB(): void;
/**
 * 获取数据库实例
 */
export declare function getDB(): Database;
/**
 * 查询多行
 */
export declare function queryAll(sql: string, params?: any[]): any[];
/**
 * 查询单行
 */
export declare function queryOne(sql: string, params?: any[]): any | null;
/**
 * 执行写操作
 */
export declare function execute(sql: string, params?: any[]): void;
//# sourceMappingURL=db.d.ts.map