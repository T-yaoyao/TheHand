import type { OrchestratorEvent, PhaseContext, FilePlan, ArchitectOutput, FileValidationSummary } from '../../types.js'
import { BasePhaseHandler } from '../phase-handler.js'
import { transition } from '../state-machine.js'
import { Logger } from '../../utils/logger.js'
import { runCodingBatch, extractInterfaceSummary, extractAvailableDependencies, validateImports } from '../../agents/coding-agent.js'
import { buildBatches, extractFileInterfaces, runArchitect } from '../../agents/architect-agent.js'
import { detectCodingRegression, formatRegressionRetryHint } from '../../utils/coding-regression-guard.js'
import { loadSandboxSourceContents, sandboxIndexImportsComponent, skipOrphanImportIntegrationCheck, sourceFileImportsTargetModule } from '../../utils/component-sandbox-import.js'
import { isRouteTableModulePath, pickApplicationEntryForRouteTable, collectRouteIntegrationContextPaths } from '../../utils/route-wiring-entry.js'
import { findOutletNavRouteViolations } from '../../utils/outlet-nav-route-guard.js'
import { findUnresolvedRelativeImportsInFileMap } from '../../utils/relative-import-resolve-guard.js'
import { join, dirname } from 'path'

const log = Logger.for('phase:coding')

/**
 * 编码阶段处理器
 * 
 * 职责：
 * - Architect 分析依赖 + 分批
 * - 分批 Coding（LLM 生成代码）
 * - 多层校验（依赖、退化、孤立组件、路由一致性、import 解析）
 * - 写入沙箱 + Diff 验证
 * - 最多 3 轮重试
 */
export class CodingPhase extends BasePhaseHandler {
  readonly name = 'coding'
  private readonly MAX_RETRIES = 3

