import type { OrchestratorEvent, PhaseContext, FileValidationSummary } from '../../types.js'
import { BasePhaseHandler } from '../phase-handler.js'
import { transition } from '../state-machine.js'
import { Logger } from '../../utils/logger.js'
import { createBoundaryTestAgent } from '../../agents/test-agent.js'
import { DiffSafetyChecker } from '../../utils/diff-safety-checker.js'
import { extractAndReadErrorFiles } from '../../utils/error-file-extractor.js'
import { join } from 'path'

const log = Logger.for('phase:testing')

/**
 * 测试阶段处理器
 * 
 * 职责：
 * - 运行 lint、单测、构建
 * - 环境错误分类（直接失败 vs 代码重试）
 * - 边界测试生成（非阻断性）
 * - Diff 安全检查
 * - 成功后进入 diff-ready 暂停
 */
export class TestingPhase extends BasePhaseHandler {
  readonly name = 'testing'
  private readonly MAX_RETRIES = 3

  /** 环境错误模式：非代码问题，重试无法解决 */
  private static readonly ENV_ERROR_PATTERNS = [
    /GLIBC_\d+\.\d+.*not found/i,
    /version.*GLIBC.*not found/i,
    /Cannot find module.*\.node['"]/,
    /node_sqlite3\.node/i,
    /\/lib\/.*\.so.*not found/i,
    /Permission denied/i,
    /ENOSPC.*no space left/i,
    /ENOMEM.*out of memory/i,
    /docker.*not found/i,
    /Cannot find package 'sqlite3'/i,
  ]

  async *execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, projectContext, testRunner, repoManager, sandbox, executor } = ctx

    // 从 CodingPhase 传递的数据
    const codeOutputs: { path: string; content: string; summary: string }[] = (ctx as any)._codingOutputs ?? []
    const fileValidationSummary: FileValidationSummary | null = (ctx as any)._fileValidationSummary ?? null
    const pastLessons = (ctx as any)._pastLessons ?? []

    const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' }

    yield this.statusChange('testing', 'test')
    yield this.progress('testing', 70)

    // 提取变更文件列表，用于限定测试范围
    const changedFilesForTest = codeOutputs
      .filter(f => f.path && f.content !== '__DELETE__')
      .map(f => f.path)

    const testResult = await testRunner.run({
      lint: commands.lint,
      test: commands.test,
      build: commands.build,
    }, 3, changedFilesForTest)

    yield { type: 'test-result', passed: testResult.passed, details: JSON.stringify(testResult, null, 2) }

    if (testResult.passed) {
      // 标记历史 lessons 为已解决
      for (const lesson of pastLessons) {
        await requirementMemory.markLessonResolved(lesson.id)
      }

      // 清理 .orig 备份文件
      if (executor) {
        try { await executor('find . -name "*.orig" -delete', { timeout: 10_000 }) } catch {}
      }

      // 边界测试生成（非阻断）
      yield* this.runBoundaryTests(ctx, codeOutputs, commands)

      // 生成 Diff
      yield* this.generateDiffAndPause(ctx, codeOutputs, fileValidationSummary)
      return
    }

    // 测试失败 - 环境错误分类
    const errorOutput = testResult.steps
      .filter(s => !s.passed)
      .map(s => `${s.name}: ${s.output}`)
      .join('\n---\n')

    const isEnvError = TestingPhase.ENV_ERROR_PATTERNS.some(p => p.test(errorOutput))
    if (isEnvError) {
      yield {
        type: 'failed',
        requirement,
        error: `环境错误（非代码问题，重试无法解决）:\n${errorOutput.slice(0, 500)}`,
        userMessage: '测试环境配置错误，非代码问题。请检查 Docker 沙箱的系统库版本或项目依赖配置。',
      }
      transition(requirement, 'failed', '环境错误')
      await requirementMemory.saveRequirement(requirement)
      return
    }

    // 提取错误相关文件内容
    const errorFileContents = await extractAndReadErrorFiles(errorOutput, sandbox.path)
    if (errorFileContents.length > 0) {
      yield this.progress(`reading ${errorFileContents.length} error-related files`, 64)
    }

    // 存储增强错误信息到 codeErrors（供编码阶段重试使用）
    let enhancedError = `测试失败:\n${errorOutput.slice(0, 2000)}`
    if (errorFileContents.length > 0) {
      enhancedError += '\n\n## 错误涉及的源码文件\n' +
        errorFileContents.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
    }

