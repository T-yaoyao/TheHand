import { readFile } from 'fs/promises'
import { resolve, dirname, join } from 'path'
import type { FilePlan, FileInterface, ChangeBatch } from '../types.js'

// ============================================================
// 文件接口提取（正则，零 LLM 消耗）
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
// 纯代码依赖分析 + 拓扑分批（零 LLM 消耗）
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
 * 主入口：基于依赖分析的纯代码分批
 * 零 LLM 消耗，确定性执行，不会失败
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
