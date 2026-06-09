import { Router } from 'express'
import type { Request, Response } from 'express'
import { log } from '../logger.js'

/**
 * SSE 事件路由
 * 为前端提供实时状态推送
 *
 * 内存管理：
 * - 单个 requirement 最多保留 30 个 SSE 连接
 * - 心跳间隔 15s，连续 3 次无响应自动断开
 * - 定期清理已完成的 requirement 连接
 */
export const eventsRouter = Router()

// 存储活跃的 SSE 连接（支持同一 requirement 多个标签页）
const clients = new Map<string, Set<Response>>()

// 单个 requirement 最大连接数
const MAX_CONNECTIONS_PER_REQUIREMENT = 30
// 已完成的 requirement ID 集合（用于清理）
const completedRequirements = new Set<string>()

export function getActiveConnectionCount(): number {
  let count = 0
  for (const set of clients.values()) count += set.size
  return count
}

/**
 * GET /api/events/:id — 订阅需求的实时事件 (SSE)
 */
eventsRouter.get('/:id', (req: Request, res: Response) => {
  const requirementId = req.params.id as string

  // 限制单 requirement 连接数
  const existing = clients.get(requirementId)
  if (existing && existing.size >= MAX_CONNECTIONS_PER_REQUIREMENT) {
    res.writeHead(429, { 'Content-Type': 'text/plain' })
    res.end('Too many connections for this requirement')
    return
  }

  // 设置 SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', requirementId })}\n\n`)

  // 存储连接（支持多标签页）
  if (!clients.has(requirementId)) {
    clients.set(requirementId, new Set())
  }
  clients.get(requirementId)!.add(res)
  log.info(`[sse] 连接 requirement=${requirementId.slice(0, 8)}… (共 ${getActiveConnectionCount()} 路)`)

  // 心跳保活
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n') } catch {}
  }, 15000)

  // 清理
  req.on('close', () => {
    clearInterval(heartbeat)
    const set = clients.get(requirementId)
    if (set) {
      set.delete(res)
      if (set.size === 0) clients.delete(requirementId)
    }
    log.info(`[sse] 断开 requirement=${requirementId.slice(0, 8)}… (剩余 ${getActiveConnectionCount()} 路)`)
  })
})

/**
 * POST /api/events/:id — 推送事件给指定需求的订阅者
 * 供 Orchestrator 内部调用
 */
eventsRouter.post('/:id', (req: Request, res: Response) => {
  const requirementId = req.params.id as string
  const event = req.body

  const set = clients.get(requirementId)
  if (set && set.size > 0) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const client of set) {
      try { client.write(data) } catch {}
    }
    res.json({ ok: true, delivered: set.size })
  } else {
    res.json({ ok: true, delivered: false, message: '无活跃订阅者' })
  }
})

/**
 * 广播事件给所有订阅者
 */
export function broadcastEvent(event: any): void {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const [id, set] of clients) {
    for (const client of set) {
      try { client.write(data) } catch { set.delete(client) }
    }
    if (set.size === 0) clients.delete(id)
  }
}

/**
 * 向指定需求推送事件
 */
export function pushEvent(requirementId: string, event: any): void {
  const set = clients.get(requirementId)
  if (set && set.size > 0) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    const deadClients: Response[] = []
    for (const client of set) {
      try {
        client.write(data)
      } catch {
        deadClients.push(client)
      }
    }
    // 批量清理死连接
    for (const dead of deadClients) set.delete(dead)
    if (set.size === 0) clients.delete(requirementId)
  }
}

/**
 * 标记 requirement 为已完成，清理其 SSE 连接释放内存
 */
export function cleanupRequirement(requirementId: string): void {
  completedRequirements.add(requirementId)
  const set = clients.get(requirementId)
  if (set) {
    for (const client of set) {
      try { client.end() } catch {}
    }
    clients.delete(requirementId)
  }
  // 限制 completedRequirements 集合大小
  if (completedRequirements.size > 100) {
    const first = completedRequirements.values().next().value
    if (first) completedRequirements.delete(first)
  }
}
