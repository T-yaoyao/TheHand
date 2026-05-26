import { Router } from 'express'
import type { Request, Response } from 'express'
import { queryOne } from '../db.js'
import { isOrchestratorRunning, runOrchestratorForRequirement } from '../orchestrator-runner.js'
import { getActiveConnectionCount } from './events.js'
import { log } from '../logger.js'

export const orchestratorRouter = Router()

/**
 * POST /api/orchestrator/run/:id — 启动 Orchestrator 流水线
 */
orchestratorRouter.post('/run/:id', async (req: Request, res: Response) => {
  const requirementId = req.params.id as string
  const { projectId = 'conduit' } = req.body ?? {}

  const existing = queryOne('SELECT id FROM requirements WHERE id = ?', [requirementId])
  if (!existing) {
    res.status(404).json({ error: '需求不存在' })
    return
  }

  if (isOrchestratorRunning(requirementId)) {
    res.status(409).json({ error: '该需求正在运行中' })
    return
  }

  log.info(`[api] POST /orchestrator/run/${requirementId.slice(0, 8)}…`)

  res.json({ ok: true, message: 'Orchestrator 已启动', requirementId, projectId })

  runOrchestratorForRequirement(requirementId, projectId).catch((e) => {
    log.error('[orchestrator] 后台任务未捕获异常:', e)
  })
})

/**
 * GET /api/orchestrator/status — 服务状态
 */
orchestratorRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    activeSseConnections: getActiveConnectionCount(),
    message: 'Orchestrator 就绪',
  })
})
