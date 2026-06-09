import type { OrchestratorEvent, PhaseContext, AgentContext, FilePlan, RiskAssessment, NaturalLanguageSummary } from '../../types.js'
import { BasePhaseHandler } from '../phase-handler.js'
import { createPlanAgent } from '../../agents/plan-agent.js'
import { transition } from '../state-machine.js'
import { Logger } from '../../utils/logger.js'
import { RiskAssessor } from '../../utils/risk-assessor.js'
import { NaturalSummaryGenerator } from '../../utils/natural-summary-generator.js'
import { sanitizePhantomRouteTablesAgainstEntryTopology } from '../../utils/routing-entry-topology.js'
import { enrichPlanWithIntegrationEntryFiles } from '../../utils/plan-integration-enrich.js'
import { inferRouteEntryContextFromRequirementAndPlan } from '../../utils/plan-route-context-infer.js'
import { join } from 'path'

const log = Logger.for('phase:planning')

/**
 * 方案阶段处理器
 * 
 * 职责：
 * - 基于结构化需求生成技术方案（FilePlan）
 * - 支持自愈重试（最多 3 轮）
 * - 风险评估和自然语言摘要生成
 */
export class PlanningPhase extends BasePhaseHandler {
  readonly name = 'planning'
  private readonly MAX_RETRIES = 3

