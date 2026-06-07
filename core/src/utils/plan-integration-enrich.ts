import { existsSync } from 'fs'
import { resolve } from 'path'
import type { FilePlan, ProjectContext } from '../types.js'
import { pickApplicationEntryForRouteTable } from './route-wiring-entry.js'

/**
 * 在方案阶段按需并入：应用路由入口（如 main.jsx）、以及 project.json 中已配置的 readContextCandidates（磁盘存在者）。
 * 仅当方案 Agent 显式声明 includeRouteEntryContext === true 时执行，避免「routes 下任意改动」误拉入口文件。
 */
export function enrichPlanWithIntegrationEntryFiles(
  plan: FilePlan[],
  sandboxPath: string,
  projectContext: ProjectContext,
  includeRouteEntryContext: boolean,
): FilePlan[] {
  if (plan.length === 0) return plan

  const norm = (p: string) => p.replace(/\\/g, '/')
  const byPath = new Map<string, FilePlan>()
  let maxPri = 0
  for (const f of plan) {
    const k = norm(f.path)
    byPath.set(k, { ...f, path: k })
    if (f.priority > maxPri) maxPri = f.priority
  }

  if (!includeRouteEntryContext) {
    return [...byPath.values()].sort((a, b) => a.priority - b.priority)
  }

  const addIfMissing = (rel: string, changeDescription: string, priority: number) => {
    const k = norm(rel)
    if (!k || byPath.has(k)) return
    if (!existsSync(resolve(sandboxPath, k))) return
    byPath.set(k, { path: k, changeDescription, priority })
    console.log(`[plan-enrich] 并入方案: ${k}`)
  }

  const entry = pickApplicationEntryForRouteTable(sandboxPath, projectContext)
  if (entry) {
    addIfMissing(
      entry,
      '【TheHand 自动补充】与子路由/Tab/新页面相关：须在本文件注册或调整嵌套 <Route>（path 与布局内 NavItem/NavLink 一致），并保持根路由约定；相对 import 须与仓库实际路径一致（勿臆造如 ./components/App）。',
      maxPri + 5,
    )
  }

  let extraPri = maxPri + 10
  let readContextAdded = 0
  for (const c of projectContext.thehand?.readContextCandidates ?? []) {
    if (readContextAdded >= 3) break
    const k = norm(c)
    if (!k || byPath.has(k)) continue
    if (!existsSync(resolve(sandboxPath, k))) continue
    byPath.set(k, {
      path: k,
      changeDescription:
        '【TheHand 自动补充】项目配置的关键路由/上下文文件；若本次改动涉及路由表或根挂载，请读取并与现有结构对齐。',
      priority: extraPri++,
    })
    readContextAdded++
    console.log(`[plan-enrich] 并入 readContextCandidates: ${k}`)
  }

  return [...byPath.values()].sort((a, b) => a.priority - b.priority)
}
