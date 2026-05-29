import { Router } from 'express'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { queryAll, queryOne, execute } from '../db.js'
import { isOrchestratorRunning, runOrchestratorForRequirement } from '../orchestrator-runner.js'
import { log } from '../logger.js'

export const requirementsRouter = Router()

const VALID_STATUSES = ['idle', 'clarifying', 'clarified', 'waiting-for-pm', 'planning', 'plan-approved', 'plan-rejected', 'coding', 'testing', 'done', 'failed']

/**
 * POST /api/requirements — 创建需求
 */
requirementsRouter.post('/', (req: Request, res: Response) => {
  const { input } = req.body

  if (!input || typeof input !== 'string') {
    res.status(400).json({ error: '请提供需求描述' })
    return
  }

  try {
    const id = randomUUID()
    execute(
      `INSERT INTO requirements (id, status, pm_input) VALUES (?, 'idle', ?)`,
      [id, input.trim()]
    )
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id])
    res.status(201).json(requirement)
  } catch (e: any) {
    res.status(500).json({ error: `创建需求失败: ${e.message}` })
  }
})

/**
 * GET /api/requirements — 获取所有需求
 */
requirementsRouter.get('/', (_req: Request, res: Response) => {
  const requirements = queryAll('SELECT * FROM requirements ORDER BY created_at DESC')
  res.json(requirements)
})

/**
 * GET /api/requirements/:id — 获取单个需求
 */
requirementsRouter.get('/:id', (req: Request, res: Response) => {
  const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [req.params.id])
  if (!requirement) {
    res.status(404).json({ error: '需求不存在' })
    return
  }
  res.json(requirement)
})

/**
 * PATCH /api/requirements/:id — 更新需求
 */
requirementsRouter.patch('/:id', (req: Request, res: Response) => {
  const { status, structuredRequirement, plan } = req.body
  const id = req.params.id

  const existing = queryOne('SELECT * FROM requirements WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: '需求不存在' })
    return
  }

  const updates: string[] = []
  const params: any[] = []

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `无效状态: ${status}，允许的值: ${VALID_STATUSES.join(', ')}` })
      return
    }
    updates.push('status = ?')
    params.push(status)
  }
  if (structuredRequirement !== undefined) {
    updates.push('structured_requirement = ?')
    params.push(structuredRequirement === null ? null : (typeof structuredRequirement === 'string' ? structuredRequirement : JSON.stringify(structuredRequirement)))
  }
  if (plan !== undefined) {
    updates.push('plan = ?')
    params.push(plan === null ? null : (typeof plan === 'string' ? plan : JSON.stringify(plan)))
  }

  if (updates.length === 0) {
    res.status(400).json({ error: '没有需要更新的字段' })
    return
  }

  updates.push("updated_at = datetime('now')")
  params.push(id)

  execute(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, params)

  const updated = queryOne('SELECT * FROM requirements WHERE id = ?', [id])
  res.json(updated)
})

/**
 * POST /api/requirements/:id/conversations — 添加对话
 */
requirementsRouter.post('/:id/conversations', (req: Request, res: Response) => {
  const { role, content, round } = req.body
  const requirementId = req.params.id as string

  if (!role || !content) {
    res.status(400).json({ error: '请提供 role 和 content' })
    return
  }

  // 校验 requirement 是否存在
  const requirementExists = queryOne('SELECT id FROM requirements WHERE id = ?', [requirementId])
  if (!requirementExists) {
    res.status(404).json({ error: '需求不存在' })
    return
  }

  const id = randomUUID()
  execute(
    `INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, ?, ?, ?)`,
    [id, requirementId, role, content.trim(), round ?? 1]
  )

  // PM 回复后，如果需求处于 clarifying 状态，自动重新触发流水线
  if (role === 'pm') {
    const requirement = queryOne('SELECT status FROM requirements WHERE id = ?', [requirementId]) as { status: string } | undefined
    if ((requirement?.status === 'waiting-for-pm' || requirement?.status === 'clarifying') && !isOrchestratorRunning(requirementId)) {
      log.info(`[api] PM 回复，自动重新触发 orchestrator id=${requirementId.slice(0, 8)}…`)
      runOrchestratorForRequirement(requirementId).catch((e: unknown) => {
        log.error('[orchestrator] 自动重触发异常:', e)
      })
    }
  }

  res.status(201).json({ id, requirement_id: requirementId, role, content, round: round ?? 1 })
})

/**
 * GET /api/requirements/:id/conversations — 获取对话
 */
requirementsRouter.get('/:id/conversations', (req: Request, res: Response) => {
  const conversations = queryAll(
    'SELECT * FROM conversations WHERE requirement_id = ? ORDER BY created_at ASC',
    [req.params.id]
  )
  res.json(conversations)
})

/**
 * DELETE /api/requirements/:id — 删除需求
 */
requirementsRouter.delete('/:id', (req: Request, res: Response) => {
  const id = req.params.id
  try {
    execute('DELETE FROM conversations WHERE requirement_id = ?', [id])
    execute('DELETE FROM executions WHERE requirement_id = ?', [id])
    execute('DELETE FROM requirements WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: `删除失败: ${e.message}` })
  }
})
