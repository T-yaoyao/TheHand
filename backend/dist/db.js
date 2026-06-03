import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
const DB_DIR = resolve(process.cwd(), '..', 'data');
const DB_PATH = resolve(DB_DIR, 'thehand.db');
// 确保 data 目录存在
mkdirSync(DB_DIR, { recursive: true });
let db;
/**
 * 初始化数据库
 */
export async function initDB() {
    const SQL = await initSqlJs();
    if (existsSync(DB_PATH)) {
        const buffer = readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    }
    else {
        db = new SQL.Database();
    }
    // 建表
    db.run(`
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      pm_input TEXT NOT NULL,
      structured_requirement TEXT,
      plan TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (requirement_id) REFERENCES requirements(id)
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      skill TEXT,
      input TEXT,
      output TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (requirement_id) REFERENCES requirements(id)
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      requirement_id TEXT,
      phase TEXT NOT NULL,
      file_path TEXT,
      error_summary TEXT NOT NULL,
      error_detail TEXT,
      fix_hint TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS change_history (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (requirement_id) REFERENCES requirements(id)
    )
  `);
    // 迁移：给 lessons 表添加 requirement_id 列（兼容旧数据库）
    try {
        db.run(`ALTER TABLE lessons ADD COLUMN requirement_id TEXT`);
    }
    catch {
        // 列已存在，忽略
    }
    // 迁移：给 requirements 表添加增强功能新字段
    try {
        db.run(`ALTER TABLE requirements ADD COLUMN confidence_score INTEGER DEFAULT 0`);
    }
    catch { }
    try {
        db.run(`ALTER TABLE requirements ADD COLUMN risk_level TEXT DEFAULT 'medium'`);
    }
    catch { }
    try {
        db.run(`ALTER TABLE requirements ADD COLUMN natural_language_summary TEXT`);
    }
    catch { }
    try {
        db.run(`ALTER TABLE requirements ADD COLUMN trace_id TEXT`);
    }
    catch { }
    try {
        db.run(`ALTER TABLE requirements ADD COLUMN auto_approve INTEGER DEFAULT 0`);
    }
    catch { }
    saveDB();
    return db;
}
/**
 * 持久化数据库到文件
 */
export function saveDB() {
    if (!db)
        return;
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
}
/**
 * 获取数据库实例
 */
export function getDB() {
    if (!db)
        throw new Error('数据库未初始化，请先调用 initDB()');
    return db;
}
/**
 * 查询多行
 */
export function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}
/**
 * 查询单行
 */
export function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results[0] ?? null;
}
/**
 * 执行写操作
 */
export function execute(sql, params = []) {
    db.run(sql, params);
    saveDB();
}
/**
 * 批量执行写操作（事务包裹，只落盘一次）
 */
export function executeBatch(operations) {
    db.run('BEGIN TRANSACTION');
    try {
        for (const op of operations) {
            db.run(op.sql, op.params ?? []);
        }
        db.run('COMMIT');
    }
    catch (e) {
        db.run('ROLLBACK');
        throw e;
    }
    saveDB();
}
//# sourceMappingURL=db.js.map