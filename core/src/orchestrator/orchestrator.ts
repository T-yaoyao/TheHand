import type {
  Requirement,
  RequirementStatus,
  AgentDefinition,
  OrchestratorEvent,
  AgentResult,
  ProjectContext,
  AgentContext,
  StructuredRequirement,
  FilePlan,
  RiskAssessment,
  NaturalLanguageSummary,
  FileValidationSummary,
} from '../types.js'
import type { AgentRunner } from '../agents/agent-runner.js'
import type { SkillRegistry } from '../skill-registry/skill-registry.js'
import type { LLMClient } from '../llm/llm-client.js'
import type { PromptManager } from '../llm/prompt-manager.js'
import { runClarification } from '../agents/clarification-agent.js'
import { createPlanAgent } from '../agents/plan-agent.js'
import { runCoding, runCodingBatch, extractInterfaceSummary } from '../agents/coding-agent.js'
import { extractFileSkeletons, extractFileInterfaces, runArchitect } from '../agents/architect-agent.js'
import { join, dirname } from 'path'
import type { Sandbox } from '../git-ops/sandbox.js'
import type { DockerSandboxManager } from '../git-ops/docker-sandbox.js'
import type { CommandExecutor } from '../git-ops/executor.js'
import { TestRunner } from '../git-ops/test-runner.js'
import { RepoManager } from '../git-ops/repo-manager.js'
import { RequirementMemory } from '../memory/requirement-memory.js'
import { ProjectMemory } from '../memory/project-memory.js'
import { RiskAssessor } from '../utils/risk-assessor.js'
import { NaturalSummaryGenerator } from '../utils/natural-summary-generator.js'
import { DiffSafetyChecker } from '../utils/diff-safety-checker.js'
import { globalTracer } from '../utils/tracer.js'

export interface SandboxManagerLike {
  create(id?: string): Promise<Sandbox>
  getExisting?(sandboxId: string): Sandbox | null
  applyToSource(sandbox: Sandbox, files: string[], commitMessage?: string): Promise<void>
  cleanupAll(): Promise<void>
  getActiveCount(): number
}

export interface OrchestratorDeps {
  agentRunner: AgentRunner
  llmClient: LLMClient
  promptManager: PromptManager
  skillRegistry: SkillRegistry
  sandboxManager: SandboxManagerLike
  projectMemory: ProjectMemory
  requirementMemory: RequirementMemory
}

/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 支持多阶段暂停：plan-ready → 用户审批 → coding → diff-ready → 用户确认 → commit
 */
export class Orchestrator {
  private sandboxShouldCleanup = true

  constructor(private deps: OrchestratorDeps) {}

