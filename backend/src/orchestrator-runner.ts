import { resolve } from 'path'
import {
  LLMClient,
  PromptManager,
  AgentRunner,
  SkillRegistry,
  DockerSandboxManager,
  ProjectMemory,
  RequirementMemory,
  Orchestrator,
  createFileReadTool,
  createFileWriteTool,
  createShellTool,
} from '@thehand/core'
import type { OrchestratorEvent } from '@thehand/core'
import { DbRequirementMemory, loadRequirementFromDb } from './db-requirement-memory.js'
import { execute, queryOne } from './db.js'
import { pushEvent } from './routes/events.js'
import { log } from './logger.js'

const repoRoot = resolve(process.cwd(), '..')
const sandboxSource = resolve(repoRoot, 'sandbox-repo', 'conduit-realworld-example-app')

const runningJobs = new Set<string>()

let depsPromise: Promise<{
  orchestrator: Orchestrator
  llmClient: LLMClient
}> | null = null

async function getDeps() {
  if (!depsPromise) {
    depsPromise = (async () => {
      const llmClient = new LLMClient()
      const promptManager = new PromptManager(resolve(repoRoot, 'prompts'))
      const projectMemory = new ProjectMemory(resolve(repoRoot, 'projects'))
      const requirementMemory = new DbRequirementMemory() as unknown as RequirementMemory
      const sandboxManager = new DockerSandboxManager(sandboxSource, {
        network: process.env.SANDBOX_NETWORK ?? 'bridge',
        memory: process.env.SANDBOX_MEMORY ?? '1g',
        cpus: process.env.SANDBOX_CPUS ?? '1.0',
      })

      const tools = [
        createFileReadTool(sandboxSource),
        createFileWriteTool(sandboxSource),
        createShellTool(sandboxSource),
      ]

      const agentRunner = new AgentRunner(llmClient, tools, sandboxSource)
      const skillRegistry = new SkillRegistry()
      skillRegistry.setLLMClient(llmClient)
      await skillRegistry.discover(resolve(repoRoot, 'projects/conduit'))

      const orchestrator = new Orchestrator({
        agentRunner,
        llmClient,
        promptManager,
        skillRegistry,
        sandboxManager,
        projectMemory,
        requirementMemory,
      })

      return { orchestrator, llmClient }
    })()
  }
  return depsPromise
}

export function isOrchestratorRunning(requirementId: string): boolean {
  return runningJobs.has(requirementId)
}

/**
 * 在后台运行 Orchestrator，事件通过 SSE 推送给前端
 */
export async function runOrchestratorForRequirement(
  requirementId: string,
  projectId = 'conduit',
): Promise<void> {
  if (runningJobs.has(requirementId)) {
    throw new Error('该需求正在运行中，请稍候')
  }

  const requirement = loadRequirementFromDb(requirementId)
  if (!requirement) {
    throw new Error('需求不存在')
  }

  if (!process.env.DOUBAO_API_KEY?.trim()) {
    throw new Error('未配置 DOUBAO_API_KEY，请在项目根目录 .env 中设置')
  }

  runningJobs.add(requirementId)
  const startedAt = Date.now()
  const previousStatus = requirement.status

  // ── 重跑时重置状态：failed/done → clarifying ──
  if (previousStatus === 'failed' || previousStatus === 'done') {
    requirement.status = 'clarifying'
    execute(
      `UPDATE requirements SET status = 'clarifying', updated_at = datetime('now') WHERE id = ?`,
      [requirementId],
    )
    log.info(`[orchestrator] 重置状态: failed/done → clarifying`)
  }

  log.info(`[orchestrator] 开始 id=${requirementId.slice(0, 8)}… project=${projectId}`)
  log.info(`[orchestrator] PM: ${requirement.pmInput.slice(0, 80)}${requirement.pmInput.length > 80 ? '…' : ''}`)

  pushEvent(requirementId, {
    type: 'orchestrator-started',
    requirementId,
    projectId,
  })

  // 立即推送状态变更事件，让前端同步
  pushEvent(requirementId, {
    type: 'status-change',
    status: 'clarifying',
    agent: 'orchestrator-runner',
  })

  let eventCount = 0

  try {
    const { orchestrator, llmClient } = await getDeps()

    for await (const event of orchestrator.run(requirement, projectId)) {
      eventCount++
      pushEvent(requirementId, serializeEvent(event, requirementId))
      logOrchestratorEvent(requirementId, event)

      if (event.type === 'completed' || event.type === 'failed' || event.type === 'waiting-for-pm' || event.type === 'plan-ready' || event.type === 'diff-ready') {
        // waiting-for-pm 时立即释放 runningJobs，让 PM 回复能重新触发流水线
        if (event.type === 'waiting-for-pm' || event.type === 'plan-ready' || event.type === 'diff-ready') {
          runningJobs.delete(requirementId)
        }
        break
      }
    }

    const stats = llmClient.getStats()
    log.info(
      `[orchestrator] 结束 id=${requirementId.slice(0, 8)}… events=${eventCount} ` +
        `耗时=${((Date.now() - startedAt) / 1000).toFixed(1)}s ` +
        `tokens=${stats.inputTokens}/${stats.outputTokens} 成本≈¥${stats.estimatedCost.toFixed(4)}`,
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    // 仅在状态未终态时覆盖为 failed（避免编排器已完成但清理沙箱时异常导致误标 failed）
    const current = queryOne('SELECT status FROM requirements WHERE id = ?', [requirementId]) as { status: string } | undefined
    const currentStatus = current?.status ?? ''
    if (currentStatus !== 'done' && currentStatus !== 'failed') {
      execute(`UPDATE requirements SET status = 'failed', updated_at = datetime('now') WHERE id = ?`, [requirementId])
    }
    pushEvent(requirementId, {
      type: 'failed',
      requirement: { id: requirementId, status: currentStatus === 'done' ? 'done' : 'failed' },
      error: message,
    })
    log.error(`[orchestrator] 异常 id=${requirementId.slice(0, 8)}…`, message)
  } finally {
    runningJobs.delete(requirementId)
  }
}

function logOrchestratorEvent(requirementId: string, event: OrchestratorEvent): void {
  const id = requirementId.slice(0, 8)
  switch (event.type) {
    case 'status-change':
      log.info(`[orchestrator] ${id} 状态 → ${event.status} (${event.agent})`)
      break
    case 'executing':
      log.info(`[orchestrator] ${id} 执行 ${event.phase} (${event.progress}%)`)
      break
    case 'plan-ready':
      log.info(`[orchestrator] ${id} 方案就绪 ${event.plan?.length ?? 0} 个文件`)
      break
    case 'test-result':
      log.info(`[orchestrator] ${id} 测试 ${event.passed ? '通过' : '失败'}`)
      break
    case 'waiting-for-pm':
      log.info(`[orchestrator] ${id} 等待 PM 澄清 (${event.questions?.length ?? 0} 问)`)
      break
    case 'completed':
      log.info(`[orchestrator] ${id} ✅ 完成`)
      break
    case 'failed':
      log.info(`[orchestrator] ${id} ❌ 失败: ${event.error}`)
      break
    default:
      break
  }
}

function serializeEvent(event: OrchestratorEvent, requirementId: string): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(event, (_key, value) => {
      if (value instanceof Date) return value.toISOString()
      return value
    }),
  ) as Record<string, unknown>
}
