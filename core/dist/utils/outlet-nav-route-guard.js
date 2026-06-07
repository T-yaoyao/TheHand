/**
 * 检测「带 Outlet 的布局里用相对路径 Tab/Nav，但路由表未注册嵌套 path」导致的运行时 404。
 * 纯静态规则，不依赖 LLM 提示词；与 Conduit 等 HashRouter + 顶层 <Routes> 结构兼容。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { isRouteTableModulePath, pickApplicationEntryForRouteTable } from './route-wiring-entry.js';
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** 从单文件 JSX 中提取「相对路径」导航段（不含 index 空串、不含绝对路径） */
export function extractOutletRelativeNavSegments(content) {
    if (!/<Outlet\b/.test(content))
        return [];
    const found = new Set();
    const collectFromTags = (tagRe, prop) => {
        tagRe.lastIndex = 0;
        let m;
        while ((m = tagRe.exec(content)) !== null) {
            const tag = m[0].replace(/\s+/g, ' ');
            const propRe = prop === 'url' ? /\burl=["']([a-zA-Z0-9_-]*)["']/ : /\bto=["']([a-zA-Z0-9_-]*)["']/;
            const pm = propRe.exec(tag);
            if (!pm)
                continue;
            const raw = pm[1].trim();
            if (raw === '')
                continue;
            if (raw.startsWith('/'))
                continue;
            if (raw.includes('://') || raw.includes('/'))
                continue;
            if (!/^[a-zA-Z0-9_-]+$/.test(raw))
                continue;
            found.add(raw);
        }
    };
    // Conduit：NavItem url="about-me"
    collectFromTags(/<NavItem\b[\s\S]*?(?:\/>|>)/gi, 'url');
    // 通用：布局内 NavLink to="tab-id"
    collectFromTags(/<NavLink\b[\s\S]*?(?:\/>|>)/gi, 'to');
    return [...found];
}
/** 路由表源码中是否声明了该嵌套 path（与 React Router v6 常见写法匹配） */
export function routeTableDeclaresSegment(routeSources, segment) {
    if (!segment)
        return true;
    const e = escapeRegExp(segment);
    // path="seg" / path='seg'；允许 path 与 element 顺序互换
    const re = new RegExp(`\\bpath=["']${e}["']`, 'i');
    return re.test(routeSources);
}
function collectRouteSourcePaths(projectContext, planFiles, fileMapPaths) {
    const out = [];
    const seen = new Set();
    const push = (p) => {
        if (!p)
            return;
        const n = p.replace(/\\/g, '/');
        if (seen.has(n))
            return;
        seen.add(n);
        out.push(n);
    };
    for (const p of projectContext?.thehand?.routingIntegration?.routeEntryFiles ?? [])
        push(p);
    for (const p of projectContext?.thehand?.recallL1?.entryCandidates ?? []) {
        const base = p.split('/').pop() ?? '';
        if (/^(main|index|App)\.(jsx|tsx|js|ts)$/i.test(base))
            push(p);
    }
    for (const f of planFiles) {
        if (isRouteTableModulePath(f.path))
            push(f.path);
    }
    for (const p of fileMapPaths) {
        if (isRouteTableModulePath(p))
            push(p);
    }
    for (const p of ['frontend/src/main.jsx', 'frontend/src/main.tsx', 'src/main.jsx', 'src/main.tsx'])
        push(p);
    return out;
}
/**
 * 合并路由表文件全文（优先本轮 fileMap，否则读沙箱磁盘），用于与布局内 Tab 路径对照。
 */
export async function loadMergedRouteTableSources(sandboxPath, projectContext, planFiles, fileMap) {
    const paths = collectRouteSourcePaths(projectContext, planFiles, [...fileMap.keys()]);
    const primary = pickApplicationEntryForRouteTable(sandboxPath, projectContext);
    if (primary) {
        const ordered = [primary, ...paths.filter(p => p !== primary)];
        return loadSourcesJoined(sandboxPath, ordered, fileMap);
    }
    return loadSourcesJoined(sandboxPath, paths, fileMap);
}
async function loadSourcesJoined(sandboxPath, paths, fileMap) {
    const chunks = [];
    const tried = new Set();
    for (const rel of paths) {
        if (tried.has(rel))
            continue;
        tried.add(rel);
        const mapped = fileMap.get(rel)?.content;
        if (mapped && mapped !== '__DELETE__') {
            chunks.push(`// --- ${rel} (本轮生成) ---\n${mapped}`);
            continue;
        }
        try {
            const disk = await readFile(join(sandboxPath, rel), 'utf-8');
            chunks.push(`// --- ${rel} (沙箱磁盘) ---\n${disk}`);
        }
        catch {
            /* 不存在则跳过 */
        }
    }
    return chunks.join('\n\n');
}
async function readPlanOrMapContent(relPath, fileMap, sandboxPath) {
    const mapped = fileMap.get(relPath)?.content;
    if (mapped && mapped !== '__DELETE__')
        return mapped;
    try {
        return await readFile(join(sandboxPath, relPath), 'utf-8');
    }
    catch {
        return null;
    }
}
/**
 * 对本轮方案涉及的布局 + 本轮生成文件：Outlet + 相对 Tab 必须在路由表中出现对应 path，否则返回违规列表（供编码重试）。
 */
export async function findOutletNavRouteViolations(sandboxPath, projectContext, planFiles, fileMap) {
    const routeSources = await loadMergedRouteTableSources(sandboxPath, projectContext, planFiles, fileMap);
    if (!routeSources.trim())
        return [];
    const violations = [];
    const seen = new Set();
    const pathsToScan = new Set();
    for (const f of planFiles) {
        if (f.path)
            pathsToScan.add(f.path.replace(/\\/g, '/'));
    }
    for (const k of fileMap.keys())
        pathsToScan.add(k.replace(/\\/g, '/'));
    for (const relPath of pathsToScan) {
        if (!/\.(jsx|tsx)$/.test(relPath))
            continue;
        const content = await readPlanOrMapContent(relPath, fileMap, sandboxPath);
        if (!content)
            continue;
        const segments = extractOutletRelativeNavSegments(content);
        if (segments.length === 0)
            continue;
        for (const seg of segments) {
            if (routeTableDeclaresSegment(routeSources, seg))
                continue;
            const key = `${relPath}::${seg}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            violations.push({
                layoutPath: relPath,
                segment: seg,
                message: `布局 ${relPath} 在含 <Outlet> 的页面中为相对路径导航声明了「${seg}」，但路由入口（如 main.jsx / router）中未找到 path="${seg}" 的 <Route>，运行时将 404。请在路由表中为该段增加嵌套 <Route path="${seg}" element={...} />，与 NavItem/NavLink 一致。`,
            });
        }
    }
    return violations;
}
//# sourceMappingURL=outlet-nav-route-guard.js.map