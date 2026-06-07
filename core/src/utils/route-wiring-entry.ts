import { existsSync } from 'fs'
import { resolve } from 'path'
import type { ProjectContext } from '../types.js'

/** 顶层路由表文件：应由 main/App/index 等入口 import，而非 routes 下的页面互相 import */
const ROUTE_TABLE_RE = /(^|\/)router\.(jsx?|tsx?|js|ts)$/i

export function isRouteTableModulePath(relPath: string): boolean {
  return ROUTE_TABLE_RE.test(relPath.replace(/\\/g, '/'))
}

function isEntryFileName(rel: string): boolean {
  const base = rel.split('/').pop() ?? ''
  return /^(main|index|App)\.(jsx?|tsx?|js|ts)$/i.test(base)
}

/**
 * 解析「应挂载 router.jsx 路由表」的应用入口路径（磁盘上须存在）。
 * 优先 project.json 的 routingIntegration.routeEntryFiles、recallL1.entryCandidates，再常见默认路径。
 */
export function pickApplicationEntryForRouteTable(
  sandboxPath: string,
  projectContext: ProjectContext | undefined,
): string | null {
  const ordered: string[] = []
  const th = projectContext?.thehand

  for (const p of th?.routingIntegration?.routeEntryFiles ?? []) {
    const rel = p.replace(/\\/g, '/')
    if (rel && !isRouteTableModulePath(rel)) ordered.push(rel)
  }
  for (const p of th?.recallL1?.entryCandidates ?? []) {
    const rel = p.replace(/\\/g, '/')
    if (rel && !isRouteTableModulePath(rel) && isEntryFileName(rel)) ordered.push(rel)
  }

  const seen = new Set<string>()
  for (const rel of ordered) {
    if (seen.has(rel)) continue
    seen.add(rel)
    if (!isEntryFileName(rel)) continue
    if (existsSync(resolve(sandboxPath, rel))) return rel
  }

  for (const p of [
    'frontend/src/main.jsx',
    'frontend/src/main.tsx',
    'frontend/src/index.jsx',
    'frontend/src/index.tsx',
    'src/main.jsx',
    'src/main.tsx',
  ]) {
    if (existsSync(resolve(sandboxPath, p))) return p
  }
  return null
}

const ROUTE_INJECT_MAX = 6

/**
 * 磁盘上存在的、可能参与路由声明或须与 Tab/Outlet 对齐的上下文文件（与 outlet-nav 合并路由源、plan-enrich 的入口维度对齐）。
 * 用于 outlet-nav / 类似静态 guard 重试时一并并入 plan，避免只注入 main 而遗漏实际写 Route 的 App.jsx。
 */
export function collectRouteIntegrationContextPaths(
  sandboxPath: string,
  projectContext: ProjectContext | undefined,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const th = projectContext?.thehand

  const push = (rel: string | undefined) => {
    if (out.length >= ROUTE_INJECT_MAX) return
    if (!rel) return
    const n = rel.replace(/\\/g, '/')
    if (!n || seen.has(n)) return
    if (isRouteTableModulePath(n)) return
    if (!existsSync(resolve(sandboxPath, n))) return
    seen.add(n)
    out.push(n)
  }

  for (const p of th?.routingIntegration?.routeEntryFiles ?? []) push(p)

  const primary = pickApplicationEntryForRouteTable(sandboxPath, projectContext)
  if (primary) push(primary)

  for (const p of th?.recallL1?.entryCandidates ?? []) {
    const rel = p.replace(/\\/g, '/')
    if (isEntryFileName(rel)) push(rel)
  }

  let rc = 0
  for (const c of th?.readContextCandidates ?? []) {
    if (rc >= 3 || out.length >= ROUTE_INJECT_MAX) break
    const before = out.length
    push(c)
    if (out.length > before) rc++
  }

  for (const p of [
    'frontend/src/App.jsx',
    'frontend/src/App.tsx',
    'frontend/src/main.jsx',
    'frontend/src/main.tsx',
  ]) {
    push(p)
  }

  return out
}
