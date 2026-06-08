import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import type { FilePlan, FileInterface, ChangeBatch, ArchitectOutput, ArchitectFileAnalysis, CrossFileRef, ProjectContext, StructuredRequirement, TheHandRoutingIntegration } from '../types.js'
import type { AgentDefinition, AgentContext } from '../types.js'
import type { ToolDefinition, LLMClient } from '../llm/llm-client.js'
import type { PromptManager } from '../llm/prompt-manager.js'
import type { AgentRunner } from './agent-runner.js'
import { matchPathGlob } from '../utils/path-glob.js'
import { isRouteTableModulePath, pickApplicationEntryForRouteTable } from '../utils/route-wiring-entry.js'

// ============================================================
// Architect Agent Function Calling 输出工具定义
// ============================================================

export const ARCHITECT_OUTPUT_TOOL: ToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'submit_architecture',
    description: '提交架构分析结果。包含文件改动详情、跨文件引用、分批方案。',
    parameters: {
      type: 'object',
      properties: {
        globalContext: { type: 'string', description: '本次变更的核心逻辑：一段话描述整体改动' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              action: { type: 'string', enum: ['create', 'modify', 'delete'], description: '操作类型' },
              detailedChange: { type: 'string', description: '精确的改动指令：指明具体位置、函数、字段' },
              dependencies: { type: 'array', items: { type: 'string' }, description: '依赖的其他 plan 文件' },
              exports: { type: 'array', items: { type: 'string' }, description: '该文件导出的接口' },
              priority: { type: 'number', description: '生成优先级，数字越小越先生成' },
            },
            required: ['path', 'action', 'detailedChange', 'dependencies', 'exports', 'priority'],
          },
        },
        crossFileRefs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '引用方文件路径' },
              to: { type: 'string', description: '被引用方文件路径' },
              ref: { type: 'string', description: '引用关系描述（import/export/API 契约）' },
            },
            required: ['from', 'to', 'ref'],
          },
        },
        batches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'string' }, description: '该批次的文件列表' },
              reason: { type: 'string', description: '分批原因' },
            },
            required: ['files', 'reason'],
          },
        },
      },
      required: ['globalContext', 'files', 'crossFileRefs', 'batches'],
    },
  },
}

// ============================================================
// 文件接口提取（正则，零 LLM 消耗 —— 作为 Architect 输入预处理）
// ============================================================

/**
 * 用正则提取文件的接口信息
 * 只读 imports 等骨架行，不关注实现细节
 */
export async function extractFileInterfaces(
  sandboxPath: string,
  plan: FilePlan[],
): Promise<FileInterface[]> {
  const interfaces: FileInterface[] = []

  for (const file of plan) {
    // 用 FilePlan.path 作为统一路径（正斜杠），不用 resolve 的结果
    const normalizedPath = file.path.replace(/\\/g, '/')
    const fullPath = resolve(sandboxPath, file.path)
    if (!fullPath.startsWith(resolve(sandboxPath))) continue

    let content = ''
    try {
      content = await readFile(fullPath, 'utf-8')
    } catch {
      interfaces.push({
        path: normalizedPath,
        exports: [],
        imports: [],
        functionSignatures: [],
        routeDefinitions: [],
        modelFields: [],
      })
      continue
    }

    interfaces.push(extractInterfaceFromContent(normalizedPath, content))
  }

  return interfaces
}

/**
 * 从文件内容中提取接口信息（纯正则）
 */
