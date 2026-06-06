import { readFile, stat } from 'fs/promises'
import { join, resolve, extname } from 'path'
import type {
  FilePlan,
  ProjectContext,
  FileSkeleton,
  FileInterface,
  ChangeManifest,
} from '../types.js'
import type { LLMClient, Message } from '../llm/llm-client.js'
import type { PromptManager } from '../llm/prompt-manager.js'

// ============================================================
// Layer 1: 文件结构骨架（纯代码，零 LLM 消耗）
// ============================================================

const FILE_TYPE_MAP: Record<string, FileSkeleton['fileType']> = {
  '.js': 'other', '.ts': 'other', '.jsx': 'component', '.tsx': 'component',
  '.vue': 'component', '.css': 'style', '.scss': 'style', '.less': 'style',
  '.json': 'config', '.yaml': 'config', '.yml': 'config',
  '.md': 'other', '.test.js': 'test', '.test.ts': 'test',
  '.spec.js': 'test', '.spec.ts': 'test',
}

function classifyFileType(filePath: string): FileSkeleton['fileType'] {
  const lower = filePath.toLowerCase()
  if (lower.includes('/models/') || lower.includes('\\models\\')) return 'model'
  if (lower.includes('/routes/') || lower.includes('\\routes\\')) return 'route'
  if (lower.includes('/components/') || lower.includes('\\components\\')) return 'component'
  if (lower.includes('/pages/') || lower.includes('\\pages\\')) return 'component'
  if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('/__tests__/')) return 'test'
  if (lower.includes('.css') || lower.includes('.scss') || lower.includes('.less')) return 'style'
  const ext = extname(lower)
  return FILE_TYPE_MAP[ext] ?? 'other'
}

/**
 * Layer 1: 提取文件结构骨架
 * 只用 fs.stat + 文件路径分类，不读文件内容，零 LLM 消耗
 */
export async function extractFileSkeletons(
  sandboxPath: string,
  plan: FilePlan[],
): Promise<FileSkeleton[]> {
  const skeletons: FileSkeleton[] = []

  for (const file of plan) {
    const fullPath = resolve(sandboxPath, file.path)
    if (!fullPath.startsWith(resolve(sandboxPath))) continue

    let lineCount = 0
    let sizeBytes = 0
    try {
      const fileStat = await stat(fullPath)
      sizeBytes = fileStat.size
      // 粗略估算行数：用文件大小 / 平均行宽 50 字节
      lineCount = Math.ceil(sizeBytes / 50)
    } catch {
      // 新文件，不存在
    }

    skeletons.push({
      path: file.path,
      fileType: classifyFileType(file.path),
      lineCount,
      sizeBytes,
      language: extname(file.path) || 'unknown',
    })
  }

  return skeletons
}

// ============================================================
// Layer 2: 文件接口提取（正则，零 LLM 消耗）
// ============================================================

/**
 * Layer 2: 用正则提取文件的接口信息
 * 只读 exports/imports/函数签名等骨架行，不关注实现细节
 */
