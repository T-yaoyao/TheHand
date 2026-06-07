import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'path/posix'
import type { ProjectStructure, TheHandOrphanGuard } from '../types.js'
import { matchPathGlob } from './path-glob.js'

const SRC_EXT_ORDER = ['.tsx', '.ts', '.jsx', '.js', '.vue', '.mjs', '.cjs'] as const

/**
 * Vite/React 应用入口：由 HTML 拉取，通常不会被其它 JS `import`，不能按「是否被 import」判孤立。
 * 若 `project.json` 的 `thehand.orphanGuard.entrySkipGlobs` 有配置，则优先按 glob 匹配跳过。
 */
export function skipOrphanImportIntegrationCheck(planPath: string, guard?: TheHandOrphanGuard): boolean {
  const p = planPath.replace(/\\/g, '/')
  for (const g of guard?.entrySkipGlobs ?? []) {
    if (g && matchPathGlob(p, g)) return true
  }
  if (/(^|\/)main\.(jsx?|tsx?)$/i.test(p)) return true
  if (/(^|\/)bootstrap\.(jsx?|tsx?|js|ts)$/i.test(p)) return true
  return false
}

/** 归一化到「逻辑模块」键：index 桶文件、Foo/Foo.jsx 与目录名对齐 */
export function canonicalModuleKey(rel: string): string {
  let p = rel.replace(/\\/g, '/').replace(/\/+$/, '')
  const indexBarrel = /^(.+)\/index\.(jsx?|tsx?|js|ts|mjs|cjs)$/i.exec(p)
  if (indexBarrel) p = indexBarrel[1]
  const doubled = /^(.+)\/([^/]+)\/\2\.(jsx?|tsx?|vue)$/i.exec(p)
  if (doubled) p = doubled[1]
  p = p.replace(/\.(jsx?|tsx?|vue|mjs|cjs)$/i, '')
  return p
}

function firstKnownModuleForResolved(resolved: string, known: Set<string>): string | null {
  const r = posixNormalize(resolved).replace(/\\/g, '/')
  const trials = [r]
  for (const ext of SRC_EXT_ORDER) trials.push(r + ext)
  for (const t of trials) {
    if (known.has(t)) return t
  }
  for (const ext of SRC_EXT_ORDER) {
    const idx = `${r}/index${ext}`
    if (known.has(idx)) return idx
  }
  return null
}

function resolveSpecifierToModule(fromFilePosix: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const fromDir = posixDirname(fromFilePosix.replace(/\\/g, '/'))
  const joined = posixNormalize(posixJoin(fromDir, spec)).replace(/\\/g, '/')
  return firstKnownModuleForResolved(joined, known)
}

/**
 * 相对 import 是否在已知源码路径（沙箱索引 + 本轮 fileMap 键）中可解析；
 * 若否，再检查沙箱磁盘上是否存在该相对路径对应的文件（如 .css/.json 等未编入索引的扩展名）。
 */
export async function relativeSpecifierResolvesInSandbox(
  sandboxPath: string,
  fromFilePosix: string,
  specifier: string,
  knownSourcePaths: Set<string>,
): Promise<boolean> {
  if (!specifier.startsWith('.')) return true
  const from = fromFilePosix.replace(/\\/g, '/')
  if (resolveSpecifierToModule(from, specifier, knownSourcePaths) !== null) return true
  const fromDir = posixDirname(from)
  const joined = posixNormalize(posixJoin(fromDir, specifier)).replace(/\\/g, '/')
  try {
    await stat(join(sandboxPath, joined))
    return true
  } catch {
    return false
  }
}

/** 从源码行中提取相对 import / require / import() / re-export from 的路径 */
export function extractRelativeImportSpecifiers(content: string): string[] {
  const out: string[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const isImport = /^import\s/.test(line)
    const isRequire = /require\s*\(\s*['"]\./.test(line)
    const isDynImport = /import\s*\(\s*['"]\./.test(line)
    // 桶文件：export { default } from './Foo' / export * from './Foo'（此前漏检会导致 ArticlesPreview.jsx 误判孤儿）
    const isReexport = /^\s*export\s+/.test(line) && /\bfrom\s+['"]\./.test(line)
    if (!isImport && !isRequire && !isDynImport && !isReexport) continue
    const re = /['"](\.[^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out.push(m[1])
    }
  }
  return out
}

/**
 * 判断 fromPlanPath 对应源码是否通过**相对路径** import 到了 targetPlanPath 所代表的模块。
 */
export function sourceFileImportsTargetModule(
  content: string,
  fromPlanPath: string,
  targetPlanPath: string,
  knownFiles: Set<string>,
): boolean {
  const from = fromPlanPath.replace(/\\/g, '/')
  const targetCanon = canonicalModuleKey(targetPlanPath.replace(/\\/g, '/'))
  for (const spec of extractRelativeImportSpecifiers(content)) {
    const hit = resolveSpecifierToModule(from, spec, knownFiles)
    if (hit && canonicalModuleKey(hit) === targetCanon) return true
  }
  return false
}

/**
 * 在已加载的沙箱源码索引中，是否存在除「自身文件」外的其它文件通过相对 import 解析到该组件。
 */
export function sandboxIndexImportsComponent(
  index: Map<string, string>,
  componentPlanPath: string,
  _baseName: string,
): boolean {
  const norm = componentPlanPath.replace(/\\/g, '/')
  const known = new Set(index.keys())
  for (const [rel, content] of index) {
    // 只跳过「自身」路径；勿用 canonical 比较——否则同目录 index.js 与 Foo/Foo.jsx 同 canon，
    // 会把真正的 re-export 入口也跳过，误判孤儿（如 ArticlesPreview/index → ArticlesPreview.jsx）
    if (rel === norm) continue
    if (sourceFileImportsTargetModule(content, rel, norm, known)) return true
  }
  return false
}

async function collectSourceFilesRecursive(dir: string, acc: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === 'coverage') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      await collectSourceFilesRecursive(p, acc)
    } else if (/\.(jsx?|tsx?|vue|mjs|cjs)$/.test(e.name)) {
      acc.push(p)
    }
  }
}

function candidateSourceRoots(sandboxPath: string, structure?: ProjectStructure): string[] {
  const roots: string[] = []
  const pushIf = (rel: string | undefined) => {
    if (!rel) return
    const trimmed = rel.replace(/\/+$/, '')
    if (!trimmed) return
    roots.push(join(sandboxPath, trimmed))
  }
  if (structure) {
    pushIf(structure.frontend)
    pushIf(structure.backend)
  }
  roots.push(join(sandboxPath, 'frontend', 'src'))
  roots.push(join(sandboxPath, 'src'))
  return [...new Set(roots)]
}

/**
 * 一次性读入沙箱内候选源码（相对 sandbox 根的路径 → 内容），供多个组件复用，避免重复遍历。
 */
export async function loadSandboxSourceContents(
  sandboxPath: string,
  structure?: ProjectStructure,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const paths: string[] = []

  for (const root of candidateSourceRoots(sandboxPath, structure)) {
    try {
      await stat(root)
    } catch {
      continue
    }
    await collectSourceFilesRecursive(root, paths)
  }

  for (const abs of paths) {
    const rel = relative(sandboxPath, abs).split(sep).join('/')
    try {
      out.set(rel, await readFile(abs, 'utf-8'))
    } catch {
      /* skip */
    }
  }

  return out
}
