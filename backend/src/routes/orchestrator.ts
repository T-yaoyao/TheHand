import { Router } from 'express'
import type { Request, Response } from 'express'
import { pushEvent } from './events.js'

/**
 * Orchestrator 触发路由
 * POST /api/orchestrator/run — 启动需求处理流水线
 */
export const orchestratorRouter = Router()

/**
 * POST /api/orchestrator/run/:id — 对指定需求运行 Orchestrator
 *
 * 请求体：
 * { projectId?: string }
 *
 * 通过 SSE 推送实时状态
 */
orchestratorRouter.post('/run/:id', async (req: Request, res: Response) => {
  const requirementId = req.params.id as string
  const { projectId = 'conduit' } = req.body ?? {}

  // 立即返回，异步执行
  res.json({ ok: true, message: 'Orchestrator 已启动', requirementId })

  // 通过 SSE 推送启动事件
  pushEvent(requirementId, {
    type: 'orchestrator-started',
    requirementId,
    projectId,
  })

  // 注意：实际的 Orchestrator 执行需要在 CLI 或独立进程中运行
  // 这里只是一个触发点，SSE 事件由 Orchestrator 的 AsyncGenerator 推送
  // 在完整实现中，这里会启动一个后台任务
})

/**
 * GET /api/orchestrator/status — 获取 Orchestrator 状态
 */
orchestratorRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    activeConnections: 0, // TODO: 从 events 路由获取
    message: 'Orchestrator 就绪',
  })
})
