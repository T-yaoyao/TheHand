/**
 * L1 上下文召回：import 图 + 入口前向 BFS +（方案外）邻接文件全文
 * 不依赖向量 / LSP；适用于任意含前端 JS/TS 的沙箱布局。
 */
import { readFile, readdir, stat } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import type { ProjectContext, ProjectStructure } from '../types.js'

const SRC_EXT = /\.(jsx?|tsx|vue|mjs|cjs)$/

/** 最多附加多少个「方案外」文件全文，防止撑爆上下文 */
const MAX_L1_EXTRA_FILES = 20
/** 单文件最大字符数（超出截断） */
const MAX_CHARS_PER_FILE = 100_000

const DEFAULT_ENTRY_CANDIDATES = [
  'frontend/src/main.jsx',
  'frontend/src/main.tsx',
  'frontend/src/App.jsx',
  'frontend/src/App.tsx',
  'frontend/src/index.jsx',
  'frontend/src/index.tsx',
]

function structureRoots(sandboxPath: string, structure?: ProjectStructure): string[] {
  const abs: string[] = []
  const push = (rel?: string) => {
    if (!rel) return
    const t = rel.replace(/\/+$/, '')
    if (!t) return
    abs.push(resolve(sandboxPath, t))
  }
  if (structure) {
    push(structure.frontend)
    push(structure.backend)
  }
  push('frontend/src')
  push('src')
  return [...new Set(abs.map(p => resolve(p)))]
}

async function walkSourceRelFiles(
  sandboxPath: string,
  absRoot: string,
  baseRel: string,
  acc: string[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(absRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue
    const abs = join(absRoot, e.name)
    const rel = baseRel ? `${baseRel}/${e.name}` : e.name
    const norm = rel.split(sep).join('/')
    if (e.isDirectory()) {
      await walkSourceRelFiles(sandboxPath, abs, norm, acc)
    } else if (SRC_EXT.test(e.name)) {
      acc.push(norm)
    }
  }
}

/** 列出沙箱内待建图的全部源码相对路径（去重） */
export async function listSandboxSourceRelPaths(
  sandboxPath: string,
  structure?: ProjectStructure,
): Promise<string[]> {
  const roots = structureRoots(sandboxPath, structure)
  const seenRoot = new Set<string>()
  const acc: string[] = []
  for (const absRoot of roots) {
    const key = absRoot
    if (seenRoot.has(key)) continue
    seenRoot.add(key)
    try {
      await stat(absRoot)
    } catch {
      continue
    }
    const baseRel = relative(sandboxPath, absRoot).split(sep).join('/')
    await walkSourceRelFiles(sandboxPath, absRoot, baseRel, acc)
  }
  return [...new Set(acc)]
}

function parseRelativeImportPaths(importLine: string): string[] {
  const paths: string[] = []
  const esm = importLine.match(/from\s+['"]([^'"]+)['"]/)
  if (esm) paths.push(esm[1])
  const cjs = importLine.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (cjs) paths.push(cjs[1])
  const dyn = importLine.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (dyn) paths.push(dyn[1])
  return paths.filter(p => p.startsWith('.'))
}

function resolveImportToKnown(
  importPath: string,
  fromRel: string,
  known: Set<string>,
): string | null {
  const fromDir = dirname(fromRel)
  const resolved = join(fromDir, importPath).replace(/\\/g, '/')
  const candidates = [
    resolved,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
  ]
  for (const c of candidates) {
    if (known.has(c)) return c
  }
  return null
}

/** forward[A] = A 直接 import 的已知文件集合 */
async function buildForwardImportMap(
  sandboxPath: string,
  known: Set<string>,
): Promise<Map<string, Set<string>>> {
  const g = new Map<string, Set<string>>()
  for (const rel of known) {
    g.set(rel, new Set())
    let content: string
    try {
      content = await readFile(join(sandboxPath, rel), 'utf-8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!/^import\s/.test(t) && !/require\s*\(\s*['"]\./.test(t) && !/import\s*\(\s*['"]\./.test(t)) continue
      for (const imp of parseRelativeImportPaths(t)) {
        const to = resolveImportToKnown(imp, rel, known)
        if (to && to !== rel) g.get(rel)!.add(to)
      }
    }
  }
  return g
}

function buildReverseImportMap(forward: Map<string, Set<string>>): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>()
  for (const [from, tos] of forward) {
    for (const to of tos) {
      if (!rev.has(to)) rev.set(to, new Set())
      rev.get(to)!.add(from)
    }
  }
  return rev
}

/** 从 seeds 沿 reverse 走最多 depth 层（不含 seeds 自身），收集「谁 import 了链上的文件」 */
function collectBackward(
  seeds: string[],
  reverse: Map<string, Set<string>>,
  depth: number,
  known: Set<string>,
): Set<string> {
  const out = new Set<string>()
  let frontier = new Set(seeds.filter(s => known.has(s)))
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>()
    for (const n of frontier) {
      for (const p of reverse.get(n) ?? []) {
        if (!known.has(p)) continue
        if (seeds.includes(p)) continue
        if (!out.has(p)) {
          out.add(p)
          next.add(p)
        }
      }
    }
    frontier = next
    if (frontier.size === 0) break
  }
  return out
}

