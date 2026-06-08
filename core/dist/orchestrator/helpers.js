/**
 * Orchestrator 共享辅助函数
 * 从原 orchestrator.ts 中提取的工具函数
 */
import { readdir, access, readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';
const log = createLogger('orchestrator:helpers');
/**
 * 将 plan 中的新文件映射到已有的相似文件
 * 解决 LLM 创建 ArticlePreview.jsx 而不是修改 ArticlesPreview.jsx 的问题
 */
export async function resolvePlanToExistingFiles(plan, sandboxPath) {
    const resolved = [];
    for (const file of plan) {
        const fullPath = join(sandboxPath, file.path);
        let exists = false;
        try {
            await access(fullPath);
            exists = true;
        }
        catch { }
        if (exists) {
            resolved.push(file);
            continue;
        }
        // 文件不存在 → 查找名称相似的已有文件
        const dir = file.path.split('/').slice(0, -1).join('/');
        const name = file.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? '';
        if (!name) {
            resolved.push(file);
            continue;
        }
        const searchDirs = [dir];
        const parts = dir.split('/');
        for (let i = parts.length - 1; i >= 0; i--) {
            searchDirs.push(parts.slice(0, i).join('/'));
        }
        let bestMatch = null;
        for (const searchDir of searchDirs) {
            if (!searchDir)
                continue;
            try {
                const entries = await listFilesRecursive(join(sandboxPath, searchDir));
                for (const entry of entries) {
                    const entryName = entry.replace(/\.(jsx?|tsx|vue)$/, '').split('/').pop() ?? '';
                    if (!entryName)
                        continue;
                    const a = entryName.toLowerCase();
                    const b = name.toLowerCase();
                    const editDist = (x, y) => {
                        const m = x.length, n = y.length;
                        const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
                        for (let i = 0; i <= m; i++)
                            dp[i][0] = i;
                        for (let j = 0; j <= n; j++)
                            dp[0][j] = j;
                        for (let i = 1; i <= m; i++)
                            for (let j = 1; j <= n; j++)
                                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
                        return dp[m][n];
                    };
                    if (a === b || a === b + 's' || b === a + 's' ||
                        (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) ||
                        (Math.min(a.length, b.length) >= 6 && editDist(a, b) <= 2)) {
                        bestMatch = `${searchDir}/${entry}`;
                        break;
                    }
                }
                if (bestMatch)
                    break;
            }
            catch { }
        }
        if (bestMatch) {
            const existingPath = bestMatch.replace(/\\/g, '/');
            log.info(`${file.path} → ${existingPath}（已有相似文件，改为修改）`);
            resolved.push({
                path: existingPath,
                changeDescription: `[自动修正] 原计划创建 ${file.path}，但 ${existingPath} 已存在。${file.changeDescription}`,
                priority: file.priority,
            });
        }
        else {
            resolved.push(file);
        }
    }
    return resolved;
}
/**
 * 递归列出目录下的组件文件
 */
export async function listFilesRecursive(dirPath, maxDepth = 3) {
    const results = [];
    const walk = async (dir, depth) => {
        if (depth > maxDepth)
            return;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const e of entries) {
                if (e.name.startsWith('.') || e.name === 'node_modules')
                    continue;
                if (e.isDirectory()) {
                    await walk(`${dir}/${e.name}`, depth + 1);
                }
                else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
                    results.push(e.name);
                }
            }
        }
        catch { }
    };
    await walk(dirPath, 0);
    return results;
}
/**
 * 扫描现有前端组件目录，生成 hint 字符串
 * 防止 Plan Agent 创建已存在组件的替代品
 * 从 projectContext.structure 读取组件/路由目录，无配置时跳过扫描
 */
export async function scanExistingComponents(sandboxPath, componentDirs) {
    try {
        const scanDir = async (dir, prefix = '') => {
            const results = [];
            try {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.name.startsWith('.') || e.name === 'node_modules')
                        continue;
                    const relPath = prefix ? `${prefix}/${e.name}` : e.name;
                    if (e.isDirectory()) {
                        results.push(...await scanDir(`${dir}/${e.name}`, relPath));
                    }
                    else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
                        results.push(relPath);
                    }
                }
            }
            catch { }
            return results;
        };
        // 从 projectContext.structure 读取目录，无配置时跳过
        const dirs = componentDirs ?? [];
        if (dirs.length === 0)
            return '';
        const allFiles = [];
        for (const dir of dirs) {
            const files = await scanDir(join(sandboxPath, dir));
            if (files.length > 0) {
                allFiles.push({ label: dir, files });
            }
        }
        if (allFiles.length > 0) {
            let componentList = '';
            for (const group of allFiles) {
                componentList += `\n### ${group.label}\n` + group.files.map(f => `- ${f}`).join('\n');
            }
            return componentList;
        }
    }
    catch { }
    return '';
}
/**
 * 从构建/测试错误输出中提取涉及的源码文件路径，并读取其内容
 */
export async function extractAndReadErrorFiles(errorOutput, sandboxPath) {
    const filePaths = new Set();
    const patterns = [
        /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:js|jsx|ts|tsx|vue))\s*\(\d+:\d+\):/g,
        /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:js|jsx|ts|tsx|vue))\(\d+,\d+\):\s*error/g,
        /(?:^|\n)\s*((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue)):\d+:\d+:\s*(?:error|warning)/g,
        /file:\s*\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue))/g,
        /(?:is not exported by|is not declared in|Cannot find module|Module not found)[^"']*["']((?:src|app|lib)\/[^"']+\.(?:js|jsx|ts|tsx|vue))["']/gi,
        /imported by\s+["']((?:src|app|lib)\/[^"']+\.(?:js|jsx|ts|tsx|vue))["']/gi,
        /(?:^|\s)\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:]+\.(?:js|jsx|ts|tsx|vue)):\d+/g,
    ];
    const EXCLUDE_PATTERNS = [
        /node_modules[\\/]/,
        /rollup[\\/]dist[\\/]/,
        /vite[\\/]dist[\\/]/,
        /parseAst\.js$/,
        /node-entry\.js$/,
    ];
    function isExcluded(path) {
        return EXCLUDE_PATTERNS.some(p => p.test(path));
    }
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(errorOutput)) !== null) {
            const filePath = match[1].replace(/^\//, '');
            if (isExcluded(filePath))
                continue;
            const normalized = filePath.replace(/^(?:frontend|backend)\//, '');
            filePaths.add(normalized);
        }
    }
    const results = [];
    for (const filePath of filePaths) {
        const candidates = [
            join(sandboxPath, 'frontend', filePath),
            join(sandboxPath, 'backend', filePath),
            join(sandboxPath, filePath),
        ];
        for (const fullPath of candidates) {
            try {
                const content = await readFile(fullPath, 'utf-8');
                results.push({ path: filePath, content });
                break;
            }
            catch { }
        }
    }
    return results;
}
//# sourceMappingURL=helpers.js.map