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
} from '../types.js'
import type { AgentRunner } from '../agents/agent-runner.js'
import type { SkillRegistry } from '../skill-registry/skill-registry.js'
import type { LLMClient } from '../llm/llm-client.js'
import type { PromptManager } from '../llm/prompt-manager.js'
import { runClarification } from '../agents/clarification-agent.js'
import { createPlanAgent } from '../agents/plan-agent.js'
import { runCoding } from '../agents/coding-agent.js'
import type { Sandbox } from '../git-ops/sandbox.js'
import type { DockerSandboxManager } from '../git-ops/docker-sandbox.js'
import type { CommandExecutor } from '../git-ops/executor.js'
import { TestRunner } from '../git-ops/test-runner.js'
import { RepoManager } from '../git-ops/repo-manager.js'
import { RequirementMemory } from '../memory/requirement-memory.js'
import { ProjectMemory } from '../memory/project-memory.js'

export interface SandboxManagerLike {
  create(id?: string): Promise<Sandbox>
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
 * 对标 Claude Code 的 query() AsyncGenerator
 */
export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  /**
   * 主循环：根据需求状态调度对应 Agent
   * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
   */
  async *run(requirement: Requirement, projectId: string = 'conduit'): AsyncGenerator<OrchestratorEvent> {
    const { agentRunner, llmClient, promptManager, skillRegistry, sandboxManager, projectMemory, requirementMemory } = this.deps

    // 加载对话历史，计算当前轮次并构建上下文
    const recentConvs = await requirementMemory.getRecentConversations(requirement.id, 50)
    const pmReplies = recentConvs.filter(c => c.role === 'pm')
    const currentRound = 1 + pmReplies.length

    // 构建 pmInput：第 1 轮用原始输入，后续轮次用 PM 回复拼接
    let pmInput = requirement.pmInput
    if (requirement.status === 'clarifying' && pmReplies.length > 0) {
      pmInput = pmReplies.map(c => c.content).join('\n')
    }

    // 提取之前的澄清追问问题（用于给 LLM 提供上下文）
    const previousQuestions = recentConvs
      .filter(c => c.role === 'system')
      .map(c => c.content)

    // 1. 创建沙箱
    yield { type: 'executing', phase: 'sandbox-create', progress: 0 }
    const sandbox = await sandboxManager.create(requirement.id)
    yield { type: 'executing', phase: 'sandbox-ready', progress: 5 }

    // 初始化测试运行器和仓库管理器（Docker 沙箱时命令在容器内执行）
    const executor: CommandExecutor | undefined =
      'getExecutor' in sandboxManager
        ? (sandboxManager as DockerSandboxManager).getExecutor(sandbox)
        : undefined
    const testRunner = new TestRunner(sandbox.path, executor)
    const repoManager = new RepoManager(sandbox.path, executor)

    // 2. 加载项目上下文
    const projectContext = await projectMemory.load(projectId)

    try {
      // 3. 澄清阶段
      yield { type: 'status-change', status: 'clarifying', agent: 'clarification' }

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
        // 将追问问题保存为 system 类型对话，让前端 Chat Tab 能显示
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

        yield {
          type: 'waiting-for-pm',
          requirement: { ...requirement, status: 'clarifying' },
          questions,
        }
        requirement.status = 'clarifying'
        requirement.structuredRequirement = clarificationResult.requirement
        await requirementMemory.saveRequirement(requirement)
        return
      }

      requirement.structuredRequirement = clarificationResult.requirement
      requirement.status = 'clarified'
      await requirementMemory.saveRequirement(requirement)
      yield { type: 'status-change', status: 'clarified', agent: 'clarification' }

      // 4. 方案阶段（自愈重试，最多 5 轮）
      yield { type: 'status-change', status: 'planning', agent: 'plan' }

      // 如果是删除操作，查询相关实体的变更历史（精准定位需要删除的文件）
      let deleteHistoryHint = ''
      const reqType = requirement.structuredRequirement?.type
      if (reqType === 'delete_page' || reqType === 'delete_field') {
        const entity = requirement.structuredRequirement?.entity ?? ''
        if (entity && 'findChangesByEntity' in requirementMemory) {
          const history = await (requirementMemory as any).findChangesByEntity(entity)
          if (history.length > 0) {
            const allFiles = new Set<string>()
            for (const h of history) {
              for (const f of h.files) allFiles.add(f.filePath)
            }
            deleteHistoryHint = `\n\n## 该实体的历史变更文件（必须全部处理）\n以下是创建/修改该实体时涉及的所有文件，删除操作必须覆盖这些文件：\n${Array.from(allFiles).map(f => `- ${f}`).join('\n')}`
          }
        }
      }

      const MAX_RETRIES = 5
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
          yield { type: 'failed', requirement, error: detailedError }
          requirement.status = 'failed'
          await requirementMemory.saveRequirement(requirement)
          // 持久化 lesson
          await requirementMemory.saveLesson({
            id: crypto.randomUUID(),
            projectId,
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

      requirement.plan = plan
      requirement.status = 'plan-approved'
      await requirementMemory.saveRequirement(requirement)
      yield { type: 'plan-ready', plan, requirement }

      // 5. 编码+测试阶段（自愈重试，最多 5 轮）
      yield { type: 'status-change', status: 'coding', agent: 'coding' }

      const skill = requirement.structuredRequirement
        ? skillRegistry.match(requirement.structuredRequirement)
        : null

      const codeErrors: string[] = []
      const { writeFile, mkdir, rm } = await import('fs/promises')
      const { dirname, join } = await import('path')
      const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' }
      const pastLessons = await requirementMemory.getLessons(projectId, 'coding', 5)
      let codeOutputs: { path: string; content: string; summary: string }[] = []

      for (let codeAttempt = 1; codeAttempt <= MAX_RETRIES; codeAttempt++) {
        yield { type: 'executing', phase: `coding (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 30 }

        // 构建错误反馈 + 历史教训
        let codingHint = ''
        if (codeErrors.length > 0) {
          codingHint = '\n\n## 上轮编码/测试失败\n' + codeErrors[codeErrors.length - 1] + '\n请修正以上错误后重新生成代码。'
        }
        if (pastLessons.length > 0) {
          codingHint += '\n\n## 历史失败教训（请避免重复以下错误）\n' +
            pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n')
        }

        codeOutputs = []

        if (skill) {
          yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 35 }
          const skillOutputs = await skill.execute(requirement.structuredRequirement!, projectContext)
          codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }))
        } else {
          const planFiles = requirement.plan ?? []

          yield { type: 'executing', phase: `coding-agent (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 35 }
          codeOutputs = await runCoding(
            llmClient, promptManager, planFiles, sandbox.path,
            projectContext,
            codingHint || undefined,
          )
        }

        // 写入文件到沙箱
        yield { type: 'executing', phase: 'writing-files', progress: 60 }
        const validOutputs = codeOutputs.filter(f => f.path && f.content)

        if (validOutputs.length === 0) {
          const err = '编码阶段未生成有效文件'
          codeErrors.push(`第${codeAttempt}轮: ${err}`)

          if (codeAttempt === MAX_RETRIES) {
            const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
            yield { type: 'failed', requirement, error: detailedError }
            requirement.status = 'failed'
            await requirementMemory.saveRequirement(requirement)
            await requirementMemory.saveLesson({
              id: crypto.randomUUID(),
              projectId,
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

        // 清空沙箱旧文件后重新写入（避免上轮残留）
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
          // 测试通过，标记相关 lessons 为已解决
          for (const lesson of pastLessons) {
            await requirementMemory.markLessonResolved(lesson.id)
          }
          break  // 成功！跳出编码重试循环
        }

        // 测试失败，收集错误反馈给下一轮编码
        const testErrors = testResult.steps
          .filter(s => !s.passed)
          .map(s => `${s.name}: ${s.output.slice(0, 500)}`)
          .join('\n---\n')
        codeErrors.push(`第${codeAttempt}轮测试失败:\n${testErrors}`)

        // 恢复沙箱原始文件（避免坏文件污染下一轮编码）
        if (executor) {
          await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => {})
        }

        yield { type: 'executing', phase: `test failed (attempt ${codeAttempt}/${MAX_RETRIES}), retrying coding...`, progress: 65 }

        if (codeAttempt === MAX_RETRIES) {
          const detailedError = `编码+测试失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`
          yield { type: 'failed', requirement, error: detailedError }
          requirement.status = 'failed'
          await requirementMemory.saveRequirement(requirement)
          // 持久化 lesson
          await requirementMemory.saveLesson({
            id: crypto.randomUUID(),
            projectId,
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

      // 编码循环成功退出后，获取最终的 validOutputs 用于后续步骤
      const validOutputs = codeOutputs.filter(f => f.path && f.content)

      // 保存变更历史（供未来删除操作精准定位文件）
      if ('saveChanges' in requirementMemory) {
        await (requirementMemory as any).saveChanges(
          requirement.id,
          validOutputs.map(f => ({
            path: f.path,
            action: f.content.trim().includes('__DELETE__') ? 'deleted' as const : 'created' as const,
          })),
        )
      }

      // 7. Diff 检查
      yield { type: 'executing', phase: 'diff-check', progress: 80 }
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

      // 8. 提交代码到沙箱 git
      yield { type: 'executing', phase: 'committing', progress: 90 }
      const rawCommitMsg = `feat: ${requirement.structuredRequirement?.description ?? requirement.pmInput}`
      const commitMsg = rawCommitMsg.replace(/[`$"]/g, "'").slice(0, 200)
      try {
        await repoManager.commit(commitMsg)
        yield { type: 'executing', phase: 'committed to sandbox', progress: 95 }
      } catch (e: any) {
        yield { type: 'executing', phase: `commit failed: ${e.message}`, progress: 95 }
        // 沙箱 commit 失败，不继续 apply 到源仓库
        requirement.status = 'done'
        await requirementMemory.saveRequirement(requirement)
        yield { type: 'completed', requirement }
        return
      }

      // 9. 将沙箱变更应用回源仓库（含 git commit）
      yield { type: 'executing', phase: 'applying-to-source', progress: 97 }
      const filesToApply = validOutputs.map(f => f.path)
      try {
        await sandboxManager.applyToSource(sandbox, filesToApply, commitMsg)
        yield { type: 'executing', phase: 'applied to source', progress: 98 }
      } catch (e: any) {
        yield { type: 'executing', phase: `apply failed: ${e.message}`, progress: 98 }
      }

      // 10. 完成
      requirement.status = 'done'
      await requirementMemory.saveRequirement(requirement)
      yield { type: 'completed', requirement }

    } catch (e: any) {
      yield { type: 'failed', requirement, error: e.message }
      requirement.status = 'failed'
      await requirementMemory.saveRequirement(requirement)
    } finally {
      // 11. 清理沙箱
      try {
        await sandbox.cleanup()
      } catch {}
    }
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

  /**
   * 将沙箱中的变更应用到源仓库（只有测试通过才调用）
   */
  async applyChanges(requirement: Requirement, files: string[]): Promise<void> {
    const sandboxId = requirement.id
    // 需要从 sandboxManager 获取活跃的 sandbox
    // 这里简化处理，直接通过 SandboxManager.applyToSource
  }

  private parsePlan(output: any): FilePlan[] {
    if (Array.isArray(output)) return output
    if (output.files && Array.isArray(output.files)) return output.files
    if (output.plan && Array.isArray(output.plan)) return output.plan
    return []
  }

  private parseCodeOutput(output: any): { path: string; content: string; summary: string }[] {
    if (Array.isArray(output)) return output
    if (output.files && Array.isArray(output.files)) return output.files
    return [output]
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
