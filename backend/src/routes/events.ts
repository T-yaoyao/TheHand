import { Router } from 'express'
import type { Request, Response } from 'express'

/**
 * SSE 事件路由
 * 为前端提供实时状态推送
 */
export const eventsRouter = Router()

// 存储活跃的 SSE 连接
const clients = new Map<string, Response>()

/**
 * GET /api/events/:id — 订阅需求的实时事件 (SSE)
 */
eventsRouter.get('/:id', (req: Request, res: Response) => {
  const requirementId = req.params.id as string

  // 设置 SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', requirementId })}\n\n`)

  // 存储连接
  clients.set(requirementId, res)

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n')
  }, 15000)

  // 清理
  req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(requirementId)
  })
})

/**
 * POST /api/events/:id — 推送事件给指定需求的订阅者
 * 供 Orchestrator 内部调用
 */
eventsRouter.post('/:id', (req: Request, res: Response) => {
  const requirementId = req.params.id as string
  const event = req.body

  const client = clients.get(requirementId)
  if (client) {
    client.write(`data: ${JSON.stringify(event)}\n\n`)
    res.json({ ok: true, delivered: true })
  } else {
    res.json({ ok: true, delivered: false, message: '无活跃订阅者' })
  }
})

/**
 * 广播事件给所有订阅者
 */
export function broadcastEvent(event: any): void {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients.values()) {
    client.write(data)
  }
}

/**
 * 向指定需求推送事件
 */
export function pushEvent(requirementId: string, event: any): void {
  const client = clients.get(requirementId)
  if (client) {
    client.write(`data: ${JSON.stringify(event)}\n\n`)
  }
}
