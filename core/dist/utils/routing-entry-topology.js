/**
 * 从「应用入口」源码推断路由挂载拓扑，与仓库形态无关：
 * 若入口已内联声明 <Routes> 且未相对 import 名为 router 的模块，则方案中「尚不存在磁盘」的独立 router.* 文件
 * 视为与当前拓扑不兼容（多为模型臆造），在方案阶段剔除并把约束合并回入口项。
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { isRouteTableModulePath, pickApplicationEntryForRouteTable } from './route-wiring-entry.js';
/** 入口文件是否直接写了 React Router 的路由树（常见内联形态） */
export function entryFileDeclaresRoutesJsx(entrySource) {
    return /<\s*Routes\b/.test(entrySource) || /<\s*RouterProvider\b/.test(entrySource);
}
/**
 * 入口是否已从相对路径 import 名为 router 的兄弟模块（表示拆出路由表文件为项目既有约定）
 */
export function entryImportsRelativeRouterModule(entrySource) {
    const sideEffect = /\bimport\s+['"]\.\/router(?:\.(?:jsx?|tsx?|js|ts))?['"]/i.test(entrySource) ||
        /\bimport\s+['"]\.\.\/router(?:\.(?:jsx?|tsx?|js|ts))?['"]/i.test(entrySource);
    const namedOrDefault = /\bfrom\s+['"]\.\/router(?:\.(?:jsx?|tsx?|js|ts))?['"]/i.test(entrySource) ||
        /\bfrom\s+['"]\.\.\/router(?:\.(?:jsx?|tsx?|js|ts))?['"]/i.test(entrySource);
    return sideEffect || namedOrDefault;
}
function readEntrySource(sandboxPath, entryRel) {
    if (!entryRel)
        return null;
    const abs = resolve(sandboxPath, entryRel.replace(/\\/g, '/'));
    if (!existsSync(abs))
        return null;
    try {
        return readFileSync(abs, 'utf-8');
    }
    catch {
        return null;
    }
}
/**
 * 计划中的路径是否为「与当前入口拓扑冲突的、不存在的路由表文件」。
 */
export function isPhantomRouteTableVersusEntryTopology(planRelPath, sandboxPath, entryRel, entrySource) {
    const p = planRelPath.replace(/\\/g, '/');
    if (!isRouteTableModulePath(p))
        return false;
    if (existsSync(resolve(sandboxPath, p)))
        return false;
    if (!entryRel || !entrySource)
        return false;
    if (!entryFileDeclaresRoutesJsx(entrySource))
        return false;
    if (entryImportsRelativeRouterModule(entrySource))
        return false;
    return true;
}
/**
 * 从方案中移除与入口拓扑冲突的「新建 router.*」项，并把说明合并到路由入口 plan 条目。
 */
export function sanitizePhantomRouteTablesAgainstEntryTopology(plan, sandboxPath, projectContext) {
    const entry = pickApplicationEntryForRouteTable(sandboxPath, projectContext);
    const entrySource = readEntrySource(sandboxPath, entry);
    if (!entry || !entrySource)
        return plan;
    const norm = (p) => p.replace(/\\/g, '/');
    const removed = [];
    const kept = [];
    for (const f of plan) {
        const k = norm(f.path);
        if (isPhantomRouteTableVersusEntryTopology(k, sandboxPath, entry, entrySource)) {
            removed.push(k);
            continue;
        }
        kept.push({ ...f, path: k });
    }
    if (removed.length === 0)
        return plan;
    const entryKey = norm(entry);
    const note = `\n\n【TheHand 路由拓扑】应用入口 ${entryKey} 已内联声明路由树且未相对 import「./router」类模块；` +
        `磁盘上尚不存在 ${removed.join(' / ')}。禁止新建上述独立路由表文件；请在入口现有 JSX 路由树内增加/调整 <Route>，与子布局 Tab/Outlet 的 path 一致。`;
    const idx = kept.findIndex(f => norm(f.path) === entryKey);
    if (idx >= 0) {
        kept[idx] = { ...kept[idx], changeDescription: kept[idx].changeDescription + note };
    }
    else {
        kept.push({
            path: entryKey,
            changeDescription: note.trim(),
            priority: 990_000,
        });
    }
    console.log(`[routing-topology] 已按入口拓扑移除不存在的 route-table 项: ${removed.join(', ')} → 合并说明到 ${entryKey}`);
    return kept.sort((a, b) => a.priority - b.priority);
}
//# sourceMappingURL=routing-entry-topology.js.map