    // 回滚 git
    if (executor) {
      await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => {})
    }

    yield this.progress('test failed, retrying...', 65)

    // 将错误信息传递给编码阶段进行重试
    ;(ctx as any)._testError = enhancedError

    yield {
      type: 'failed',
      requirement,
      error: `测试失败: ${testResult.steps.filter(s => !s.passed).map(s => s.name).join(', ')}`,
      userMessage: '代码测试未通过。生成的代码存在 lint 或构建错误，请查看调试日志。',
    }
  }

  private async *runBoundaryTests(
    ctx: PhaseContext,
    codeOutputs: { path: string; content: string; summary: string }[],
    commands: { lint: string; test: string; build: string },
  ): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, agentRunner, projectContext, testRunner } = ctx

    try {
      yield this.progress('generating boundary tests', 75)

      const changedFiles = codeOutputs
        .filter(f => f.path && f.content !== '__DELETE__')
        .map(f => f.path)
        .join(', ')

      const boundaryTestContext = `本次修改的文件：${changedFiles}\n\n` +
        `请分析这些文件中的函数，为未覆盖的边界条件生成测试用例。\n` +
        `项目测试命令：${commands.test}\n` +
        `已有测试文件：查看项目中已有的 .test.js 文件了解测试框架和 mock 模式。`

      const boundaryTestResult = await agentRunner.run(
        createBoundaryTestAgent(),
        {
          requirement: { ...requirement, pmInput: boundaryTestContext },
          projectContext,
          memory: await requirementMemory.getContext(requirement.id, projectContext),
        },
      )

      if (boundaryTestResult.status === 'success') {
        yield this.progress('boundary tests generated, running...', 78)

        const fullTestResult = await testRunner.run({
          lint: commands.lint,
          test: commands.test,
          build: commands.build,
        })

        yield { type: 'test-result', passed: fullTestResult.passed, details: JSON.stringify(fullTestResult, null, 2) }

        if (!fullTestResult.passed) {
          yield this.progress('boundary tests found issues (non-blocking)', 80, [
            `边界测试未全部通过：${fullTestResult.steps.filter(s => !s.passed).map(s => s.name).join(', ')}`,
          ])
        }
      }
    } catch (boundaryErr: any) {
      yield this.progress(`boundary test generation skipped: ${boundaryErr.message?.slice(0, 100)}`, 78)
    }
  }

  private async *generateDiffAndPause(
    ctx: PhaseContext,
    codeOutputs: { path: string; content: string; summary: string }[],
    fileValidationSummary: FileValidationSummary | null,
  ): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, repoManager, sandboxManager, sandbox, executor } = ctx

    // 保存变更历史
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

    // 增强 Diff 安全检查（容错）
    let diffCheckResult: any = null
    try {
      yield this.progress('enhanced-diff-safety-check', 80)
      const originalFiles = new Map<string, string>()
      const { readFile } = await import('fs/promises')
      for (const file of validOutputs) {
        try {
          const originalContent = await readFile(join(sandbox.path, file.path + '.orig'), 'utf-8')
          originalFiles.set(file.path, originalContent)
        } catch {}
      }
      const diffSafetyChecker = new DiffSafetyChecker(sandbox.path)
      diffCheckResult = await diffSafetyChecker.check(originalFiles, requirement.plan ?? [])
    } catch (err) {
      log.warn('Diff 安全检查跳过', { error: String(err) })
    }

    // 基础 Diff
    yield this.progress('diff-check', 85)
    const diffResult = await repoManager.diffCheck(validOutputs.map(f => f.path))
    if (diffResult.hasUnexpectedChanges) {
      yield this.progress(`unexpected changes: ${diffResult.unexpectedFiles?.join(', ')}`, 85)
    }

    // 获取 diff 内容
    let diffContent = ''
    if (executor) {
      try {
        const { stdout } = await executor('git diff', { timeout: 30_000 })
        diffContent = stdout
      } catch {}
    }

    // 暂停等待用户确认
    transition(requirement, 'diff-ready', '测试通过')
    await requirementMemory.saveRequirement(requirement)

    yield {
      type: 'diff-ready',
      requirement,
      diff: diffContent,
      files: validOutputs.map(f => ({ path: f.path, summary: f.summary })),
      diffCheck: diffCheckResult,
      fileValidationSummary: fileValidationSummary ?? undefined,
    }

    log.info('测试阶段完成，进入 diff-ready 暂停')
  }
}
