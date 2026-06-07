/**
 * 校验本轮 fileMap 中源码的相对 import 在沙箱（磁盘 + 本轮覆盖）下是否可解析，
 * 避免 Vite「Failed to resolve import」类错误在测试未跑 build 时漏网。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { extractRelativeImportSpecifiers, loadSandboxSourceContents, relativeSpecifierResolvesInSandbox, } from './component-sandbox-import.js';
const SRC_LIKE = /\.(jsx?|tsx?|vue|mjs|cjs)$/;
/** 补充：跨行 import … from「.」 的 from 子句（行级解析易漏） */
function extractRelativeImportsLoose(content) {
    const out = new Set();
    for (const s of extractRelativeImportSpecifiers(content))
        out.add(s);
    const fromRe = /\bfrom\s+['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = fromRe.exec(content)) !== null) {
        out.add(m[1]);
    }
    const sideEffectRe = /\bimport\s+['"](\.[^'"]+)['"]/g;
    while ((m = sideEffectRe.exec(content)) !== null) {
        out.add(m[1]);
    }
    return [...out];
}
async function readPlanOrMapContent(relPath, fileMap, sandboxPath) {
    const key = relPath.replace(/\\/g, '/');
    const mapped = fileMap.get(key)?.content;
    if (mapped && mapped !== '__DELETE__')
        return mapped;
    try {
        return await readFile(join(sandboxPath, key), 'utf-8');
    }
    catch {
        return null;
    }
}
/**
 * 对本轮方案涉及的源码路径 + fileMap 产出：检查相对 import 是否均可解析（fileMap 优先，否则读沙箱磁盘）。
 */
export async function findUnresolvedRelativeImportsInFileMap(sandboxPath, projectContext, planFiles, fileMap) {
    const baseIndex = await loadSandboxSourceContents(sandboxPath, projectContext?.structure);
    for (const [k, v] of fileMap) {
        if (!v.content || v.content === '__DELETE__')
            continue;
        baseIndex.set(k.replace(/\\/g, '/'), v.content);
    }
    const known = new Set(baseIndex.keys());
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
        if (!SRC_LIKE.test(relPath))
            continue;
        const content = await readPlanOrMapContent(relPath, fileMap, sandboxPath);
        if (!content || content === '__DELETE__')
            continue;
        const from = relPath.replace(/\\/g, '/');
        for (const spec of extractRelativeImportsLoose(content)) {
            if (!spec.startsWith('.'))
                continue;
            if (await relativeSpecifierResolvesInSandbox(sandboxPath, from, spec, known))
                continue;
            const key = `${from}>>${spec}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            violations.push({
                fromPath: from,
                specifier: spec,
                message: `文件 ${from} 中相对 import「${spec}」无法解析到沙箱内任何现有文件（含本轮已生成路径）。` +
                    '这通常会在 Vite 开发服务器上报 Failed to resolve import。请改为与仓库实际路径一致的 import（例如 Conduit 为 import App from "./App" 而非 "./components/App"）。',
            });
        }
    }
    return violations;
}
//# sourceMappingURL=relative-import-resolve-guard.js.map