  async *execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, llmClient, promptManager, skillRegistry, projectContext, sandbox, agentRunner } = ctx

    yield this.statusChange('coding', 'coding')

    const skill = requirement.structuredRequirement
      ? skillRegistry.match(requirement.structuredRequirement)
      : null

    let codingRegressionHint = ''
    const codeErrors: string[] = []
    const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' }
    const pastLessons = await requirementMemory.getLessons(ctx.projectId, 'coding', 5)
    let codeOutputs: { path: string; content: string; summary: string }[] = []
    let previousOutputs: { path: string; content: string; summary: string }[] = []
    let finalFileValidationSummary: FileValidationSummary | null = null

    const failedFiles = new Set<string>()
    const staticGuardInjectPaths = new Set<string>()

    const mergePlanWithInjections = (base: FilePlan[]): FilePlan[] => {
      const norm = (p: string) => p.replace(/\\/g, '/')
      const byPath = new Map<string, FilePlan>()
      for (const f of base) {
        const key = norm(f.path)
        byPath.set(key, { ...f, path: key })
      }
      const injectDesc = '【TheHand 编排器】须修正上一轮静态校验指出的问题；请对照沙箱磁盘**真实路径**做最小改动。'
      for (const p of staticGuardInjectPaths) {
        if (byPath.has(p)) continue
        byPath.set(p, { path: p, changeDescription: injectDesc, priority: 999_000 })
      }
      return [...byPath.values()].sort((a, b) => a.priority - b.priority)
    }

    for (let codeAttempt = 1; codeAttempt <= this.MAX_RETRIES; codeAttempt++) {
      yield this.progress(`coding (attempt ${codeAttempt}/${this.MAX_RETRIES})`, 30)

      let codingHint = ''
      if (pastLessons.length > 0) {
        codingHint = '\n\n## 历史失败教训（请避免重复以下错误）\n' +
          pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n')
      }

      codeOutputs = []

      if (skill) {
        yield this.progress(`skill: ${skill.name}`, 35)
        const skillOutputs = await skill.execute(requirement.structuredRequirement!, projectContext)
        codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }))
      } else {
        const codingResult = yield* this.runCodingBatches(ctx, {
          codeAttempt, mergePlanWithInjections, failedFiles, codeErrors,
          codingRegressionHint, codingHint, previousOutputs, sandbox, staticGuardInjectPaths,
        })
        if (codingResult.failed) continue
        codeOutputs = codingResult.outputs
      }

      // 依赖合法性校验
      const depViolations = await this.checkDependencyViolations(codeOutputs, sandbox.path, codeAttempt, codeErrors, failedFiles)
      if (depViolations) {
        yield this.progress(`dependency violation: ${depViolations.map(v => v.imp).join(', ')}`, 50, [depViolations.map(v => `${v.file}: import '${v.imp}'`).join('\n')])
        if (ctx.executor) await ctx.executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => {})
        continue
      }

      // 文件校验（分级告警兜底）
      const planFilesFull = mergePlanWithInjections(requirement.plan ?? [])
      const planFilesToValidate = codeAttempt > 1 && failedFiles.size > 0
        ? planFilesFull.filter(f => failedFiles.has(f.path))
        : planFilesFull

      const validationResult = yield* this.validateFiles(ctx, codeOutputs, planFilesToValidate, codeAttempt)
      if (!validationResult) continue

      const { fileMap, fileValidationSummary, criticalMissing, fallbackOriginal } = validationResult

      // 关键文件缺失 → 重试
      if (criticalMissing.length > 0) {
        codeErrors.push(`第${codeAttempt}轮: 关键文件生成失败，LLM 未返回: ${criticalMissing.join(', ')}`)
        yield this.progress(`critical-missing: ${criticalMissing.length}`, 52, criticalMissing)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            `关键代码文件生成失败，AI 遗漏了核心变更文件：${criticalMissing.join(', ')}。请尝试重新描述需求。`,
            'coding', null, `关键文件缺失: ${criticalMissing.join(', ')}`)
          return
        }
        continue
      }

      // 退化检测
      const regressionResult = await this.checkRegressions(fileMap, planFilesToValidate, sandbox.path)
      if (regressionResult) {
        codingRegressionHint = regressionResult.hint
        codeErrors.push(`第${codeAttempt}轮: ${regressionResult.error}`)
        yield this.progress(`regression-guard: ${regressionResult.count}`, 53, regressionResult.warnings)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            `生成代码与磁盘原版相比疑似大段丢失。涉及：${regressionResult.paths.join(', ')}。`,
            'coding', regressionResult.paths[0], regressionResult.error)
          return
        }
        continue
      }
      codingRegressionHint = ''

      // 孤立组件检测
      const orphanResult = await this.checkOrphanComponents(ctx, planFilesToValidate, planFilesFull, fileMap, sandbox.path, codeAttempt)
      if (orphanResult) {
        codeErrors.push(`第${codeAttempt}轮: ${orphanResult.error}`)
        for (const f of orphanResult.files) failedFiles.add(f)
        yield this.progress(`orphan-files: ${orphanResult.files.length}`, 56, orphanResult.hints)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            `组件未被集成到页面中：${orphanResult.files.join(', ')}。`, 'coding', null, orphanResult.error)
          return
        }
        continue
      }

      // Outlet/Nav 路由一致性检测
      const outletResult = await this.checkOutletNavViolations(ctx, sandbox.path, projectContext, planFilesFull, fileMap, codeAttempt, staticGuardInjectPaths)
      if (outletResult) {
        codeErrors.push(`第${codeAttempt}轮: ${outletResult.error}`)
        yield this.progress(`outlet-nav-route: ${outletResult.count}`, 57, outletResult.hints)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            `导航与路由表不一致。`, 'coding', outletResult.layoutPath ?? null, outletResult.error)
          return
        }
        continue
      }

      // 相对 import 解析检测
      const importResult = await this.checkRelativeImportViolations(ctx, sandbox.path, projectContext, planFilesFull, fileMap, codeAttempt, failedFiles, staticGuardInjectPaths)
      if (importResult) {
        codeErrors.push(`第${codeAttempt}轮: ${importResult.error}`)
        yield this.progress(`relative-import-resolve: ${importResult.count}`, 57.5, importResult.hints)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            `代码中存在无法解析的相对路径 import。`, 'coding', importResult.fromPath ?? null, importResult.error)
          return
        }
        continue
      }

      // 写入文件到沙箱
      const validOutputs = Array.from(fileMap.values())
      if (validOutputs.length === 0) {
        codeErrors.push(`第${codeAttempt}轮: 编码阶段未生成有效文件`)
        if (codeAttempt === this.MAX_RETRIES) {
          yield await this.failRequirement(ctx, `编码失败 (${this.MAX_RETRIES}轮):\n${codeErrors.join('\n')}`,
            '代码生成失败，AI 未能生成有效的代码文件。', 'coding', null, '编码阶段未生成有效文件')
          return
        }
        continue
      }

      yield* this.writeFilesToSandbox(ctx, validOutputs, fileValidationSummary)
      previousOutputs = codeOutputs
      finalFileValidationSummary = fileValidationSummary

      // 写入成功，编码阶段完成（测试由 TestingPhase 处理）
      break
    }

    // 编码成功
    log.info('编码阶段完成', { fileCount: codeOutputs.length })

    // 传递编码输出到 PhaseContext 供测试阶段使用
    ;(ctx as any)._codingOutputs = codeOutputs
    ;(ctx as any)._fileValidationSummary = finalFileValidationSummary
    ;(ctx as any)._pastLessons = pastLessons
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private async *runCodingBatches(
    ctx: PhaseContext,
    opts: {
      codeAttempt: number
      mergePlanWithInjections: (base: FilePlan[]) => FilePlan[]
      failedFiles: Set<string>
      codeErrors: string[]
      codingRegressionHint: string
      codingHint: string
      previousOutputs: { path: string; content: string; summary: string }[]
      sandbox: PhaseContext['sandbox']
      staticGuardInjectPaths: Set<string>
    },
  ): AsyncGenerator<OrchestratorEvent, { outputs: { path: string; content: string; summary: string }[]; failed: boolean }> {
    const { requirement, llmClient, promptManager, agentRunner, projectContext, sandbox } = ctx
    let planFiles = opts.mergePlanWithInjections(requirement.plan ?? [])
    const lastTestError = opts.codeErrors.length > 0 ? opts.codeErrors[opts.codeErrors.length - 1] : undefined

    // 重试精简上下文
    let sandboxFileListHint = ''
    if (opts.codeAttempt > 1 && opts.failedFiles.size > 0) {
      const passedFiles = planFiles.filter(f => !opts.failedFiles.has(f.path))
      planFiles = planFiles.filter(f => opts.failedFiles.has(f.path))
      if (planFiles.length === 0) {
        planFiles = opts.mergePlanWithInjections(requirement.plan ?? [])
      }

      try {
        const { execSync } = await import('child_process')
        const fileList = execSync('find . -type f \\( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" \\) | grep -v node_modules | grep -v .git | sort', {
          cwd: sandbox.path, timeout: 5_000, encoding: 'utf-8',
        }).slice(0, 3000)
        sandboxFileListHint = `\n\n## ⚠️ 沙箱中实际存在的文件\n\`\`\`\n${fileList}\`\`\``
      } catch {}

      const availableDeps = await extractAvailableDependencies(sandbox.path)
      if (availableDeps.size > 0) {
        sandboxFileListHint += `\n\n## ⚠️ 可用依赖（只允许 import 以下包）\n${[...availableDeps].sort().join(', ')}`
      }
    }

    const errorHintCombined = [
      opts.codingHint, opts.codingRegressionHint,
      lastTestError ? `\n\n## 上轮测试失败\n${lastTestError}\n请分析错误根因并修正代码。` : '',
      opts.codeAttempt > 1 && opts.previousOutputs.length > 0
        ? '\n\n## 上轮生成的代码（仅供参考）\n' + opts.previousOutputs.map(f => `- ${f.path}: ${f.summary}`).join('\n')
        : '',
      sandboxFileListHint,
    ].filter(Boolean).join('')

    // Architect 分析
    yield this.progress(`architect analyzing ${planFiles.length} files...`, 32)
    let architectOutput: ArchitectOutput | null = null

    for (let archAttempt = 1; archAttempt <= 2; archAttempt++) {
      try {
        if (requirement.structuredRequirement) {
          architectOutput = await runArchitect(
            agentRunner, promptManager, planFiles, sandbox.path,
            projectContext, requirement.structuredRequirement,
          )
        }
        if (architectOutput) break
      } catch (archErr: any) {
        log.warn(`Architect 分析异常 (${archAttempt}/2)`, { error: archErr.message })
      }
    }

    let batches, fileInterfaces
    if (architectOutput) {
      batches = architectOutput.batches
      fileInterfaces = await extractFileInterfaces(sandbox.path, planFiles)
      yield this.progress(`architect: ${batches.length} batches, ${architectOutput.crossFileRefs.length} cross-refs`, 34)
    } else {
      const fallback = await buildBatches(sandbox.path, planFiles)
      batches = fallback.batches
      fileInterfaces = fallback.fileInterfaces
      const MAX_BATCH_SIZE = 3
      const normalized: typeof batches = []
      for (const batch of batches) {
        if (batch.files.length <= MAX_BATCH_SIZE) {
          normalized.push(batch)
        } else {
          for (let i = 0; i < batch.files.length; i += MAX_BATCH_SIZE) {
            normalized.push({ files: batch.files.slice(i, i + MAX_BATCH_SIZE), reason: `${batch.reason}（拆分）` })
          }
        }
      }
      batches = normalized
    }

    // 分批 Coding
    const generatedSummaries = new Map<string, string>()
    let batchFailed = false
    const codeOutputs: { path: string; content: string; summary: string }[] = []

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      yield this.progress(`coding batch ${bi + 1}/${batches.length}: ${batch.files.join(', ')}`, 35 + Math.floor(bi * 30 / batches.length))

      try {
        const batchOutputs = await runCodingBatch(
          llmClient, promptManager, batch, planFiles, fileInterfaces,
          generatedSummaries, sandbox.path, projectContext,
          errorHintCombined || undefined,
          architectOutput?.files, architectOutput?.crossFileRefs, architectOutput?.globalContext,
        )
        codeOutputs.push(...batchOutputs)
        for (const output of batchOutputs) {
          generatedSummaries.set(output.path, extractInterfaceSummary(output))
        }
      } catch (batchErr: any) {
        log.error(`batch ${bi + 1} failed`, { error: batchErr.message })
        batchFailed = true
      }
    }

    if (batchFailed && codeOutputs.length === 0) {
      opts.codeErrors.push(`第${opts.codeAttempt}轮: 所有 batch 均失败`)
      return { outputs: [], failed: true }
    }

    return { outputs: codeOutputs, failed: false }
  }

  private async checkDependencyViolations(
    outputs: { path: string; content: string; summary: string }[],
    sandboxPath: string,
    codeAttempt: number,
    codeErrors: string[],
    failedFiles: Set<string>,
  ): Promise<{ file: string; imp: string }[] | null> {
    const availableDeps = await extractAvailableDependencies(sandboxPath)
    const violations = validateImports(outputs, availableDeps)
    if (violations.length === 0) return null

    const violationMsg = violations.map(v => `${v.file}: import '${v.imp}'`).join('\n')
    codeErrors.push(`第${codeAttempt}轮: 使用了未安装的依赖库：\n${violationMsg}`)
    for (const v of violations) failedFiles.add(v.file)
    return violations
  }

  private async *validateFiles(
    ctx: PhaseContext,
    codeOutputs: { path: string; content: string; summary: string }[],
    planFiles: FilePlan[],
    codeAttempt: number,
  ): AsyncGenerator<OrchestratorEvent, {
    fileMap: Map<string, { path: string; content: string; summary: string }>
    fileValidationSummary: FileValidationSummary
    criticalMissing: string[]
    fallbackOriginal: string[]
  } | null> {
    const { sandbox } = ctx
    yield this.progress('validating-files', 50)

    const { readFile } = await import('fs/promises')
    const fileMap = new Map<string, { path: string; content: string; summary: string }>()
    for (const output of codeOutputs) {
      if (output.path) fileMap.set(output.path, output)
    }

    const fullyGenerated: string[] = []
    const fallbackOriginal: string[] = []
    const criticalMissing: string[] = []

    const CRITICAL_KEYWORDS = ['新增', 'add', '修改', 'update', '重构', 'refactor', '删除', 'delete', '实现', 'implement']
    const SAFE_EXT = [/\.md$/, /\.txt$/, /\.json$/, /\.yaml$/, /\.yml$/]
    const SUSPICIOUS = ['参考', '查看', '阅读', 'refer', 'read', '了解', '分析', 'analyze']

    for (const planFile of planFiles) {
      if (fileMap.has(planFile.path)) {
        fullyGenerated.push(planFile.path)
        continue
      }

      const lowerDesc = planFile.changeDescription.toLowerCase()
      const isCritical = CRITICAL_KEYWORDS.some(k => lowerDesc.includes(k.toLowerCase()))
      const isSafe = SAFE_EXT.some(p => p.test(planFile.path)) || SUSPICIOUS.some(k => lowerDesc.includes(k.toLowerCase()))

      if (isCritical) {
        criticalMissing.push(planFile.path)
      } else if (isSafe) {
        try {
          const originalContent = await readFile(join(sandbox.path, planFile.path), 'utf-8')
          fileMap.set(planFile.path, { path: planFile.path, content: originalContent, summary: '[WARNING] LLM 未返回该文件变更，保留原始内容' })
          fallbackOriginal.push(planFile.path)
        } catch {
          fileMap.set(planFile.path, { path: planFile.path, content: '', summary: planFile.changeDescription })
          fallbackOriginal.push(planFile.path + ' (empty)')
        }
      } else {
        criticalMissing.push(planFile.path)
      }
    }

    const fileValidationSummary: FileValidationSummary = {
      totalPlanFiles: planFiles.length,
      fullyGenerated,
      fallbackOriginal,
      noChangeDetected: [],
      criticalMissing,
    }

    yield { type: 'file-validation', summary: fileValidationSummary }

    if (fallbackOriginal.length > 0) {
      yield this.progress(`warning: ${fallbackOriginal.length} 个文件保留原始内容`, 55, fallbackOriginal)
    }

    return { fileMap, fileValidationSummary, criticalMissing, fallbackOriginal }
  }

  private async checkRegressions(
    fileMap: Map<string, { path: string; content: string; summary: string }>,
    planFiles: FilePlan[],
    sandboxPath: string,
  ): Promise<{ hint: string; error: string; count: number; warnings: string[]; paths: string[] } | null> {
    if (process.env.THEHAND_DISABLE_REGRESSION_GUARD === '1') return null

    const SRC_FOR_REGRESSION = /\.(jsx?|tsx|vue)$/
    const { readFile } = await import('fs/promises')
    const regressions: { path: string; reasons: string[] }[] = []

    for (const planFile of planFiles) {
      if (!SRC_FOR_REGRESSION.test(planFile.path)) continue
      const out = fileMap.get(planFile.path)
      if (!out?.content || out.content === '__DELETE__') continue
      let originalOnDisk = ''
      try { originalOnDisk = await readFile(join(sandboxPath, planFile.path), 'utf-8') } catch { continue }
      const { suspicious, reasons } = detectCodingRegression(originalOnDisk, out.content)
      if (suspicious && reasons.length > 0) regressions.push({ path: planFile.path, reasons })
    }

    if (regressions.length === 0) return null

    const hint = formatRegressionRetryHint(regressions)
    return {
      hint,
      error: `编码退化检测：${regressions.map(r => r.path).join(', ')}`,
      count: regressions.length,
      warnings: regressions.flatMap(r => r.reasons.map(reason => `${r.path}: ${reason}`)),
      paths: regressions.map(r => r.path),
    }
  }

  private async checkOrphanComponents(
    ctx: PhaseContext,
    planFiles: FilePlan[],
    planFilesFull: FilePlan[],
    fileMap: Map<string, { path: string; content: string; summary: string }>,
    sandboxPath: string,
    codeAttempt: number,
  ): Promise<{ files: string[]; hints: string[]; error: string } | null> {
    const { projectContext } = ctx
    const COMPONENT_EXTS = /\.(jsx?|tsx|vue)$/
    const STYLE_ASSET_EXTS = /\.(css|scss|less|svg|png|jpg|json)$/
    const BARREL_EXTS = /\/index\.(jsx?|tsx|js|ts)$/

    const generatedComponentFiles = planFiles.filter(f => {
      if (STYLE_ASSET_EXTS.test(f.path)) return false
      if (!COMPONENT_EXTS.test(f.path)) return false
      if (BARREL_EXTS.test(f.path)) return false
      if (skipOrphanImportIntegrationCheck(f.path, projectContext.thehand?.orphanGuard)) return false
      const backendDir = projectContext.structure.backend?.replace(/\/$/, '') || 'backend'
      if (f.path.startsWith(backendDir + '/') || f.path === backendDir) return false
      return fileMap.has(f.path)
    })

    if (generatedComponentFiles.length === 0) return null

    let sandboxSourceIndex: Map<string, string> | undefined
    const orphanFiles: string[] = []
    const orphanHints: string[] = []
    const knownFromBatch = new Set(fileMap.keys())

    for (const nf of generatedComponentFiles) {
      const baseName = nf.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? ''
      if (!baseName) continue

      let isImported = Array.from(fileMap.values()).some(other => {
        if (other.path === nf.path) return false
        if (BARREL_EXTS.test(other.path)) return false
        if (STYLE_ASSET_EXTS.test(other.path)) return false
        return sourceFileImportsTargetModule(other.content, other.path, nf.path, knownFromBatch)
      })

      if (!isImported) {
        if (!sandboxSourceIndex) {
          sandboxSourceIndex = await loadSandboxSourceContents(sandboxPath, projectContext.structure)
          for (const o of fileMap.values()) {
            if (!o.path || o.content === '__DELETE__') continue
            if (!/\.(jsx?|tsx|vue|mjs|cjs)$/.test(o.path)) continue
            sandboxSourceIndex.set(o.path.replace(/\\/g, '/'), o.content)
          }
        }
        isImported = sandboxIndexImportsComponent(sandboxSourceIndex, nf.path, baseName)
      }

      if (!isImported) {
        orphanFiles.push(nf.path)
        const normPath = nf.path.replace(/\\/g, '/')
        if (isRouteTableModulePath(normPath)) {
          const entry = pickApplicationEntryForRouteTable(sandboxPath, projectContext)
          orphanHints.push(entry
            ? `${nf.path} 未被相对 import。应在应用入口 ${entry} 中 import 并挂接该路由表。`
            : `${nf.path} 未被任何文件 import。请在应用入口中 import 并挂载该路由表。`)
        } else {
          orphanHints.push(`${nf.path} 未被任何文件 import，必须修改父组件来 import 并使用它`)
        }
      }
    }

    if (orphanFiles.length === 0) return null
    return { files: orphanFiles, hints: orphanHints, error: `组件孤立（未被父组件 import）:\n${orphanHints.join('\n')}` }
  }

  private async checkOutletNavViolations(
    ctx: PhaseContext,
    sandboxPath: string,
    projectContext: PhaseContext['projectContext'],
    planFilesFull: FilePlan[],
    fileMap: Map<string, { path: string; content: string; summary: string }>,
    codeAttempt: number,
    staticGuardInjectPaths: Set<string>,
  ): Promise<{ count: number; hints: string[]; error: string; layoutPath?: string } | null> {
    if (process.env.THEHAND_DISABLE_OUTLET_NAV_GUARD === '1') return null

    const outletViolations = await findOutletNavRouteViolations(sandboxPath, projectContext, planFilesFull, fileMap)
    if (outletViolations.length === 0) return null

    const hints = outletViolations.map(v => v.message)
    if (codeAttempt < this.MAX_RETRIES) {
      const injectPaths = collectRouteIntegrationContextPaths(sandboxPath, projectContext)
      for (const p of injectPaths) staticGuardInjectPaths.add(p.replace(/\\/g, '/'))
    }

    return {
      count: outletViolations.length,
      hints,
      error: `嵌套路由未注册:\n${hints.join('\n')}`,
      layoutPath: outletViolations[0]?.layoutPath,
    }
  }

  private async checkRelativeImportViolations(
    ctx: PhaseContext,
    sandboxPath: string,
    projectContext: PhaseContext['projectContext'],
    planFilesFull: FilePlan[],
    fileMap: Map<string, { path: string; content: string; summary: string }>,
    codeAttempt: number,
    failedFiles: Set<string>,
    staticGuardInjectPaths: Set<string>,
  ): Promise<{ count: number; hints: string[]; error: string; fromPath?: string } | null> {
    if (process.env.THEHAND_DISABLE_RELATIVE_IMPORT_GUARD === '1') return null

    const importViolations = await findUnresolvedRelativeImportsInFileMap(sandboxPath, projectContext, planFilesFull, fileMap)
    if (importViolations.length === 0) return null

    const hints = importViolations.map(v => v.message)
    for (const v of importViolations) {
      if (v.fromPath) failedFiles.add(v.fromPath)
      staticGuardInjectPaths.add(v.fromPath.replace(/\\/g, '/'))
    }

    return {
      count: importViolations.length,
      hints,
      error: `相对 import 无法解析:\n${hints.join('\n')}`,
      fromPath: importViolations[0]?.fromPath,
    }
  }

  private async *writeFilesToSandbox(
    ctx: PhaseContext,
    validOutputs: { path: string; content: string; summary: string }[],
    fileValidationSummary: FileValidationSummary,
  ): AsyncGenerator<OrchestratorEvent> {
    const { writeFile, mkdir, rm, readFile, unlink, readdir } = await import('fs/promises')
    const sandboxPath = ctx.sandbox.path

    // 清理残留 .orig 文件
    try {
      const walkDir = async (dir: string): Promise<string[]> => {
        const results: string[] = []
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          const fullPath = join(dir, e.name)
          if (e.isDirectory()) results.push(...(await walkDir(fullPath)))
          else if (e.name.endsWith('.orig')) results.push(fullPath)
        }
        return results
      }
      const oldOrigFiles = await walkDir(sandboxPath)
      for (const f of oldOrigFiles) await unlink(f).catch(() => {})
    } catch {}

    // 备份原始文件 + 写入新文件
    yield this.progress('writing-files', 60)
    for (const file of validOutputs) {
      const fullPath = join(sandboxPath, file.path)
      const origBackupPath = fullPath + '.orig'
      try {
        const exists = await readFile(fullPath, 'utf-8')
        await writeFile(origBackupPath, exists, 'utf-8')
      } catch {
        await mkdir(dirname(origBackupPath), { recursive: true })
        await writeFile(origBackupPath, '', 'utf-8')
      }
    }

    for (const file of validOutputs) {
      const fullPath = join(sandboxPath, file.path)
      if (file.content.trim().includes('__DELETE__')) {
        try { await rm(fullPath, { force: true }); yield this.progress(`deleted: ${file.path}`, 60) }
        catch { yield this.progress(`delete skipped: ${file.path}`, 60) }
      } else {
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, file.content, 'utf-8')
        yield this.progress(`wrote: ${file.path}`, 60)
      }
    }

    // Diff 空变更检测
    yield this.progress('diff-validation', 62)
    const { readFile: rf } = await import('fs/promises')
    for (const file of validOutputs) {
      try {
        const orig = await rf(join(sandboxPath, file.path + '.orig'), 'utf-8')
        const next = await rf(join(sandboxPath, file.path), 'utf-8')
        if (orig === next) fileValidationSummary.noChangeDetected.push(file.path)
      } catch {}
    }
  }

  private async failRequirement(
    ctx: PhaseContext,
    detailedError: string,
    userMessage: string,
    phase: string,
    filePath: string | null,
    errorSummary: string,
  ): Promise<OrchestratorEvent> {
    const { requirement, requirementMemory } = ctx
    transition(requirement, 'failed', userMessage)
    await requirementMemory.saveRequirement(requirement)
    await requirementMemory.saveLesson({
      id: crypto.randomUUID(),
      projectId: ctx.projectId,
      requirementId: requirement.id,
      phase,
      filePath,
      errorSummary,
      errorDetail: detailedError,
      fixHint: null,
      resolved: false,
      createdAt: new Date(),
    })
    return { type: 'failed', requirement, error: detailedError, userMessage }
  }
}
