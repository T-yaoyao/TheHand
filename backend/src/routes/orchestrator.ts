import { Router } from 'express'
import type { Request, Response } from 'express'
import { queryOne, queryAll } from '../db.js'
import { getDefaultProjectId } from '@thehand/core'
import { isOrchestratorRunning, runOrchestratorForRequirement } from '../orchestrator-runner.js'
import { getActiveConnectionCount } from './events.js'
import { log } from '../logger.js'

export const orchestratorRouter = Router()

/**
 * POST /api/orchestrator/run/:id — 启动 Orchestrator 流水线
 */
orchestratorRouter.post('/run/:id', async (req: Request, res: Response) => {
  const requirementId = req.params.id as string
  const { projectId = getDefaultProjectId() } = req.body ?? {}

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

/**
 * GET /api/orchestrator/metrics — 系统监控指标
 */
orchestratorRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const requirements = queryAll('SELECT * FROM requirements')
    const executions = queryAll('SELECT * FROM executions')

    const totalRequirements = requirements.length
    const completedRequirements = requirements.filter(r => r.status === 'done').length
    const failedRequirements = requirements.filter(r => r.status === 'failed').length

    const totalInputTokens = executions.reduce((sum, e) => sum + (e.input_tokens || 0), 0)
    const totalOutputTokens = executions.reduce((sum, e) => sum + (e.output_tokens || 0), 0)
    const totalEstimatedCost = executions.reduce((sum, e) => sum + (e.estimated_cost || 0), 0)

    const durations = requirements
      .filter(r => r.status === 'done' && r.created_at && r.updated_at)
      .map(r => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())

    const averageDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0

    const agentPerformance: Record<string, any> = {}
    const agentGroups: Record<string, any[]> = {}
    for (const e of executions) {
      if (!agentGroups[e.agent]) agentGroups[e.agent] = []
      agentGroups[e.agent].push(e)
    }

    for (const [agentName, records] of Object.entries(agentGroups)) {
      const successCount = records.filter(r => r.status === 'success').length
      agentPerformance[agentName] = {
        count: records.length,
        successRate: records.length > 0 ? successCount / records.length : 0,
        averageLatencyMs: records.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / records.length,
      }
    }

    res.json({
      totalRequirements,
      completedRequirements,
      failedRequirements,
      averageDurationMs,
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCost,
      successRate: totalRequirements > 0 ? completedRequirements / totalRequirements : 0,
      agentPerformance,
    })
  } catch (e) {
    log.error('[metrics] 获取指标失败:', e)
    res.json({
      totalRequirements: 0,
      completedRequirements: 0,
      failedRequirements: 0,
      averageDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedCost: 0,
      successRate: 0,
      agentPerformance: {},
    })
  }
})