  /**
   * 主循环：根据需求状态调度对应 Agent
   * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
   *
   * 状态流转：
   *   idle/clarifying → 澄清 → 方案 → plan-ready（暂停，等审批）
   *   plan-approved → 编码 → 测试 → diff-ready（暂停，等确认）
   *   diff-ready → commit → apply → done
   */
  async *run(requirement: Requirement, projectId: string = 'conduit'): AsyncGenerator<OrchestratorEvent> {
    const { agentRunner, llmClient, promptManager, skillRegistry, sandboxManager, projectMemory, requirementMemory } = this.deps
    this.sandboxShouldCleanup = true

    // ── 深度集成：全链路追踪初始化（全容错保护，绝不卡流程） ──
    try {
      if (!requirement.traceId) {
        requirement.traceId = globalTracer.startTrace()
        yield { type: 'executing', phase: `trace-id: ${requirement.traceId.slice(0, 16)}…`, progress: 0 }
      }
    } catch (enhanceErr) {
      // 追踪初始化失败绝不影响原有主流程，静默跳过
      console.warn('[enhancements] 全链路追踪跳过:', enhanceErr)
    }

    // 1. 创建沙箱（resume 时复用已有沙箱，所有状态都复用，绝不重复创建）
    let sandbox: Sandbox
    const existingSandbox = sandboxManager.getExisting?.(requirement.id)
    if (existingSandbox) {
      sandbox = existingSandbox
      yield { type: 'executing', phase: 'sandbox-reused', progress: 5 }
    } else {
      yield { type: 'executing', phase: 'sandbox-create', progress: 0 }
      sandbox = await sandboxManager.create(requirement.id)
      yield { type: 'executing', phase: 'sandbox-ready', progress: 5 }
    }

    // 初始化执行器（Docker 沙箱时命令在容器内执行）
    const executor: CommandExecutor | undefined =
      'getExecutor' in sandboxManager
        ? (sandboxManager as DockerSandboxManager).getExecutor(sandbox)
        : undefined
    const testRunner = new TestRunner(sandbox.path, executor)
    const repoManager = new RepoManager(sandbox.path, executor)

    // 确保依赖已安装（复用沙箱时可能缺失）
    if (executor && existingSandbox) {
      try {
        const check = await executor('test -f node_modules/.bin/vite && echo ok || echo missing', { timeout: 5_000 })
        if (check.stdout.trim() === 'missing') {
          yield { type: 'executing', phase: 'installing dependencies', progress: 8 }
          await executor('npm install', { timeout: 180_000 })
        }
      } catch {}
    }

    // 加载项目上下文
    const projectContext = await projectMemory.load(projectId)

    try {
      // ── 状态检测：根据当前阶段跳转到对应入口 ──
      if (requirement.status === 'diff-ready') {
        // 跳转到提交阶段（用户已确认 diff）
        yield* this.phaseCommit(requirement, requirementMemory, repoManager, sandboxManager, sandbox)
        return
      }

      if (requirement.status === 'plan-ready' && requirement.plan) {
        // 跳转到编码阶段（用户已确认方案）
        yield* this.phaseCoding(requirement, projectId, requirementMemory, skillRegistry, llmClient, promptManager, projectContext, testRunner, repoManager, sandboxManager, sandbox, executor)
        return
      }

      // ── 完整流水线：澄清 → 方案 → 编码 → 暂停等确认 ──

      // 2. 澄清阶段
      yield { type: 'status-change', status: 'clarifying', agent: 'clarification' }

      const recentConvs = await requirementMemory.getRecentConversations(requirement.id, 50)
      const pmReplies = recentConvs.filter(c => c.role === 'pm')
      const currentRound = 1 + pmReplies.length

      let pmInput = requirement.pmInput
      if (
        (requirement.status === 'clarifying' || requirement.status === 'waiting-for-pm' || requirement.status === 'needs-confirmation') &&
        pmReplies.length > 0
      ) {
        pmInput = pmReplies.map(c => c.content).join('\n')
      }

      const previousQuestions = recentConvs
        .filter(c => c.role === 'system')
        .map(c => c.content)

      const clarificationResult = await runClarification(
        llmClient,
        promptManager,
        pmInput,
        projectContext,
        requirement.structuredRequirement,
        currentRound,
        previousQuestions,
        pmReplies.map(c => c.content),
      )

      if (clarificationResult.needsMoreInfo) {
        const questions = clarificationResult.questions ?? []
        for (const q of questions) {
          await requirementMemory.addConversation({
            id: crypto.randomUUID(),
            requirementId: requirement.id,
            role: 'system',
            content: q,
            round: clarificationResult.round,
            createdAt: new Date(),
          })
        }

        // 必须在 yield 之前保存到 DB，因为 for-await break 会触发 generator.return() 跳过 yield 之后的代码
        // 使用 waiting-for-pm 与「澄清进行中 clarifying」区分：前者才表示已有追问、等待 PM 回复
        requirement.status = 'waiting-for-pm'
        requirement.structuredRequirement = clarificationResult.requirement
        await requirementMemory.saveRequirement(requirement)

        this.sandboxShouldCleanup = false  // 暂停点，保留沙箱供后续 resume
        yield {
          type: 'waiting-for-pm',
          requirement: { ...requirement, status: 'waiting-for-pm' },
          questions,
        }
        return
      }

      requirement.structuredRequirement = clarificationResult.requirement

      // 隐患2修复：如果是第3轮兜底生成的默认需求，进入needs-confirmation状态等待PM确认
      if (requirement.structuredRequirement?.isDefaulted) {
        requirement.status = 'needs-confirmation'
        await requirementMemory.saveRequirement(requirement)
        this.sandboxShouldCleanup = false
        await requirementMemory.addConversation({
          id: crypto.randomUUID(),
          requirementId: requirement.id,
          role: 'system',
          content: '⚠️ 信息不足，系统已用合理默认值填充结构化需求，请确认后继续。',
          round: currentRound,
          createdAt: new Date(),
        })
        yield {
          type: 'waiting-for-pm',
          requirement: { ...requirement, status: 'needs-confirmation' },
          questions: ['当前需求信息不完整，系统已自动填充默认值，请确认结构化需求是否正确，确认后继续生成方案。'],
        }
        return
      }

      requirement.status = 'clarified'
      await requirementMemory.saveRequirement(requirement)

      // 澄清完成，保存提示消息给用户
      await requirementMemory.addConversation({
        id: crypto.randomUUID(),
        requirementId: requirement.id,
        role: 'system',
        content: '✅ 澄清完成，开始生成方案…',
        round: currentRound,
        createdAt: new Date(),
      })
      yield { type: 'status-change', status: 'clarified', agent: 'clarification' }

      // 3. 方案阶段（自愈重试，最多 3 轮）
      yield { type: 'status-change', status: 'planning', agent: 'plan' }

      // 如果是删除操作，查询相关变更历史
      let deleteHistoryHint = ''
      const reqType = requirement.structuredRequirement?.type
      if (reqType === 'delete_page' || reqType === 'delete_field') {
        const keywords = requirement.pmInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
        if (keywords.length > 0 && typeof requirementMemory.findChangesByEntity === 'function') {
          const allFiles = new Set<string>()
          for (const keyword of keywords.slice(0, 3)) {
            const history = await requirementMemory.findChangesByEntity(keyword)
            for (const h of history) {
              for (const f of h.files) allFiles.add(f.filePath)
            }
          }
          if (allFiles.size > 0) {
            deleteHistoryHint = `\n\n## 该需求涉及的历史变更文件（必须全部处理）\n以下是之前创建/修改时涉及的所有文件，删除操作必须覆盖这些文件：\n${Array.from(allFiles).map(f => `- ${f}`).join('\n')}`
          }
        }
      }

      const MAX_RETRIES = 3
      let plan: FilePlan[] = []
      const planErrors: string[] = []

      for (let planAttempt = 1; planAttempt <= MAX_RETRIES; planAttempt++) {
        yield { type: 'executing', phase: `planning (attempt ${planAttempt}/${MAX_RETRIES})`, progress: 20 }

        let planInput = planErrors.length > 0
          ? requirement.pmInput + '\n\n## 上轮方案生成失败\n' + planErrors[planErrors.length - 1] + '\n请修正后重新生成方案。'
          : requirement.pmInput
        if (deleteHistoryHint) {
          planInput += deleteHistoryHint
        }

        const planContext: AgentContext = {
          requirement: { ...requirement, pmInput: planInput },
          projectContext,
          memory: await requirementMemory.getContext(requirement.id, projectContext),
        }

        const planResult = await agentRunner.run(createPlanAgent(), planContext)

        if (planResult.status === 'success' && planResult.output) {
          const parsed = this.parsePlan(planResult.output)
          if (parsed.length > 0) {
            plan = parsed
            break
          }
        }

        const errorDetail = planResult.status === 'failed'
          ? `LLM 循环耗尽 (${planResult.inputTokens}/${planResult.outputTokens} tokens)`
          : `输出解析失败或为空 (type=${typeof planResult.output})`
        planErrors.push(`第${planAttempt}轮: ${errorDetail}`)

        yield { type: 'executing', phase: `plan retry ${planAttempt}/${MAX_RETRIES}: ${errorDetail}`, progress: 20 }

        if (planAttempt === MAX_RETRIES) {
          const detailedError = `方案生成失败 (${MAX_RETRIES}轮):\n${planErrors.join('\n')}`
          yield { type: 'failed', requirement, error: detailedError, userMessage: '方案生成失败，AI 无法为此需求生成有效方案。请尝试重新描述需求，或简化需求范围后重试。' }
          requirement.status = 'failed'
          await requirementMemory.saveRequirement(requirement)
          await requirementMemory.saveLesson({
            id: crypto.randomUUID(),
            projectId,
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

      // ── 深度集成：自动风险评估 + 大白话摘要生成（全容错保护，绝不卡流程） ──
      let assessment: RiskAssessment | null = null
      let naturalSummary: NaturalLanguageSummary | null = null
      try {
        yield { type: 'executing', phase: 'risk-assessment', progress: 25 }
        const riskAssessor = new RiskAssessor()
        assessment = requirement.structuredRequirement
          ? riskAssessor.assess(requirement.structuredRequirement, plan)
          : null

        if (requirement.structuredRequirement) {
          const summaryGenerator = new NaturalSummaryGenerator()
          naturalSummary = summaryGenerator.generate(requirement.structuredRequirement, plan)
        }

        // 保存评估结果到需求对象
        if (assessment) {
          requirement.confidenceScore = assessment.score
          requirement.riskLevel = assessment.riskLevel
          requirement.autoApprove = riskAssessor.canAutoApprove(assessment)
          yield { type: 'risk-assessed', requirement, assessment }
        }
        if (naturalSummary) {
          requirement.naturalLanguageSummary = JSON.stringify(naturalSummary) as any
        }
      } catch (enhanceErr) {
        // 增强功能失败绝不影响原有主流程，静默跳过
        console.warn('[enhancements] 风险评估/摘要生成跳过:', enhanceErr)
      }

      // 方案就绪 → 暂停，等用户审批
      requirement.plan = plan
      requirement.status = 'plan-ready'
      await requirementMemory.saveRequirement(requirement)
      this.sandboxShouldCleanup = false  // 暂停点，保留沙箱供后续 resume
      yield { type: 'plan-ready', plan, requirement, riskAssessment: assessment ?? undefined, naturalSummary: naturalSummary ?? undefined }
      return

    } catch (e: any) {
      if (requirement.status !== 'done' && requirement.status !== 'failed') {
        yield { type: 'failed', requirement, error: e.message }
        requirement.status = 'failed'
        await requirementMemory.saveRequirement(requirement)
      }
    } finally {
      if (this.sandboxShouldCleanup) {
        try { await sandbox.cleanup() } catch {}
      }
    }
  }

  /**
   * 编码+测试阶段（支持从 plan-approved 状态直接进入）
   */
  private async *phaseCoding(
    requirement: Requirement,
    projectId: string,
    requirementMemory: RequirementMemory,
    skillRegistry: SkillRegistry,
    llmClient: LLMClient,
    promptManager: PromptManager,
    projectContext: ProjectContext,
    testRunner: TestRunner,
    repoManager: RepoManager,
    sandboxManager: SandboxManagerLike,
    sandbox: Sandbox,
    executor: CommandExecutor | undefined,
  ): AsyncGenerator<OrchestratorEvent> {
    yield { type: 'status-change', status: 'coding', agent: 'coding' }

    const skill = requirement.structuredRequirement
      ? skillRegistry.match(requirement.structuredRequirement)
      : null

    const MAX_RETRIES = 3
    const codeErrors: string[] = []
    const { writeFile, mkdir, rm } = await import('fs/promises')
    const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' }
    const pastLessons = await requirementMemory.getLessons(projectId, 'coding', 5)
    let codeOutputs: { path: string; content: string; summary: string }[] = []
    let previousOutputs: { path: string; content: string; summary: string }[] = []
    let finalFileValidationSummary: FileValidationSummary | null = null

    for (let codeAttempt = 1; codeAttempt <= MAX_RETRIES; codeAttempt++) {
      yield { type: 'executing', phase: `coding (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 30 }

      let codingHint = ''
      if (pastLessons.length > 0) {
        codingHint = '\n\n## 历史失败教训（请避免重复以下错误）\n' +
          pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n')
      }

      codeOutputs = []

      if (skill) {
        yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 35 }
        const skillOutputs = await skill.execute(requirement.structuredRequirement!, projectContext)
        codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }))
      } else {
        const planFiles = requirement.plan ?? []
        const lastTestError = codeErrors.length > 0 ? codeErrors[codeErrors.length - 1] : undefined
        const errorHintCombined = [
          codingHint || '',
          lastTestError ? `\n\n## 上轮测试失败\n${lastTestError}\n请分析错误根因并修正代码。` : '',
          codeAttempt > 1 && previousOutputs.length > 0
            ? '\n\n## 上轮生成的代码（仅供参考）\n' + previousOutputs.map(f => `- ${f.path}: ${f.summary}`).join('\n')
            : '',
        ].filter(Boolean).join('')

        if (planFiles.length <= 2) {
          // 小 plan：直接走原路径，不引入 Architect 开销
          yield { type: 'executing', phase: `coding-agent (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 35 }
          codeOutputs = await runCoding(
            llmClient, promptManager, planFiles, sandbox.path,
            projectContext,
            codingHint || undefined,
            codeAttempt > 1 ? previousOutputs : undefined,
            lastTestError,
          )
        } else {
          // 大 plan：三层渐进式上下文压缩
          // Layer 1: 结构扫描
          yield { type: 'executing', phase: `analyzing ${planFiles.length} file structures`, progress: 32 }
          const skeletons = await extractFileSkeletons(sandbox.path, planFiles)

          // Layer 2: 接口提取
          yield { type: 'executing', phase: `extracting interfaces from ${planFiles.length} files`, progress: 33 }
          const fileInterfaces = await extractFileInterfaces(sandbox.path, planFiles)

          // Layer 3: Architect Agent
          yield { type: 'executing', phase: 'architect analyzing dependencies...', progress: 34 }
          const manifest = await runArchitect(
            llmClient, promptManager, planFiles, skeletons, fileInterfaces, projectContext,
          )
          console.log(`[architect] manifest: ${manifest.batches.length} batches, files: ${manifest.files.map(f => f.path).join(', ')}`)

          // 分批 Coding
          const generatedSummaries = new Map<string, string>()
          for (let bi = 0; bi < manifest.batches.length; bi++) {
            const batch = manifest.batches[bi]
            yield {
              type: 'executing',
              phase: `coding batch ${bi + 1}/${manifest.batches.length}: ${batch.files.join(', ')}`,
              progress: 35 + Math.floor(bi * 30 / manifest.batches.length),
            }

            const batchOutputs = await runCodingBatch(
              llmClient, promptManager, batch, manifest,
              { globalContext: manifest.globalContext, generatedSummaries },
              sandbox.path, projectContext,
              errorHintCombined || undefined,
            )
            codeOutputs.push(...batchOutputs)

            // 提取本批次的接口摘要供后续批次使用
            for (const output of batchOutputs) {
              generatedSummaries.set(output.path, extractInterfaceSummary(output))
            }
          }
        }
      }

      // ──────────────────────────────────────────────────────────────
      // 分级告警兜底机制 v1.0
      // 从"静默兜底"升级为"三级分级处理"，彻底杜绝静默失败
      // ──────────────────────────────────────────────────────────────
      yield { type: 'executing', phase: 'validating-files', progress: 50 }
      const planFilesFull = requirement.plan ?? []
      const { readFile } = await import('fs/promises')

      // ── 辅助判定函数 ──
      function isCriticalFile(changeDesc: string): boolean {
        const CRITICAL_KEYWORDS = [
          '新增', 'add', 'Add', 'ADD',
          '修改', 'update', 'Update', 'UPDATE',
          '重构', 'refactor', 'Refactor',
          '删除', 'delete', 'Delete', 'DELETE',
          '实现', 'implement', 'Implement',
        ]
        const lower = changeDesc.toLowerCase()
        return CRITICAL_KEYWORDS.some(k => lower.includes(k.toLowerCase()))
      }

      function isSafeToFallback(filePath: string, changeDesc: string): boolean {
        const SAFE_EXT_PATTERNS = [/\.md$/, /\.txt$/, /\.json$/, /\.yaml$/, /\.yml$/]
        if (SAFE_EXT_PATTERNS.some(p => p.test(filePath))) return true
        
        const SUSPICIOUS_KEYWORDS = ['参考', '查看', '阅读', 'refer', 'read', '了解', '分析', 'analyze']
        const lowerDesc = changeDesc.toLowerCase()
        return SUSPICIOUS_KEYWORDS.some(k => lowerDesc.includes(k.toLowerCase()))
      }

      // ── 1. 构建文件映射表 ──
      const fileMap = new Map<string, { path: string; content: string; summary: string }>()
      for (const output of codeOutputs) {
        if (output.path) {
          fileMap.set(output.path, output)
        }
      }

      // ── 2. 分级校验所有 plan 文件 ──
      const fullyGenerated: string[] = []
      const fallbackOriginal: string[] = []
      const criticalMissing: string[] = []

      for (const planFile of planFilesFull) {
        if (fileMap.has(planFile.path)) {
          fullyGenerated.push(planFile.path)
          continue
        }

        console.log(`[coding] LLM 未返回文件: ${planFile.path}, desc: ${planFile.changeDescription.slice(0, 60)}`)

        if (isCriticalFile(planFile.changeDescription)) {
          // Level 2: 关键文件缺失 → 绝对不兜底，标记为严重错误
          criticalMissing.push(planFile.path)
        } else if (isSafeToFallback(planFile.path, planFile.changeDescription)) {
          // Level 1: 安全文件 → 用原始内容兜底，记录告警
          try {
            const originalContent = await readFile(join(sandbox.path, planFile.path), 'utf-8')
            fileMap.set(planFile.path, {
              path: planFile.path,
              content: originalContent,
              summary: `[WARNING] LLM 未返回该文件变更，保留原始内容`,
            })
            fallbackOriginal.push(planFile.path)
          } catch {
            // 兜底失败，创建空文件占位
            fileMap.set(planFile.path, {
              path: planFile.path,
              content: '',
              summary: planFile.changeDescription,
            })
            fallbackOriginal.push(planFile.path + ' (empty)')
          }
        } else {
          // 可疑文件 → 保守策略：直接归为 criticalMissing，本轮失败重试
          criticalMissing.push(planFile.path)
        }
      }

      // ── 3. 生成文件校验摘要事件 ──
      const fileValidationSummary: FileValidationSummary = {
        totalPlanFiles: planFilesFull.length,
        fullyGenerated,
        fallbackOriginal,
        noChangeDetected: [],
        criticalMissing,
      }
      finalFileValidationSummary = fileValidationSummary
      yield { type: 'file-validation', summary: fileValidationSummary }

      // ── 4. 关键文件缺失 → 本轮直接失败，进入重试 ──
      if (criticalMissing.length > 0) {
        const err = `关键文件生成失败，LLM 未返回核心变更文件: ${criticalMissing.join(', ')}`
        codeErrors.push(`第${codeAttempt}轮: ${err}`)
        yield {
          type: 'executing',
          phase: `critical-missing: ${criticalMissing.length} 个关键文件未返回`,
          progress: 52,
          warnings: criticalMissing,
        }

        if (codeAttempt === MAX_RETRIES) {
          const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
          yield { type: 'failed', requirement, error: detailedError, userMessage: `关键代码文件生成失败，AI 遗漏了核心变更文件：${criticalMissing.join(', ')}。请尝试重新描述需求，或简化需求范围后重试。` }
          requirement.status = 'failed'
          await requirementMemory.saveRequirement(requirement)
          await requirementMemory.saveLesson({
            id: crypto.randomUUID(),
            projectId,
            requirementId: requirement.id,
            phase: 'coding',
            filePath: null,
            errorSummary: `关键文件缺失: ${criticalMissing.join(', ')}`,
            errorDetail: detailedError,
            fixHint: null,
            resolved: false,
            createdAt: new Date(),
          })
          return
        }
        continue
      }

      // ── 5. 有兜底文件 → 推送黄色告警事件 ──
      if (fallbackOriginal.length > 0) {
        yield {
          type: 'executing',
          phase: `warning: ${fallbackOriginal.length} 个文件保留原始内容`,
          progress: 55,
          warnings: fallbackOriginal,
        }
      }

      // ── 6. 最终结果校验 ──
      const validOutputs = Array.from(fileMap.values())
      console.log(`[coding] 文件校验完成: 总plan=${planFilesFull.length}, 正常生成=${fullyGenerated.length}, 兜底=${fallbackOriginal.length}`)

      if (validOutputs.length === 0) {
        const err = '编码阶段未生成有效文件'
        codeErrors.push(`第${codeAttempt}轮: ${err}`)

        if (codeAttempt === MAX_RETRIES) {
          const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
          yield { type: 'failed', requirement, error: detailedError, userMessage: '代码生成失败，AI 未能生成有效的代码文件。请检查需求描述是否清晰，或联系开发者排查。' }
          requirement.status = 'failed'
          await requirementMemory.saveRequirement(requirement)
          await requirementMemory.saveLesson({
            id: crypto.randomUUID(),
            projectId,
            requirementId: requirement.id,
            phase: 'coding',
            filePath: null,
            errorSummary: err,
            errorDetail: detailedError,
            fixHint: null,
            resolved: false,
            createdAt: new Date(),
          })
          return
        }
        continue
      }

      // ── 隐患7修复：先清理所有残留的 .orig 文件，避免旧备份污染本轮校验 ──
      const { unlink, readdir } = await import('fs/promises')
      try {
        const walkDir = async (dir: string): Promise<string[]> => {
          const results: string[] = []
          const entries = await readdir(dir, { withFileTypes: true })
          for (const e of entries) {
            const fullPath = join(dir, e.name)
            if (e.isDirectory()) {
              results.push(...(await walkDir(fullPath)))
            } else if (e.name.endsWith('.orig')) {
              results.push(fullPath)
            }
          }
          return results
        }
        const oldOrigFiles = await walkDir(sandbox.path)
        for (const f of oldOrigFiles) {
          await unlink(f).catch(() => {})
        }
        console.log(`[coding] 清理了 ${oldOrigFiles.length} 个残留的 .orig 文件`)
      } catch {}

      // ── 7. 写入前备份原始文件，用于后续 Diff 空变更检测 ──
      yield { type: 'executing', phase: 'writing-files', progress: 60 }
      for (const file of validOutputs) {
        const fullPath = join(sandbox.path, file.path)
        const origBackupPath = fullPath + '.orig'
        try {
          const exists = await readFile(fullPath, 'utf-8')
          await writeFile(origBackupPath, exists, 'utf-8')
        } catch {
          // 原文件不存在，创建空备份
          await mkdir(dirname(origBackupPath), { recursive: true })
          await writeFile(origBackupPath, '', 'utf-8')
        }
      }

      // ── 8. 写入所有文件 ──
      for (const file of validOutputs) {
        const fullPath = join(sandbox.path, file.path)
        if (file.content.trim().includes('__DELETE__')) {
          try {
            await rm(fullPath, { force: true })
            yield { type: 'executing', phase: `deleted: ${file.path}`, progress: 60 }
          } catch {
            yield { type: 'executing', phase: `delete skipped: ${file.path} (not found)`, progress: 60 }
          }
        } else {
          await mkdir(dirname(fullPath), { recursive: true })
          await writeFile(fullPath, file.content, 'utf-8')
          yield { type: 'executing', phase: `wrote: ${file.path}`, progress: 60 }
        }
      }

      // ── 9. Diff 空变更检测：检查每个计划修改的文件是否真的产生了变化 ──
      yield { type: 'executing', phase: 'diff-validation', progress: 62 }
      for (const file of validOutputs) {
        const origBackupPath = join(sandbox.path, file.path + '.orig')
        const newPath = join(sandbox.path, file.path)
        try {
          const originalContent = await readFile(origBackupPath, 'utf-8')
          const newContent = await readFile(newPath, 'utf-8')
          if (originalContent === newContent) {
            fileValidationSummary.noChangeDetected.push(file.path)
          }
        } catch {
          // 跳过无法读取的文件
        }
      }
      finalFileValidationSummary = fileValidationSummary

      // ── 10. 有空变更文件 → 容错降级处理 ──
      if (fileValidationSummary.noChangeDetected.length > 0) {
        const noChangeFiles = fileValidationSummary.noChangeDetected
        // 容错：如果所有文件都完全没有变更，才判定失败
        // 避免部分文件没改但其他文件改了的情况下，直接阻断流程
        if (noChangeFiles.length === validOutputs.length) {
          const err = `所有计划修改的文件内容完全没有变化: ${noChangeFiles.join(', ')}`
          codeErrors.push(`第${codeAttempt}轮: ${err}`)
          yield {
            type: 'executing',
            phase: `no-change-detected: 所有文件未产生变更`,
            progress: 63,
            warnings: noChangeFiles,
          }

          if (codeAttempt === MAX_RETRIES) {
            const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
            yield { type: 'failed', requirement, error: detailedError, userMessage: `代码生成失败，所有计划修改的文件内容完全没有变化。请尝试重新描述需求后重试。` }
            requirement.status = 'failed'
            await requirementMemory.saveRequirement(requirement)
            await requirementMemory.saveLesson({
              id: crypto.randomUUID(),
              projectId,
              requirementId: requirement.id,
              phase: 'coding',
              filePath: null,
              errorSummary: `全量空变更文件: ${noChangeFiles.join(', ')}`,
              errorDetail: detailedError,
              fixHint: null,
              resolved: false,
              createdAt: new Date(),
            })
            return
          }
          continue
        } else {
          // 部分文件没改，其他文件改了 → 只记录警告，不阻断流程
          yield {
            type: 'executing',
            phase: `warning: ${noChangeFiles.length} 个文件未产生变更`,
            progress: 64,
            warnings: noChangeFiles,
          }
        }
      }

      // 关键字校验逻辑已移除：自然语言需求和代码之间不存在简单的字符串匹配关系
      // 用更可靠的两道关卡替代：分级告警审计层 + 全量空变更检测
      // 这两道关卡的可靠性远高于低质量的字符串匹配，且完全不会误判正常流程

      // 保存本轮输出，供下轮重试参考
      previousOutputs = codeOutputs

      // 测试阶段
      yield { type: 'status-change', status: 'testing', agent: 'test' }
      yield { type: 'executing', phase: `testing (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 70 }

      const testResult = await testRunner.run({
        lint: commands.lint,
        test: commands.test,
        build: commands.build,
      })

      yield {
        type: 'test-result',
        passed: testResult.passed,
        details: JSON.stringify(testResult, null, 2),
      }

      if (testResult.passed) {
        for (const lesson of pastLessons) {
          await requirementMemory.markLessonResolved(lesson.id)
        }
        break
      }

      // ── 构建增强版 testError：完整错误 + 错误相关文件内容 ──
      const errorOutput = testResult.steps
        .filter(s => !s.passed)
        .map(s => `${s.name}: ${s.output}`)  // 不截断，保留完整错误
        .join('\n---\n')

      // 从错误中提取涉及的源码文件路径，读取其内容作为上下文
      const errorFileContents = await extractAndReadErrorFiles(errorOutput, sandbox.path)
      if (errorFileContents.length > 0) {
        yield {
          type: 'executing',
          phase: `reading ${errorFileContents.length} error-related files for context`,
          progress: 64,
        }
      }

      // 将完整错误 + 文件内容一起存入 codeErrors，供下轮重试使用
      let enhancedError = `第${codeAttempt}轮测试失败:\n${errorOutput.slice(0, 2000)}`
      if (errorFileContents.length > 0) {
        enhancedError += '\n\n## 错误涉及的源码文件（请重点检查这些文件的 import/export 是否正确）\n' +
          errorFileContents.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
      }
      codeErrors.push(enhancedError)

      if (executor) {
        await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => {})
      }

      yield { type: 'executing', phase: `test failed (attempt ${codeAttempt}/${MAX_RETRIES}), retrying coding...`, progress: 65 }

      if (codeAttempt === MAX_RETRIES) {
        const detailedError = `编码+测试失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
        yield { type: 'failed', requirement, error: detailedError, userMessage: `代码测试未通过（已重试 ${MAX_RETRIES} 次）。生成的代码存在 lint 或构建错误，请查看下方调试日志了解详情。` }
        requirement.status = 'failed'
        await requirementMemory.saveRequirement(requirement)
        await requirementMemory.saveLesson({
          id: crypto.randomUUID(),
          projectId,
          requirementId: requirement.id,
          phase: 'testing',
          filePath: null,
          errorSummary: `测试失败: ${testResult.steps.filter(s => !s.passed).map(s => s.name).join(', ')}`,
          errorDetail: detailedError,
          fixHint: null,
          resolved: false,
          createdAt: new Date(),
        })
        return
      }
    }

    // 编码成功 → 保存变更历史
    const validOutputs = codeOutputs.filter(f => f.path && f.content)

    if (typeof requirementMemory.saveChanges === 'function') {
      await requirementMemory.saveChanges(
        requirement.id,
        validOutputs.map(f => ({
          path: f.path,
          action: f.content.trim().includes('__DELETE__') ? 'deleted' as const : 'created' as const,
        })),
      )
    }

    // ── 深度集成：增强 Diff 安全检查（全容错保护，绝不卡流程） ──
    let diffCheckResult: any = null
    try {
      yield { type: 'executing', phase: 'enhanced-diff-safety-check', progress: 80 }
      const originalFiles = new Map<string, string>()
      for (const file of validOutputs) {
        try {
          const { readFile } = await import('fs/promises')
          const originalContent = await readFile(join(sandbox.path, file.path + '.orig'), 'utf-8')
          originalFiles.set(file.path, originalContent)
        } catch {
          // .orig 文件不存在，跳过
        }
      }
      const diffSafetyChecker = new DiffSafetyChecker(sandbox.path)
      diffCheckResult = await diffSafetyChecker.check(originalFiles, requirement.plan ?? [])
    } catch (enhanceErr) {
      // 增强 Diff 检查失败绝不影响原有主流程，静默跳过
      console.warn('[enhancements] Diff安全检查跳过:', enhanceErr)
    }

    // 原有基础 Diff 检查
    yield { type: 'executing', phase: 'diff-check', progress: 85 }
    const changedFiles = await repoManager.getChangedFiles()
    const expectedFiles = validOutputs.map(f => f.path)
    const diffResult = await repoManager.diffCheck(expectedFiles)

    if (diffResult.hasUnexpectedChanges) {
      yield {
        type: 'executing',
        phase: `unexpected changes: ${diffResult.unexpectedFiles?.join(', ')}`,
        progress: 85,
      }
    }

    // 获取 diff 内容，暂停等用户确认
    let diffContent = ''
    if (executor) {
      try {
        const { stdout } = await executor('git diff', { timeout: 30_000 })
        diffContent = stdout
      } catch {}
    }

    // Take page screenshot
    let screenshot: string | null = null
    if ('startDevServer' in sandboxManager && 'takeScreenshot' in sandboxManager) {
      try {
        yield { type: 'executing', phase: 'starting dev server', progress: 85 }
        const sm = sandboxManager as any
        const serverStarted = await sm.startDevServer(3000, 30_000)
        if (serverStarted) {
          yield { type: 'executing', phase: 'taking screenshot', progress: 87 }
          const planForRoute = requirement.plan ?? []
          const route = this.extractRouteFromPlan(planForRoute)
          screenshot = await sm.takeScreenshot(3000, route)
        }
      } catch {
        // Screenshot failed, fallback to diff
      }
    }

    requirement.status = 'diff-ready'
    await requirementMemory.saveRequirement(requirement)
    this.sandboxShouldCleanup = false  // 暂停点，保留沙箱供后续 commit
    yield {
      type: 'diff-ready',
      requirement,
      diff: diffContent,
      screenshot: screenshot ?? undefined,
      files: validOutputs.map(f => ({ path: f.path, summary: f.summary })),
      diffCheck: diffCheckResult,
      fileValidationSummary: finalFileValidationSummary ?? undefined,
    }
    return
  }

  /**
   * 提交+应用阶段（支持从 diff-ready 状态直接进入）
   */
  private async *phaseCommit(
    requirement: Requirement,
    requirementMemory: RequirementMemory,
    repoManager: RepoManager,
    sandboxManager: SandboxManagerLike,
    sandbox: Sandbox,
  ): AsyncGenerator<OrchestratorEvent> {
    yield { type: 'executing', phase: 'committing', progress: 90 }

    const rawCommitMsg = `feat: ${requirement.structuredRequirement?.description ?? requirement.pmInput} [req:${requirement.id.slice(0, 8)}]`
    const commitMsg = rawCommitMsg.replace(/[`$"]/g, "'").slice(0, 200)

    try {
      await repoManager.commit(commitMsg)
      yield { type: 'executing', phase: 'committed to sandbox', progress: 95 }
    } catch (e: any) {
      yield { type: 'executing', phase: `commit failed: ${e.message}`, progress: 95 }
      requirement.status = 'failed'
      await requirementMemory.saveRequirement(requirement)
      yield { type: 'failed', requirement, error: `沙箱 commit 失败: ${e.message}`, userMessage: '代码提交失败，可能是沙箱环境的 Git 配置问题。请联系开发者排查。' }
      return
    }

    // 应用到源仓库 — 从刚提交的 commit 中获取变更文件列表
    yield { type: 'executing', phase: 'applying-to-source', progress: 97 }
    let changedFiles: string[] = []
    try {
      const { stdout } = await repoManager.getLastCommitFiles()
      changedFiles = stdout.trim().split('\n').filter(Boolean)
    } catch {}
    if (changedFiles.length === 0) {
      // fallback: validOutputs from phaseCoding (if available)
      changedFiles = (requirement.plan ?? []).map((f: any) => f.path).filter(Boolean)
    }
    try {
      await sandboxManager.applyToSource(sandbox, changedFiles, commitMsg)
      yield { type: 'executing', phase: 'applied to source', progress: 98 }
    } catch (e: any) {
      yield { type: 'executing', phase: `apply failed: ${e.message}`, progress: 98 }
      requirement.status = 'failed'
      await requirementMemory.saveRequirement(requirement)
      yield { type: 'failed', requirement, error: `应用到源仓库失败: ${e.message}`, userMessage: '代码变更未能应用到源仓库。沙箱中的代码仍然保留，请联系开发者排查。' }
      return
    }

    // 完成
    requirement.status = 'done'
    await requirementMemory.saveRequirement(requirement)
    yield { type: 'completed', requirement }
  }

  /**
   * 处理 PM 回复（追问后的继续流程）
   */
  async *continueWithPMReply(
    requirement: Requirement,
    pmReply: string,
    projectId: string = 'conduit',
  ): AsyncGenerator<OrchestratorEvent> {
    await this.deps.requirementMemory.addConversation({
      id: crypto.randomUUID(),
      requirementId: requirement.id,
      role: 'pm',
      content: pmReply,
      round: (requirement.structuredRequirement as any)?._round ?? 1,
      createdAt: new Date(),
    })

    requirement.pmInput = pmReply
    yield* this.run(requirement, projectId)
  }

  private parsePlan(output: any): FilePlan[] {
    if (Array.isArray(output)) return output
    if (output.files && Array.isArray(output.files)) return output.files
    if (output.plan && Array.isArray(output.plan)) return output.plan
    return []
  }

  private extractRouteFromPlan(plan: FilePlan[]): string {
    for (const file of plan) {
      const path = file.path.toLowerCase()
      if (path.includes('/pages/') || path.includes('/views/') || path.includes('/routes/')) {
        const name = file.path.split('/').pop()?.replace(/\.(tsx?|vue|jsx?)$/, '') ?? ''
        if (name && name !== 'index' && name !== 'App') {
          return `/${name.toLowerCase()}`
        }
      }
    }
    return '/'
  }

  private isTerminal(status: RequirementStatus): boolean {
    return status === 'done' || status === 'failed'
  }

  private selectAgent(status: RequirementStatus): string {
    const mapping: Record<string, string> = {
      clarifying: 'clarification',
      clarified: 'plan',
      'plan-approved': 'coding',
      coding: 'testing',
      testing: 'test',
    }
    return mapping[status] ?? 'unknown'
  }
}

/**
 * 从构建/测试错误输出中提取涉及的源码文件路径，并读取其内容
 * 只提取项目源码文件，排除 node_modules、工具内部文件、堆栈帧
 * 返回 {path, content}[] 供 coding agent 作为上下文参考
 */
async function extractAndReadErrorFiles(errorOutput: string, sandboxPath: string): Promise<{ path: string; content: string }[]> {
  const filePaths = new Set<string>()

  // 只匹配项目源码路径（src/ 或 app/ 开头），不匹配堆栈帧中的绝对路径
  const patterns = [
    // Vite/Rollup 错误行: "src/agent.js (2:9): "getToken" is not exported..."
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:js|jsx|ts|tsx|vue))\s*\(\d+:\d+\):/g,
    // TypeScript 错误: src/foo.ts(10,5): error TS2322
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:js|jsx|ts|tsx|vue))\(\d+,\d+\):\s*error/g,
    // ESLint 错误: src/foo.js:10:5: error
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue)):\d+:\d+:\s*(?:error|warning)/g,
    // file: 行中的项目源码路径（从 /sandbox/<workspace>/ 之后截取）
    /file:\s*\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue))/g,
    // 错误信息中引用的文件: "xxx" is not exported by "src/context/AuthContext.jsx"
    /(?:is not exported by|is not declared in|Cannot find module|Module not found)[^"']*["']((?:src|app|lib)\/[^"']+\.(?:js|jsx|ts|tsx|vue))["']/gi,
    // 错误信息中引用的文件: imported by "src/agent.js"
    /imported by\s+["']((?:src|app|lib)\/[^"']+\.(?:js|jsx|ts|tsx|vue))["']/gi,
    // 绝对路径中的项目源码: /sandbox/frontend/src/context/AuthContext.jsx:46:9
    /(?:^|\s)\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue)):\d+/g,
  ]

  // 排除规则：node_modules、工具内部路径
  const EXCLUDE_PATTERNS = [
    /node_modules[\\/]/,
    /rollup[\\/]dist[\\/]/,
    /vite[\\/]dist[\\/]/,
    /parseAst\.js$/,
    /node-entry\.js$/,
  ]

  function isExcluded(path: string): boolean {
    return EXCLUDE_PATTERNS.some(p => p.test(path))
  }

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(errorOutput)) !== null) {
      const filePath = match[1].replace(/^\//, '')
      if (isExcluded(filePath)) continue
      // normalize：frontend/src/agent.js → src/agent.js
      const normalized = filePath.replace(/^(?:frontend|backend)\//, '')
      filePaths.add(normalized)
    }
  }

  // 读取每个文件的内容
  const { readFile } = await import('fs/promises')
  const { join } = await import('path')
  const results: { path: string; content: string }[] = []

  for (const filePath of filePaths) {
    // 尝试多个可能的基础路径
    const candidates = [
      join(sandboxPath, 'frontend', filePath),
      join(sandboxPath, 'backend', filePath),
      join(sandboxPath, filePath),
    ]
    for (const fullPath of candidates) {
      try {
        const content = await readFile(fullPath, 'utf-8')
        results.push({ path: filePath, content })
        break
      } catch {
        // 文件不存在，尝试下一个候选路径
      }
    }
  }

  return results
}