export async function extractFileInterfaces(
  sandboxPath: string,
  plan: FilePlan[],
): Promise<FileInterface[]> {
  const interfaces: FileInterface[] = []

  for (const file of plan) {
    const fullPath = resolve(sandboxPath, file.path)
    if (!fullPath.startsWith(resolve(sandboxPath))) continue

    let content = ''
    try {
      content = await readFile(fullPath, 'utf-8')
    } catch {
      // 新文件，没有接口可提取
      interfaces.push({
        path: file.path,
        exports: [],
        imports: [],
        functionSignatures: [],
        routeDefinitions: [],
        modelFields: [],
      })
      continue
    }

    interfaces.push(extractInterfaceFromContent(file.path, content))
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

    // import 语句
    if (/^import\s/.test(trimmed)) {
      imports.push(trimmed)
      continue
    }

    // export 语句
    if (/^export\s/.test(trimmed)) {
      exports.push(trimmed)
      continue
    }

    // 函数/class 定义
    if (/^(export\s+)?(function|class)\s+\w+/.test(trimmed) ||
        /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)) {
      functionSignatures.push(trimmed)
      continue
    }

    // 路由定义
    if (/^router\.(get|post|put|delete|patch|use)\s*\(/.test(trimmed)) {
      routeDefinitions.push(trimmed)
      continue
    }

    // Sequelize 模型字段
    if (/^\w+:\s*\{/.test(trimmed) && /type:\s*DataTypes\.\w+/.test(trimmed)) {
      modelFields.push(trimmed)
      continue
    }
  }

  return { path: filePath, exports, imports, functionSignatures, routeDefinitions, modelFields }
}

// ============================================================
// Layer 3: Architect Agent（LLM 调用，输入已压缩）
// ============================================================

/**
 * Architect Agent: 分析文件骨架和接口，输出结构化变更清单
 * 输入是压缩后的骨架+接口（~10-15K tokens），不是文件全文
 */
export async function runArchitect(
  llmClient: LLMClient,
  promptManager: PromptManager,
  plan: FilePlan[],
  skeletons: FileSkeleton[],
  fileInterfaces: FileInterface[],
  projectContext?: ProjectContext,
): Promise<ChangeManifest> {
  const systemPrompt = await promptManager.load('architect')

  // 组装骨架摘要
  const skeletonSummary = skeletons.map(s =>
    `- ${s.path} [${s.fileType}] ${s.lineCount}行 ${Math.round(s.sizeBytes / 1024)}KB`
  ).join('\n')

  // 组装接口摘要
  const interfaceSummary = fileInterfaces.map(f => {
    const parts = [`### ${f.path}`]
    if (f.exports.length > 0) parts.push(`exports: ${f.exports.slice(0, 10).join(', ')}`)
    if (f.imports.length > 0) parts.push(`imports: ${f.imports.slice(0, 5).join(', ')}`)
    if (f.functionSignatures.length > 0) parts.push(`functions: ${f.functionSignatures.slice(0, 5).join(', ')}`)
    if (f.routeDefinitions.length > 0) parts.push(`routes: ${f.routeDefinitions.slice(0, 5).join(', ')}`)
    if (f.modelFields.length > 0) parts.push(`fields: ${f.modelFields.slice(0, 10).join(', ')}`)
    return parts.join('\n')
  }).join('\n\n')

  // 组装项目上下文（只传关键信息，不传全文）
  let contextHint = ''
  if (projectContext?.models) {
    contextHint += `\n\n项目模型定义：\n${JSON.stringify(projectContext.models, null, 2)}`
  }
  if (projectContext?.routes) {
    contextHint += `\n\n项目路由表：\n${JSON.stringify(projectContext.routes, null, 2)}`
  }
  if (projectContext?.constraints) {
    const entries = Object.entries(projectContext.constraints)
    if (entries.length > 0) {
      contextHint += `\n\n项目约束：\n${entries.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    }
  }

  const userMessage = `## 技术方案
${plan.map(f => `- ${f.path}: ${f.changeDescription} (priority: ${f.priority})`).join('\n')}

## 文件骨架
${skeletonSummary}

## 文件接口信息
${interfaceSummary}
${contextHint}

请分析依赖关系，输出 ChangeManifest JSON。`

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const response = await llmClient.chat(messages, { agent: 'architect' })

  return parseArchitectResponse(response.content, plan)
}

/**
 * 解析 Architect Agent 的输出
 */
function parseArchitectResponse(response: string, plan: FilePlan[]): ChangeManifest {
  let json: any = null

  // 尝试直接解析
  try {
    json = JSON.parse(response)
  } catch {
    // 从代码块中提取
    const match = response.match(/```(?:json)?\n([\s\S]*?)```/)
    if (match) {
      try {
        json = JSON.parse(match[1])
      } catch {}
    }
  }

  // 从花括号提取
  if (!json) {
    const braceMatch = response.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        json = JSON.parse(braceMatch[0])
      } catch {}
    }
  }

  // 校验必要字段
  if (json && json.globalContext && Array.isArray(json.files) && Array.isArray(json.batches)) {
    return json as ChangeManifest
  }

  // 降级：基于 plan 生成一个简单的 ChangeManifest
  console.warn('[architect] 解析失败，使用降级策略')
  return buildFallbackManifest(plan)
}

/**
 * 降级策略：当 Architect 输出无法解析时，基于 FilePlan 生成基础 manifest
 */
function buildFallbackManifest(plan: FilePlan[]): ChangeManifest {
  return {
    globalContext: `共需修改 ${plan.length} 个文件`,
    files: plan.map((f, i) => ({
      path: f.path,
      action: 'modify' as const,
      detailedChange: f.changeDescription,
      dependencies: [],
      exports: [],
      priority: f.priority ?? i + 1,
    })),
    crossFileRefs: [],
    batches: [{
      files: plan.map(f => f.path),
      reason: '降级策略：不分批，一次性生成',
    }],
  }
}