/** 从 seeds 沿 forward 走最多 depth 层，收集依赖文件 */
function collectForward(
  seeds: string[],
  forward: Map<string, Set<string>>,
  depth: number,
  known: Set<string>,
): Set<string> {
  const out = new Set<string>()
  let frontier = new Set(seeds.filter(s => known.has(s)))
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>()
    for (const n of frontier) {
      for (const p of forward.get(n) ?? []) {
        if (!known.has(p)) continue
        if (seeds.includes(p)) continue
        if (!out.has(p)) {
          out.add(p)
          next.add(p)
        }
      }
    }
    frontier = next
    if (frontier.size === 0) break
  }
  return out
}

/** 从入口文件沿 forward 做 BFS，限制深度与节点数 */
function collectEntryCone(
  entries: string[],
  forward: Map<string, Set<string>>,
  known: Set<string>,
  maxDepth: number,
  maxNodes: number,
): Set<string> {
  const out = new Set<string>()
  type Q = { n: string; d: number }
  const q: Q[] = []
  for (const e of entries) {
    if (known.has(e)) q.push({ n: e, d: 0 })
  }
  const seen = new Set<string>()
  while (q.length > 0 && out.size < maxNodes) {
    const { n, d } = q.shift()!
    if (seen.has(n)) continue
    seen.add(n)
    if (d > 0) out.add(n)
    if (d >= maxDepth) continue
    for (const p of forward.get(n) ?? []) {
      if (!known.has(p)) continue
      if (!seen.has(p)) q.push({ n: p, d: d + 1 })
    }
  }
  return out
}

function resolveShallowRoutesDir(sandboxPath: string, structure: ProjectStructure | undefined, projectContext?: ProjectContext): string {
  const custom = projectContext?.thehand?.recallL1?.shallowRoutesDir?.replace(/\/+$/, '')
  if (custom) return join(sandboxPath, custom)
  const fe = structure?.frontend?.replace(/\/+$/, '') || 'frontend/src'
  return join(sandboxPath, fe, 'routes')
}

async function discoverEntryFiles(
  sandboxPath: string,
  known: Set<string>,
  projectContext?: ProjectContext,
  structure?: ProjectStructure,
): Promise<string[]> {
  const candidates = projectContext?.thehand?.recallL1?.entryCandidates?.length
    ? projectContext.thehand.recallL1.entryCandidates!
    : DEFAULT_ENTRY_CANDIDATES
  const found: string[] = []
  for (const p of candidates) {
    if (known.has(p)) found.push(p)
  }
  const routesDir = resolveShallowRoutesDir(sandboxPath, structure, projectContext)
  try {
    const ents = await readdir(routesDir, { withFileTypes: true })
    for (const e of ents) {
      if (!e.isFile() || !SRC_EXT.test(e.name)) continue
      const relBase = routesDir.slice(sandboxPath.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
      const rel = `${relBase}/${e.name}`
      if (known.has(rel)) found.push(rel)
    }
  } catch {
    /* 无 routes 目录 */
  }
  return [...new Set(found)]
}

/**
 * 生成注入到编码 prompt 的 L1 段落（Markdown）。
 * @param seedPaths 方案中的相对路径；分批编码时传本 batch 文件即可。
 */
export async function formatL1RecallSection(
  sandboxPath: string,
  projectContext: ProjectContext | undefined,
  seedPaths: string[],
): Promise<string> {
  const seeds = [...new Set(seedPaths.map(p => p.replace(/\\/g, '/')))].filter(Boolean)
  if (seeds.length === 0) return ''

  const structure = projectContext?.structure
  const knownList = await listSandboxSourceRelPaths(sandboxPath, structure)
  const known = new Set(knownList)
  if (known.size === 0) return ''

  const forward = await buildForwardImportMap(sandboxPath, known)
  const reverse = buildReverseImportMap(forward)

  const back = collectBackward(seeds, reverse, 2, known)
  const fwd = collectForward(seeds, forward, 1, known)

  const entries = await discoverEntryFiles(sandboxPath, known, projectContext, structure)
  const entryCone = collectEntryCone(entries, forward, known, 6, 48)

  const planSet = new Set(seeds)
  const merged = new Set<string>()
  for (const x of back) merged.add(x)
  for (const x of fwd) merged.add(x)
  for (const x of entryCone) merged.add(x)

  const extra = [...merged].filter(p => !planSet.has(p)).sort()
  if (extra.length === 0) {
    console.log('[recall-l1] 无额外邻接/入口文件（仅方案内）')
    return ''
  }

  const take = extra.slice(0, MAX_L1_EXTRA_FILES)
  console.log(`[recall-l1] seeds=${seeds.length} extra=${extra.length} attach=${take.length} (import 图 + 入口 BFS)`)

  const blocks: string[] = []
  blocks.push('## L1 关联上下文（import 图 + 入口 BFS）')
  blocks.push('以下文件**未列入本段方案文件列表**，但与方案文件在 import 上相邻，或位于入口可达子图内，供对照接口与挂载关系；**除非方案要求，否则不要改这些文件**。')
  for (const p of take) {
    let raw: string
    try {
      raw = await readFile(join(sandboxPath, p), 'utf-8')
    } catch {
      continue
    }
    const truncated = raw.length > MAX_CHARS_PER_FILE
      ? `${raw.slice(0, MAX_CHARS_PER_FILE)}\n\n…(已截断，共 ${raw.length} 字符)`
      : raw
    blocks.push(`### ${p}\n\`\`\`\n${truncated}\n\`\`\``)
  }

  return '\n\n' + blocks.join('\n\n')
}