  async *execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, agentRunner, projectContext, sandbox } = ctx

    yield this.statusChange('planning', 'plan')

    // 删除操作的历史变更提示
    const deleteHistoryHint = await this.buildDeleteHistoryHint(requirement, requirementMemory)

    // 扫描现有组件，避免创建重复
    const existingComponentsHint = await this.scanExistingComponents(sandbox.path, projectContext)

    const planErrors: string[] = []
    let plan: FilePlan[] = []

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      yield this.progress(`planning (attempt ${attempt}/${this.MAX_RETRIES})`, 20)

      let planInput = planErrors.length > 0
        ? requirement.pmInput + '\n\n## 上轮方案生成失败\n' + planErrors[planErrors.length - 1] + '\n请修正后重新生成方案。'
        : requirement.pmInput
      if (deleteHistoryHint) planInput += deleteHistoryHint
      planInput += existingComponentsHint

      const planContext: AgentContext = {
        requirement: { ...requirement, pmInput: planInput },
        projectContext,
        memory: await requirementMemory.getContext(requirement.id, projectContext),
      }

      const planResult = await agentRunner.run(createPlanAgent(), planContext)

      if (planResult.status === 'success' && planResult.output) {
        const parsed = this.parsePlan(planResult.output)
        let includeRouteEntryContext = parsed.includeRouteEntryContext
        const parsedFiles = parsed.files

        if (parsedFiles.length > 0) {
          if (
            !includeRouteEntryContext &&
            inferRouteEntryContextFromRequirementAndPlan(
              requirement.structuredRequirement,
              parsedFiles,
              requirement.pmInput,
            )
          ) {
            includeRouteEntryContext = true
            log.info('嵌套路由/Tab 语义推断：启用 includeRouteEntryContext')
          }

          plan = await this.resolvePlanToExistingFiles(parsedFiles, sandbox.path)
          plan = sanitizePhantomRouteTablesAgainstEntryTopology(plan, sandbox.path, projectContext)
          plan = enrichPlanWithIntegrationEntryFiles(plan, sandbox.path, projectContext, includeRouteEntryContext)
          break
        }
      }

      const errorDetail = planResult.status === 'failed'
        ? `LLM 循环耗尽 (${planResult.inputTokens}/${planResult.outputTokens} tokens)`
        : `输出解析失败或为空 (type=${typeof planResult.output})`
      planErrors.push(`第${attempt}轮: ${errorDetail}`)

      yield this.progress(`plan retry ${attempt}/${this.MAX_RETRIES}: ${errorDetail}`, 20)

      if (attempt === this.MAX_RETRIES) {
        const detailedError = `方案生成失败 (${this.MAX_RETRIES}轮):\n${planErrors.join('\n')}`
        yield { type: 'failed', requirement, error: detailedError, userMessage: '方案生成失败，AI 无法为此需求生成有效方案。请尝试重新描述需求，或简化需求范围后重试。' }
        transition(requirement, 'failed', '方案生成失败')
        await requirementMemory.saveRequirement(requirement)
        await requirementMemory.saveLesson({
          id: crypto.randomUUID(),
          projectId: ctx.projectId,
          requirementId: requirement.id,
          phase: 'planning',
          filePath: null,
          errorSummary: `方案生成失败: ${errorDetail}`,
          errorDetail: detailedError,
          fixHint: null,
          resolved: false,
          createdAt: new Date(),
        })
        return
      }
    }

    // 风险评估 + 自然语言摘要（容错）
    let assessment: RiskAssessment | null = null
    let naturalSummary: NaturalLanguageSummary | null = null
    try {
      yield this.progress('risk-assessment', 25)
      const riskAssessor = new RiskAssessor()
      assessment = requirement.structuredRequirement
        ? riskAssessor.assess(requirement.structuredRequirement, plan)
        : null

      if (requirement.structuredRequirement) {
        const summaryGenerator = new NaturalSummaryGenerator()
        naturalSummary = summaryGenerator.generate(requirement.structuredRequirement, plan)
      }

      if (assessment) {
        requirement.confidenceScore = assessment.score
        requirement.riskLevel = assessment.riskLevel
        requirement.autoApprove = riskAssessor.canAutoApprove(assessment)
        yield { type: 'risk-assessed', requirement, assessment }
      }
      if (naturalSummary) {
        requirement.naturalLanguageSummary = JSON.stringify(naturalSummary) as any
      }
    } catch (err) {
      log.warn('风险评估/摘要生成跳过', { error: String(err) })
    }

    // 方案就绪 → 暂停
    requirement.plan = plan
    transition(requirement, 'plan-ready', '方案生成完成')
    await requirementMemory.saveRequirement(requirement)

    yield {
      type: 'plan-ready',
      plan,
      requirement,
      riskAssessment: assessment ?? undefined,
      naturalSummary: naturalSummary ?? undefined,
    }

    log.info('方案阶段完成', { fileCount: plan.length })
  }

  private async buildDeleteHistoryHint(
    requirement: PhaseContext['requirement'],
    requirementMemory: PhaseContext['requirementMemory'],
  ): Promise<string> {
    const reqType = requirement.structuredRequirement?.type
    if (reqType !== 'delete_page' && reqType !== 'delete_field') return ''

    const keywords = requirement.pmInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
    if (keywords.length === 0 || typeof requirementMemory.findChangesByEntity !== 'function') return ''

    const allFiles = new Set<string>()
    for (const keyword of keywords.slice(0, 3)) {
      const history = await requirementMemory.findChangesByEntity(keyword)
      for (const h of history) {
        for (const f of h.files) allFiles.add(f.filePath)
      }
    }

    if (allFiles.size === 0) return ''
    return `\n\n## 该需求涉及的历史变更文件（必须全部处理）\n以下是之前创建/修改时涉及的所有文件，删除操作必须覆盖这些文件：\n${Array.from(allFiles).map(f => `- ${f}`).join('\n')}`
  }

  private async scanExistingComponents(sandboxPath: string, projectContext: PhaseContext['projectContext']): Promise<string> {
    try {
      const { readdir } = await import('fs/promises')
      const scanDir = async (dir: string, prefix: string = ''): Promise<string[]> => {
        const results: string[] = []
        try {
          const entries = await readdir(dir, { withFileTypes: true })
          for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue
            const relPath = prefix ? `${prefix}/${e.name}` : e.name
            if (e.isDirectory()) {
              results.push(...await scanDir(`${dir}/${e.name}`, relPath))
            } else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
              results.push(relPath)
            }
          }
        } catch {}
        return results
      }

      const componentsDir = projectContext?.thehand?.frontendFramework?.componentsDir ?? 'frontend/src/components'
      const routesDir = projectContext?.thehand?.frontendFramework?.routesDir ?? 'frontend/src/routes'

      const componentFiles = await scanDir(join(sandboxPath, componentsDir))
      const routeFiles = await scanDir(join(sandboxPath, routesDir))

      if (componentFiles.length === 0 && routeFiles.length === 0) return ''

      let hint = '\n\n## 现有前端组件文件（必须修改已有组件，不要创建同名替代品）'
      if (componentFiles.length > 0) {
        hint += '\n### 组件 components/\n' + componentFiles.map(f => `- ${f}`).join('\n')
      }
      if (routeFiles.length > 0) {
        hint += '\n### 路由页面 routes/\n' + routeFiles.map(f => `- ${f}`).join('\n')
      }
      return hint
    } catch {
      return ''
    }
  }

  private parsePlan(output: any): { files: FilePlan[]; includeRouteEntryContext: boolean } {
    let files: FilePlan[] = []
    if (Array.isArray(output)) {
      files = output
    } else if (output?.files && Array.isArray(output.files)) {
      files = output.files
    } else if (output?.plan && Array.isArray(output.plan)) {
      files = output.plan
    }

    let includeRouteEntryContext = false
    if (output && typeof output === 'object' && !Array.isArray(output) && output.includeRouteEntryContext === true) {
      includeRouteEntryContext = true
    }

    return { files, includeRouteEntryContext }
  }

  private async resolvePlanToExistingFiles(plan: FilePlan[], sandboxPath: string): Promise<FilePlan[]> {
    const { access } = await import('fs/promises')
    const resolved: FilePlan[] = []

    for (const file of plan) {
      const fullPath = join(sandboxPath, file.path)

      let exists = false
      try { await access(fullPath); exists = true } catch {}

      if (exists) {
        resolved.push(file)
        continue
      }

      // 查找名称相似的已有文件
      const dir = file.path.split('/').slice(0, -1).join('/')
      const name = file.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? ''
      if (!name) { resolved.push(file); continue }

      const searchDirs = [dir]
      const parts = dir.split('/')
      for (let i = parts.length - 1; i >= 0; i--) {
        searchDirs.push(parts.slice(0, i).join('/'))
      }

      let bestMatch: string | null = null
      for (const searchDir of searchDirs) {
        if (!searchDir) continue
        try {
          const entries = await this.listFilesRecursive(join(sandboxPath, searchDir))
          for (const entry of entries) {
            const entryName = entry.replace(/\.(jsx?|tsx|vue)$/, '').split('/').pop() ?? ''
            if (!entryName) continue
            if (entryName.toLowerCase() === name.toLowerCase() ||
                entryName.toLowerCase() === name.toLowerCase() + 's' ||
                name.toLowerCase() === entryName.toLowerCase() + 's' ||
                (entryName.length > 3 && name.length > 3 &&
                 (entryName.toLowerCase().includes(name.toLowerCase()) ||
                  name.toLowerCase().includes(entryName.toLowerCase())))) {
              bestMatch = `${searchDir}/${entry}`
              break
            }
          }
          if (bestMatch) break
        } catch {}
      }

      if (bestMatch) {
        const existingPath = bestMatch.replace(/\\/g, '/')
        log.info(`plan-resolve: ${file.path} → ${existingPath}`)
        resolved.push({
          path: existingPath,
          changeDescription: `[自动修正] 原计划创建 ${file.path}，但 ${existingPath} 已存在。${file.changeDescription}`,
          priority: file.priority,
        })
      } else {
        resolved.push(file)
      }
    }

    return resolved
  }

  private async listFilesRecursive(dirPath: string, maxDepth: number = 3): Promise<string[]> {
    const { readdir } = await import('fs/promises')
    const results: string[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue
          if (e.isDirectory()) {
            await walk(`${dir}/${e.name}`, depth + 1)
          } else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
            results.push(e.name)
          }
        }
      } catch {}
    }

    await walk(dirPath, 0)
    return results
  }
}