function extractInterfaceFromContent(filePath: string, content: string): FileInterface {
  const lines = content.split('\n')
  const exports: string[] = []
  const imports: string[] = []
  const functionSignatures: string[] = []
  const routeDefinitions: string[] = []
  const modelFields: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^import\s/.test(trimmed)) {
      imports.push(trimmed)
      continue
    }
    // CJS require: const x = require('./path')
    if (/require\s*\(\s*['"]\./.test(trimmed)) {
      imports.push(trimmed)
      continue
    }
    if (/^export\s/.test(trimmed)) {
      exports.push(trimmed)
      continue
    }
    if (/^(export\s+)?(function|class)\s+\w+/.test(trimmed) ||
        /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)) {
      functionSignatures.push(trimmed)
      continue
    }
    if (/^router\.(get|post|put|delete|patch|use)\s*\(/.test(trimmed)) {
      routeDefinitions.push(trimmed)
      continue
    }
    if (/^\w+:\s*\{/.test(trimmed) && /type:\s*DataTypes\.\w+/.test(trimmed)) {
      modelFields.push(trimmed)
      continue
    }
  }

  return { path: filePath, exports, imports, functionSignatures, routeDefinitions, modelFields }
}

// ============================================================
// LLM Architect Agent
// ============================================================

/**
 * 创建 Architect Agent 定义
 */
export function createArchitectAgent(systemPrompt: string): AgentDefinition {
  return {
    name: 'architect',
    description: '分析文件依赖关系，产出精确分批方案和详细改动指令',
    maxRounds: 3,
    systemPrompt,
    tools: [],
    outputTool: ARCHITECT_OUTPUT_TOOL,
  }
}

/**
 * LLM Architect 主入口
 * 用大模型分析文件依赖、产出精确分批方案 + 详细改动指令
 *
 * @returns ArchitectOutput | null（LLM 失败时返回 null，调用方可降级到正则分批）
 */
export async function runArchitect(
  agentRunner: AgentRunner,
  promptManager: PromptManager,
  plan: FilePlan[],
  sandboxPath: string,
  projectContext: ProjectContext,
  structuredRequirement: StructuredRequirement,
): Promise<ArchitectOutput | null> {
  // 1. 正则预处理：提取文件骨架作为 LLM 输入
  const fileInterfaces = await extractFileInterfaces(sandboxPath, plan)

  // 2. 加载 architect prompt
  const systemPromptBase = await promptManager.load('architect')

  // 3. 构建 system prompt（注入项目上下文和约束）
  let constraintsHint = ''
  if (projectContext.constraints) {
    const entries = Object.entries(projectContext.constraints)
    if (entries.length > 0) {
      constraintsHint = '\n\n## 项目约束\n' + entries.map(([k, v]) => `- ${k}: ${v}`).join('\n')
    }
  }

  const systemPrompt = `${systemPromptBase}

## 项目上下文
${JSON.stringify(projectContext, null, 2)}
${constraintsHint}`

  // 4. 构建 user message
  const fileInterfaceText = fileInterfaces.map(fi =>
    `### ${fi.path}\n- exports: ${fi.exports.join(', ') || '无'}\n- imports: ${fi.imports.join(', ') || '无'}\n- 函数签名: ${fi.functionSignatures.join(', ') || '无'}\n- 路由定义: ${fi.routeDefinitions.join(', ') || '无'}\n- 模型字段: ${fi.modelFields.join(', ') || '无'}`
  ).join('\n\n')

  const planText = plan.map(f =>
    `- ${f.path}: ${f.changeDescription} (priority: ${f.priority})`
  ).join('\n')

  const userMessage = `## 结构化需求
${JSON.stringify(structuredRequirement, null, 2)}

## 技术方案（需要修改的文件）
${planText}

## 文件接口信息（正则预提取）
${fileInterfaceText}

请分析文件依赖关系，输出精确的分批方案和每个文件的详细改动指令。`

  // 5. 调用 LLM Agent
  const agentContext: AgentContext = {
    requirement: {
      id: '',
      status: 'coding',
      pmInput: '',
      structuredRequirement,
      plan,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    projectContext,
    memory: {
      structuredRequirement,
      recentConversations: [],
      projectContext,
      lessons: [],
    },
  }

  const result = await agentRunner.run(createArchitectAgent(systemPrompt), agentContext)

  if (result.status !== 'success' || !result.output) {
    console.warn(`[architect] LLM 分析失败: status=${result.status}, tokens=${result.inputTokens}/${result.outputTokens}`)
    return null
  }

  // 6. 解析和校验输出
  const output = result.output as ArchitectOutput

  // 基本结构校验
  if (!output.batches || !Array.isArray(output.batches) || output.batches.length === 0) {
    console.warn('[architect] LLM 输出缺少 batches，降级到正则分批')
    return null
  }

  if (!output.files || !Array.isArray(output.files)) {
    console.warn('[architect] LLM 输出缺少 files，降级到正则分批')
    return null
  }

  // 7. 修复畸形输出
  // 7a. 修复 files 字段：确保每个 batch 的 files 是数组
  let repairCount = 0
  for (const batch of output.batches) {
    if (typeof batch.files === 'string') {
      batch.files = [batch.files]
      repairCount++
    } else if (!Array.isArray(batch.files)) {
      batch.files = []
      repairCount++
    }
  }
  if (repairCount > 0) {
    console.warn(`[architect] 修复了 ${repairCount} 个畸形 batch.files 字段`)
  }

  // 7b. 合并过多的 batches（LLM 有时返回过多 batch，如 18 个 batch 对应 9 个文件）
  const MAX_BATCHES = Math.max(plan.length, 5)  // 最多不超过 plan 文件数或 5
  if (output.batches.length > MAX_BATCHES) {
    console.warn(`[architect] batches 过多 (${output.batches.length})，合并为 ${MAX_BATCHES} 个`)
    const merged: typeof output.batches = []
    const perBatch = Math.ceil(output.batches.length / MAX_BATCHES)
    for (let i = 0; i < output.batches.length; i += perBatch) {
      const group = output.batches.slice(i, i + perBatch)
      merged.push({
        files: group.flatMap(b => b.files),
        reason: group.map(b => b.reason).filter(Boolean).join('; ') || '合并过多 batches',
      })
    }
    output.batches = merged
  }

  // 确保 batches 覆盖所有 plan 文件
  const batchFileSet = new Set(output.batches.flatMap(b => b.files))
  const planFileSet = new Set(plan.map(f => f.path))
  const missingFromBatches = [...planFileSet].filter(p => !batchFileSet.has(p))
  if (missingFromBatches.length > 0) {
    console.warn(`[architect] batches 遗漏文件: ${missingFromBatches.join(', ')}，补充到最后一个 batch`)
    output.batches[output.batches.length - 1].files.push(...missingFromBatches)
  }

  // 确保每个 batch 不超过 3 个文件（prompt 要求，但做容错）
  const normalizedBatches: ChangeBatch[] = []
  for (const batch of output.batches) {
    if (batch.files.length <= 3) {
      normalizedBatches.push(batch)
    } else {
      // 拆分过大的 batch
      for (let i = 0; i < batch.files.length; i += 3) {
        normalizedBatches.push({
          files: batch.files.slice(i, i + 3),
          reason: `${batch.reason}（拆分自过大 batch）`,
        })
      }
    }
  }

  // 7. 确保新文件被集成（每个 create 必须有父文件 modify 引用它）
  const integrationResult = ensureNewFilesIntegrated(output, plan, sandboxPath, projectContext)
  ensureBatchesCoverArchitectFiles(normalizedBatches, integrationResult.files)

  console.log(`[architect] LLM 分析完成: ${normalizedBatches.length} batches, ${integrationResult.crossFileRefs.length} cross-file refs`)
  console.log(`[architect] batches: ${normalizedBatches.map(b => `[${b.files.join(', ')}]`).join(' → ')}`)
  if (integrationResult.injectedParents.length > 0) {
    console.log(`[architect] 自动补充了 ${integrationResult.injectedParents.length} 个父文件集成: ${integrationResult.injectedParents.join(', ')}`)
  }

  return {
    globalContext: output.globalContext ?? '',
    files: integrationResult.files,
    crossFileRefs: integrationResult.crossFileRefs,
    batches: normalizedBatches,
  }
}

// ============================================================
// 新文件集成校验 + 自动补全
// ============================================================

function pickRouteEntryPath(sandboxPath: string, ri: TheHandRoutingIntegration): string | null {
  for (const p of ri.routeEntryFiles ?? []) {
    const rel = p.replace(/\\/g, '/')
    if (existsSync(resolve(sandboxPath, rel))) return rel
  }
  return null
}

function isNestedNewPageForRoutingIntegration(filePath: string, ri: TheHandRoutingIntegration): boolean {
  const glob = ri.nestedNewPageGlob?.trim()
  if (!glob) return false
  const norm = filePath.replace(/\\/g, '/')
  if (!matchPathGlob(norm, glob)) return false
  for (const ex of ri.nestedNewPageExcludeGlobs ?? []) {
    if (ex && matchPathGlob(norm, ex)) return false
  }
  return true
}

/**
 * 当 project.json 配置了 thehand.routingIntegration 时：
 * 新建页面命中 nestedNewPageGlob 且未命中 exclude 时，强制在 routeEntryFiles 之一中注册路由。
 */
function injectRoutingIntegrationForNestedPages(
  projectContext: ProjectContext | undefined,
  newFile: ArchitectFileAnalysis,
  files: ArchitectFileAnalysis[],
  crossFileRefs: CrossFileRef[],
  injectedParents: string[],
  sandboxPath: string,
): void {
  const ri = projectContext?.thehand?.routingIntegration
  if (!ri || ri.enabled === false) return
  if (!ri.routeEntryFiles?.length || !ri.nestedNewPageGlob?.trim()) return

  if (newFile.action !== 'create') return
  if (!isNestedNewPageForRoutingIntegration(newFile.path, ri)) return

  const routeEntry = pickRouteEntryPath(sandboxPath, ri)
  if (!routeEntry) return

  const COMPONENT_EXTS = /\.(jsx?|tsx|vue)$/
  const base = newFile.path.split('/').pop()?.replace(COMPONENT_EXTS, '') ?? ''
  if (!base) return

  const alreadyLinked = crossFileRefs.some(r => r.from === routeEntry && r.to === newFile.path)
  if (alreadyLinked) return

  const siblingHint = ri.injectSiblingRouteHint?.trim() || '与已有同级子路由一致'
  const parentHint = ri.nestedRouteParentHint?.trim() || '父级导航 / 嵌套路由中使用的 path 片段'

  const note =
    `【自动补充-路由表】在 ${routeEntry} 的 <Routes>（或项目等价路由表）中为「${base}」增加路由；` +
    `须与 ${parentHint} 对齐。` +
    `请 import ${base} 并挂载为 element（${siblingHint}）。`

  const existingEntry = files.find(f => f.path === routeEntry)
  if (existingEntry) {
    if (!existingEntry.detailedChange.includes(`「${base}」`)) {
      existingEntry.detailedChange += `\n${note}`
    }
  } else {
    files.push({
      path: routeEntry,
      action: 'modify',
      detailedChange: note,
      dependencies: [newFile.path],
      exports: [],
      priority: Math.max(0, newFile.priority - 1),
    })
    injectedParents.push(routeEntry)
  }

  crossFileRefs.push({
    from: routeEntry,
    to: newFile.path,
    ref: `路由表注册 + import ${base}（thehand.routingIntegration）`,
  })
}

/** 将 architecture.files 中尚未出现在任一批次的 path 补进最后一批（含自动注入的路由入口等） */
function ensureBatchesCoverArchitectFiles(batches: ChangeBatch[], archFiles: ArchitectFileAnalysis[]): void {
  if (batches.length === 0) return
  const set = new Set(batches.flatMap(b => b.files))
  for (const af of archFiles) {
    if (set.has(af.path)) continue
    batches[batches.length - 1].files.push(af.path)
    set.add(af.path)
    console.warn(`[architect] batches 补充架构中的文件: ${af.path}`)
  }
  // 注入路由入口等后每批仍须 ≤3（与上文 LLM 分批约束一致）
  const last = batches[batches.length - 1]
  if (last && last.files.length > 3) {
    const overflow = last.files.splice(3)
    batches.push({ files: overflow, reason: '拆分：补充入口/路由挂接' })
  }
}

/**
 * 确保每个 action:'create' 的新文件都有父文件引用它
 * 如果 architect 漏掉了父文件修改，自动注入
 */
function ensureNewFilesIntegrated(
  output: ArchitectOutput,
  plan: FilePlan[],
  sandboxPath: string,
  projectContext: ProjectContext,
): { files: ArchitectFileAnalysis[]; crossFileRefs: CrossFileRef[]; injectedParents: string[] } {
  const files = [...output.files]
  const crossFileRefs = [...(output.crossFileRefs ?? [])]
  const injectedParents: string[] = []

  // 找出所有 action:'create' 的文件
  const newFiles = files.filter(f => f.action === 'create')

  // 前置检测：新建的组件是否和已有组件名称相似（如 ArticlePreview vs ArticlesPreview）
  const COMPONENT_EXTS = /\.(jsx?|tsx|vue)$/
  const allPlanPaths = plan.map(f => f.path)
  for (const newFile of newFiles) {
    if (!COMPONENT_EXTS.test(newFile.path)) continue
    const newName = newFile.path.split('/').pop()?.replace(COMPONENT_EXTS, '').toLowerCase() ?? ''
    // 检查 plan 中是否有名称相似但不是新建的文件
    const similarExisting = allPlanPaths.filter(p => {
      if (p === newFile.path) return false
      if (!COMPONENT_EXTS.test(p)) return false
      const existingName = p.split('/').pop()?.replace(COMPONENT_EXTS, '').toLowerCase() ?? ''
      // 名称相同（忽略大小写）或一个是另一个的复数形式
      return existingName === newName ||
             existingName === newName + 's' ||
             newName === existingName + 's' ||
             (existingName.length > 3 && newName.length > 3 && existingName.includes(newName)) ||
             (existingName.length > 3 && newName.length > 3 && newName.includes(existingName))
    })
    if (similarExisting.length > 0) {
      console.warn(`[architect] ⚠️ 新建 ${newFile.path} 与已有组件 ${similarExisting.join(', ')} 名称相似，建议直接修改已有组件而非创建新文件`)
    }
  }

  for (const newFile of newFiles) {
    // 检查是否已有 crossFileRef 指向这个新文件（说明有父文件引用它）
    const hasReferrer = crossFileRefs.some(r => r.to === newFile.path)
    // 检查是否有其他文件的 detailedChange 提到了这个新文件
    const hasIntegrator = files.some(f =>
      f.path !== newFile.path &&
      f.action === 'modify' &&
      f.detailedChange.toLowerCase().includes(newFile.path.split('/').pop()?.replace(/\.(jsx?|tsx?|vue)$/, '').toLowerCase() ?? '')
    )

    if (!hasReferrer && !hasIntegrator) {
      // 需要自动补充父文件（UI 侧 import）
      const parentPath = findLikelyParent(newFile.path, plan, files, sandboxPath, projectContext)
      if (parentPath) {
        const newBaseName = newFile.path.split('/').pop()?.replace(/\.(jsx?|tsx?|vue)$/, '') ?? ''

        // 检查父文件是否已在 files 列表中
        const existingParent = files.find(f => f.path === parentPath)
        if (existingParent) {
          // 已有父文件条目，补充 detailedChange
          existingParent.detailedChange += `\n【自动补充】必须 import 并使用新组件 ${newBaseName}（来自 ${newFile.path}）`
        } else {
          // 注入新的父文件 modify 条目
          files.push({
            path: parentPath,
            action: 'modify',
            detailedChange: `【自动补充】import 并使用新组件 ${newBaseName}（来自 ${newFile.path}）。在合适的位置渲染该组件，使其对用户可见。`,
            dependencies: [newFile.path],
            exports: [],
            priority: newFile.priority + 1,
          })
        }

        // 补充 crossFileRef
        crossFileRefs.push({
          from: parentPath,
          to: newFile.path,
          ref: `import ${newBaseName} from '${getRelativeImportPath(parentPath, newFile.path)}'`,
        })

        injectedParents.push(parentPath)
        console.log(`[architect] 自动补充父文件集成: ${parentPath} → ${newFile.path}`)
      } else {
        console.warn(`[architect] 无法为新文件 ${newFile.path} 找到合适的父文件，可能无法在页面上显示`)
      }
    }

    injectRoutingIntegrationForNestedPages(projectContext, newFile, files, crossFileRefs, injectedParents, sandboxPath)
  }

  ensureRouteTableWiredToEntry(files, crossFileRefs, plan, sandboxPath, projectContext, injectedParents)

  return { files, crossFileRefs, injectedParents }
}

/**
 * 若方案含 router.jsx/tsx 等路由表文件，必须能从应用入口以相对 import 挂到树上；
 * 否则孤儿检测会误提示「让 Profile 去 import router」。此处强制补充入口 modify + crossRef。
 */
function ensureRouteTableWiredToEntry(
  files: ArchitectFileAnalysis[],
  crossFileRefs: CrossFileRef[],
  plan: FilePlan[],
  sandboxPath: string,
  projectContext: ProjectContext,
  injectedParents: string[],
): void {
  const routeTables = new Set<string>()
  for (const p of plan.map(f => f.path)) {
    if (isRouteTableModulePath(p)) routeTables.add(p.replace(/\\/g, '/'))
  }
  for (const f of files) {
    if (isRouteTableModulePath(f.path)) routeTables.add(f.path.replace(/\\/g, '/'))
  }
  if (routeTables.size === 0) return

  const entry = pickApplicationEntryForRouteTable(sandboxPath, projectContext)
  if (!entry) {
    console.warn('[architect] 方案含路由表文件但无法解析应用入口（main/App），跳过自动挂接')
    return
  }
  const normEntry = entry.replace(/\\/g, '/')

  for (const rt of routeTables) {
    const normRt = rt.replace(/\\/g, '/')
    const linkedFromEntry = crossFileRefs.some(
      r => r.from.replace(/\\/g, '/') === normEntry && r.to.replace(/\\/g, '/') === normRt,
    )
    if (linkedFromEntry) continue

    const base = normRt.split('/').pop()?.replace(/\.(jsx?|tsx?|js|ts)$/i, '') ?? 'router'
    const note =
      `【自动补充-路由入口】在 ${normEntry} 中以相对路径 import 路由表 ${normRt}，并用其导出（或其中定义的 Routes）替换/接好现有 React Router 配置；` +
      '禁止仅在 routes 下的页面组件中 import 该路由表文件。保持 HashRouter/BrowserRouter 与 path 与原版一致。'

    const existingEntry = files.find(f => f.path.replace(/\\/g, '/') === normEntry)
    if (existingEntry) {
      if (!existingEntry.detailedChange.includes(normRt)) {
        existingEntry.detailedChange += `\n${note}`
      }
    } else {
      files.push({
        path: normEntry,
        action: 'modify',
        detailedChange: note,
        dependencies: [normRt],
        exports: [],
        priority: 0,
      })
      injectedParents.push(normEntry)
    }

    crossFileRefs.push({
      from: normEntry,
      to: normRt,
      ref: `入口 ${normEntry} import 并挂载路由表 ${base}`,
    })
    console.log(`[architect] 自动补充路由表挂接: ${normEntry} → ${normRt}`)
  }
}

/**
 * 为新文件查找最可能的父文件
 * 策略：同目录/父目录下的已有文件 > 路由文件 > 列表组件
 */
function findLikelyParent(
  newFilePath: string,
  plan: FilePlan[],
  archFiles: ArchitectFileAnalysis[],
  sandboxPath: string,
  projectContext: ProjectContext,
): string | null {
  const newDir = newFilePath.split('/').slice(0, -1).join('/')
  const newBaseName = newFilePath.split('/').pop()?.replace(/\.(jsx?|tsx?|vue)$/, '') ?? ''

  if (isRouteTableModulePath(newFilePath)) {
    const entry = pickApplicationEntryForRouteTable(sandboxPath, projectContext)
    if (entry) return entry
  }

  // 候选池：plan 中的已有文件 + architect 中 action:'modify' 的文件
  const candidates = new Set<string>()
  for (const f of plan) candidates.add(f.path)
  for (const f of archFiles) {
    if (f.action === 'modify' || f.action === 'delete') candidates.add(f.path)
  }

  // 排除新文件自身
  candidates.delete(newFilePath)

  const scored: { path: string; score: number }[] = []

  for (const candidate of candidates) {
    let score = 0

    // 同目录下的文件（如 CommentList.jsx 在 Comment/ 目录下）
    const candidateDir = candidate.split('/').slice(0, -1).join('/')
    if (candidateDir === newDir) score += 10

    // 父目录下的文件（如 HomeArticles.jsx 在 routes/Home/ 下）
    if (newDir.startsWith(candidateDir) || candidateDir.startsWith(newDir)) score += 5

    // 路由文件优先（routes/ 目录）
    if (candidate.includes('/routes/')) score += 8

    // 列表组件优先（名称包含 List）
    if (candidate.includes('List')) score += 6

    // 名称相关性：新文件名是候选名的子集或反之
    const candidateBaseName = candidate.split('/').pop()?.replace(/\.(jsx?|tsx?|vue)$/, '') ?? ''
    if (candidateBaseName.includes(newBaseName) || newBaseName.includes(candidateBaseName)) score += 4

    // 父级组件目录匹配（新文件在 components/X/ 下，候选是同级或父级组件）
    const newComponents = newDir.split('/')
    const candidateComponents = candidateDir.split('/')
    const sharedPrefix = newComponents.filter((_, i) => newComponents[i] === candidateComponents[i]).length
    score += sharedPrefix

    if (score > 0) scored.push({ path: candidate, score })
  }

  // 按分数排序，返回最高分的候选
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.path ?? null
}

/**
 * 计算相对导入路径
 */
function getRelativeImportPath(fromFile: string, toFile: string): string {
  const fromParts = fromFile.split('/').slice(0, -1)
  const toParts = toFile.split('/')

  // 找到公共前缀
  let commonLen = 0
  while (commonLen < fromParts.length && commonLen < toParts.length && fromParts[commonLen] === toParts[commonLen]) {
    commonLen++
  }

  const upCount = fromParts.length - commonLen
  const relParts = toParts.slice(commonLen)
  const prefix = upCount > 0 ? '../'.repeat(upCount) : './'
  const result = prefix + relParts.join('/')

  // 去掉扩展名
  return result.replace(/\.(jsx?|tsx|vue)$/, '')
}

// ============================================================
// 正则分批（降级方案，LLM 失败时使用）
// ============================================================

/**
 * 从 import 语句中解析出引用的模块路径
 * 支持: import x from './path', require('./path'), import('./path')
 */
function parseImportPaths(importLine: string): string[] {
  const paths: string[] = []

  // import x from './path' 或 import { x } from './path'
  const esmMatch = importLine.match(/from\s+['"]([^'"]+)['"]/)
  if (esmMatch) paths.push(esmMatch[1])

  // require('./path')
  const cjsMatch = importLine.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (cjsMatch) paths.push(cjsMatch[1])

  // import('./path')
  const dynamicMatch = importLine.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (dynamicMatch) paths.push(dynamicMatch[1])

  return paths
}

/**
 * 将 import 路径解析为项目内的文件路径
 * 处理: 相对路径、省略扩展名、index 文件
 */
function resolveImportToFilePath(
  importPath: string,
  fromFile: string,
  planFilePaths: Set<string>,
): string | null {
  // 只处理相对路径（项目内引用），跳过 node_modules 包名
  if (!importPath.startsWith('.')) return null

  const fromDir = dirname(fromFile)
  const resolved = join(fromDir, importPath).replace(/\\/g, '/')

  // 尝试精确匹配 + 常见扩展名 + index 文件
  const candidates = [
    resolved,
    `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`,
    `${resolved}/index.js`, `${resolved}/index.jsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`,
  ]

  for (const candidate of candidates) {
    if (planFilePaths.has(candidate)) return candidate
  }

  return null
}

/**
 * 构建 plan 文件间的依赖图（邻接表）
 * 依赖 = 文件 A import 了文件 B（B 必须先生成）
 */
function buildDependencyGraph(
  fileInterfaces: FileInterface[],
  planFilePaths: Set<string>,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const fi of fileInterfaces) {
    if (!graph.has(fi.path)) graph.set(fi.path, new Set())

    for (const importLine of fi.imports) {
      const importPaths = parseImportPaths(importLine)
      for (const importPath of importPaths) {
        const resolved = resolveImportToFilePath(importPath, fi.path, planFilePaths)
        if (resolved && resolved !== fi.path) {
          // fi.path 依赖 resolved（resolved 必须先生成）
          graph.get(fi.path)!.add(resolved)
        }
      }
    }
  }

  return graph
}

/**
 * 拓扑排序分批：Kahn 算法
 * 无依赖的文件在第 1 批，依赖第 1 批的在第 2 批，以此类推
 * 同一批内的文件无互相依赖，可以并行生成
 */
function topologicalBatches(
  plan: FilePlan[],
  graph: Map<string, Set<string>>,
): ChangeBatch[] {
  const allPaths = new Set(plan.map(f => f.path))

  // 构建反向图：dependency → Set<dependent>
  // 当 dependency 被处理时，dependent 的入度减 1
  const reverseGraph = new Map<string, Set<string>>()
  for (const path of allPaths) reverseGraph.set(path, new Set())
  for (const [file, deps] of graph) {
    for (const dep of deps) {
      if (!reverseGraph.has(dep)) reverseGraph.set(dep, new Set())
      reverseGraph.get(dep)!.add(file)
    }
  }

  // 计算每个文件的入度（有多少前置依赖需要先生成）
  const inDegree = new Map<string, number>()
  for (const path of allPaths) inDegree.set(path, 0)
  for (const [file, deps] of graph) {
    inDegree.set(file, deps.size)
  }

  const batches: ChangeBatch[] = []
  const assigned = new Set<string>()

  while (assigned.size < allPaths.size) {
    // 找出入度为 0 且未分配的文件（当前层）
    const currentLayer: string[] = []
    for (const path of allPaths) {
      if (!assigned.has(path) && (inDegree.get(path) ?? 0) === 0) {
        currentLayer.push(path)
      }
    }

    // 防止死循环：如果找不到入度为 0 的文件，说明有循环依赖，把剩余文件全部放入一批
    if (currentLayer.length === 0) {
      const remaining = [...allPaths].filter(p => !assigned.has(p))
      if (remaining.length > 0) {
        batches.push({ files: remaining, reason: '循环依赖，强制一批' })
      }
      break
    }

    batches.push({
      files: currentLayer,
      reason: currentLayer.length === 1
        ? '无依赖或依赖已满足'
        : `${currentLayer.length} 个文件无互相依赖，可并行生成`,
    })

    // 标记已分配，通过反向图精确递减依赖者的入度
    for (const path of currentLayer) {
      assigned.add(path)
    }
    for (const path of currentLayer) {
      const dependents = reverseGraph.get(path)
      if (dependents) {
        for (const dependent of dependents) {
          inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1)
        }
      }
    }
  }

  return batches
}

/**
 * 降级入口：基于依赖分析的纯代码分批
 * 零 LLM 消耗，确定性执行，不会失败
 * 当 LLM Architect 失败时作为 fallback 使用
 */
export async function buildBatches(
  sandboxPath: string,
  plan: FilePlan[],
): Promise<{ batches: ChangeBatch[]; fileInterfaces: FileInterface[] }> {
  // 提取文件接口
  const fileInterfaces = await extractFileInterfaces(sandboxPath, plan)

  // 构建 plan 文件路径集合
  const planFilePaths = new Set(plan.map(f => f.path))

  // 构建依赖图
  const graph = buildDependencyGraph(fileInterfaces, planFilePaths)

  // 拓扑排序分批
  const batches = topologicalBatches(plan, graph)

  // 如果只有一个文件，不需要分批
  if (plan.length <= 1) {
    return {
      batches: [{ files: plan.map(f => f.path), reason: '单文件，不需要分批' }],
      fileInterfaces,
    }
  }

  return { batches, fileInterfaces }
}
