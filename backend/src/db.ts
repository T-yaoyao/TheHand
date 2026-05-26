import initSqlJs, { type Database } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DB_DIR = resolve(process.cwd(), '..', 'data')
const DB_PATH = resolve(DB_DIR, 'thehand.db')

// 确保 data 目录存在
mkdirSync(DB_DIR, { recursive: true })

let db: Database

/**
 * 初始化数据库
 */
export async function initDB(): Promise<Database> {
  const SQL = await initSqlJs()

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
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
  `)

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
  `)

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
  `)

  saveDB()
  return db
}

/**
 * 持久化数据库到文件
 */
export function saveDB(): void {
  if (!db) return
  const data = db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
}

/**
 * 获取数据库实例
 */
export function getDB(): Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initDB()')
  return db
}

/**
 * 查询多行
 */
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/**
 * 查询单行
 */
export function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params)
  return results[0] ?? null
}

/**
 * 执行写操作
 */
export function execute(sql: string, params: any[] = []): void {
  db.run(sql, params)
  saveDB()
}
