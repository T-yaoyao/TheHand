import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { formatL1RecallSection } from '../utils/recall-l1.js';
/**
 * 编码 Agent Function Calling 工具定义
 */
export const CODING_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'submit_files',
            description: '提交所有需要修改的文件。一次性输出全部文件，不要分批。',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: '相对于项目根目录的文件路径' },
                                content: { type: 'string', description: '完整最终源码（非 diff）。须以上下文「原始内容」为基底做最小编辑；禁止凭记忆整文件重写导致漏 hooks/import。删除填 __DELETE__' },
                                summary: { type: 'string', description: '一句话描述本次改动' },
                            },
                            required: ['path', 'content', 'summary'],
                        },
                    },
                },
                required: ['files'],
            },
        },
    },
];
/** 注入用户消息，强化「在原始全文上编辑」而非「默写整文件」 */
const CODING_USER_EDIT_STRATEGY = `

## 编辑策略（必读）
- 下方「各文件原始内容」中的代码块是**唯一正确基底**；提交时仍须给出**完整**文件正文，但应等于「在该基底上做最小编辑」后的结果。
- 禁止凭记忆/示例另写一版，尤其禁止丢掉原有的 state、副作用、数据请求与未在方案中要求改动的 import。
`;
/**
 * 从 LLM 返回的 tool_calls 中提取 submit_files.files（兼容多条 tool、arguments 已为对象等情况）
 */
function extractSubmitFilesFromToolCalls(toolCalls) {
    if (!toolCalls?.length)
        return null;
    for (const tc of toolCalls) {
        if (tc.name !== 'submit_files')
            continue;
        const args = tc.arguments;
        if (!args || typeof args !== 'object')
            continue;
        const files = args.files;
        if (!Array.isArray(files) || files.length === 0)
            continue;
        const out = [];
        for (const item of files) {
            if (!item || typeof item !== 'object')
                continue;
            const rec = item;
            if (typeof rec.path !== 'string' || typeof rec.content !== 'string')
                continue;
            const summary = typeof rec.summary === 'string' ? rec.summary : '';
            out.push({ path: rec.path, content: rec.content, summary });
        }
        if (out.length > 0)
            return out;
    }
    return null;
}
function codingLlmOptions(agent) {
    const opts = {
        tools: CODING_TOOLS,
        agent,
        maxTokens: 16384,
    };
    if (process.env.THEHAND_DISABLE_FORCE_TOOL_CHOICE !== '1') {
        opts.requireFunctionCallName = 'submit_files';
    }
    return opts;
}
/**
 * 编码 Agent 定义（供 AgentRunner 等场景使用）
 */
export function createCodingAgent() {
    return {
        name: 'coding',
        description: '根据技术方案，读取原始文件，生成修改后的完整文件内容',
        systemPrompt: '见 prompts/coding/v1.md，推荐通过 runCoding() 执行',
        tools: ['file-read', 'skill-execute'],
    };
}
/**
 * 批量生成代码：一次 LLM 调用生成所有文件，agent 可以看到全局上下文
 */
export async function runCoding(llmClient, promptManager, plan, sandboxPath, projectContext, lessonsHint, previousOutputs, testError) {
    const systemPrompt = await promptManager.load('coding');
    // 构建项目约束
    let constraintsHint = '';
    if (projectContext?.constraints) {
        const entries = Object.entries(projectContext.constraints);
        if (entries.length > 0) {
            constraintsHint = '\n\n## 项目约束（必须遵守）\n' +
                entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
        }
    }
    if (lessonsHint) {
        constraintsHint += lessonsHint;
    }
    // 读取项目结构（目录树）
    const projectTree = await getProjectTree(sandboxPath, 3);
    // 读取所有 plan 文件的原始内容
    const fileContexts = [];
    for (const file of plan) {
        const fullPath = resolve(sandboxPath, file.path);
        if (!fullPath.startsWith(resolve(sandboxPath)))
            continue;
        let originalContent = '';
        try {
            originalContent = await readFile(fullPath, 'utf-8');
        }
        catch {
            originalContent = '（新文件，不存在）';
        }
        fileContexts.push(`### ${file.path}\n${file.changeDescription ? `操作: ${file.changeDescription}` : ''}\n\`\`\`\n${originalContent}\n\`\`\``);
    }
    // 读取关键上下文文件（路由入口、App、package.json 等，可由 project.json thehand.readContextCandidates 追加）
    const contextFiles = await readContextFiles(sandboxPath, projectContext);
    let contextHint = '';
    // 提取可用依赖列表，强制注入 prompt
    const availableDeps = await extractAvailableDependencies(sandboxPath);
    const depsList = [...availableDeps].sort().join(', ');
    const depsHint = availableDeps.size > 0
        ? `\n\n## ⚠️ 可用依赖（只允许 import 以下包，禁止使用其他第三方库）\n${depsList}\n\n如果需要的库不在上面的列表中，用原生 JavaScript/CSS 实现，或使用列表中已有的替代方案。`
        : '';
    if (contextFiles.length > 0) {
        contextHint = '\n\n## 关键上下文文件\n' + contextFiles.join('\n\n');
    }
    const l1Section = await formatL1RecallSection(sandboxPath, projectContext, plan.map(f => f.path));
    // 构建错误反馈（重试时）
    let errorHint = '';
    if (testError) {
        errorHint = `\n\n## 上轮测试失败\n${testError}

请分析错误根因并修正代码。修复规则：
1. 如果错误是 "xxx is not exported by yyy"，必须在 yyy 文件中**定义** xxx（函数/变量），然后导出。仅添加 export 语句不够。
2. 如果错误涉及方案外的文件，请将修复后的文件完整内容一并输出。
3. 修复 import 错误时，确保导入的函数/变量在源文件中有完整的定义和导出。`;
    }
    if (previousOutputs && previousOutputs.length > 0) {
        errorHint += '\n\n## 上轮生成的代码（仅供参考，请修正错误后重新生成）\n' +
            previousOutputs.map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 500)}${f.content.length > 500 ? '\n...(截断)' : ''}\n\`\`\``).join('\n');
    }
    const userMessage = `## 技术方案（需要生成的文件）\n${plan.map(f => `- ${f.path}: ${f.changeDescription}`).join('\n')}
${CODING_USER_EDIT_STRATEGY}
## 项目目录结构
\`\`\`
${projectTree}
\`\`\`

## 各文件原始内容
${fileContexts.join('\n\n')}
${contextHint}${l1Section}${constraintsHint}${depsHint}${errorHint}

请输出所有文件的修改结果，JSON 数组格式。`;
    // Function Calling 优先路径
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = await llmClient.chat(messages, codingLlmOptions('coding'));
    const fromTools = extractSubmitFilesFromToolCalls(response.toolCalls);
    if (fromTools) {
        console.log('[coding] 使用 function calling 直接返回文件列表');
        return fromTools;
    }
    // Fallback：旧的解析逻辑兜底
    console.log('[coding] function calling 未命中，使用 fallback 解析');
    console.log(`[coding] response.finishReason=${response.finishReason}, content.length=${response.content?.length ?? 0}, content.first300=${response.content?.slice(0, 300)}`);
    console.log(`[coding] usage: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`);
    return parseCodingBatchResponse(response.content, plan);
}
/**
 * 分批生成代码：只生成一个 batch 的文件，带精简上下文
 * 用于纯代码分批策略下的单批次执行
 */
export async function runCodingBatch(llmClient, promptManager, batch, plan, fileInterfaces, generatedSummaries, sandboxPath, projectContext, errorHint, 
// Architect Agent 增强数据（可选，有则替代正则提取的信息）
architectFiles, crossFileRefs, globalContext) {
    const systemPrompt = await promptManager.load('coding');
    // 构建项目约束
    let constraintsHint = '';
    if (projectContext?.constraints) {
        const entries = Object.entries(projectContext.constraints);
        if (entries.length > 0) {
            constraintsHint = '\n\n## 项目约束（必须遵守）\n' +
                entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
        }
    }
    // 只读取本批次文件的原始内容 + 改动描述
    const fileContexts = [];
    for (const filePath of batch.files) {
        const fullPath = resolve(sandboxPath, filePath);
        if (!fullPath.startsWith(resolve(sandboxPath)))
            continue;
        let originalContent = '';
        try {
            originalContent = await readFile(fullPath, 'utf-8');
        }
        catch {
            originalContent = '（新文件，不存在）';
        }
        // 优先使用 architect 的 detailedChange，降级到 plan 的 changeDescription
        const archFile = architectFiles?.find(f => f.path === filePath);
        const planItem = plan.find(f => f.path === filePath);
        const changeDesc = archFile?.detailedChange ?? planItem?.changeDescription ?? '';
        const actionHint = archFile?.action ? `操作类型: ${archFile.action}\n` : '';
        fileContexts.push(`### ${filePath}\n${actionHint}改动指令: ${changeDesc}\n\`\`\`\n${originalContent}\n\`\`\``);
    }
    // 全局上下文（来自 architect 的整体变更分析）
    let globalContextHint = '';
    if (globalContext) {
        globalContextHint = `\n\n## 整体变更逻辑\n${globalContext}`;
    }
    // 已生成文件的接口摘要（来自前序 batch）
    let generatedSummaryHint = '';
    if (generatedSummaries.size > 0) {
        const lines = ['\n\n## 已生成文件的接口摘要（供参考，不要重复生成）'];
        for (const [path, summary] of generatedSummaries) {
            lines.push(`- ${path}: ${summary}`);
        }
        generatedSummaryHint = lines.join('\n');
    }
    // 跨文件引用关系：优先使用 architect 的 crossFileRefs，降级到正则提取
    let crossRefHint = '';
    if (crossFileRefs && crossFileRefs.length > 0) {
        // 只取与本批次相关的 cross-file refs（from 或 to 在本批次中）
        const batchFileSetForRef = new Set(batch.files);
        const relevantRefs = crossFileRefs.filter(r => batchFileSetForRef.has(r.from) || batchFileSetForRef.has(r.to));
        if (relevantRefs.length > 0) {
            crossRefHint = '\n\n## 跨文件引用关系（必须保持一致）\n' +
                relevantRefs.map(r => `- ${r.from} → ${r.to}: ${r.ref}`).join('\n');
        }
    }
    else {
        // fallback：正则提取的 import 关系
        const batchFileSet = new Set(batch.files);
        const batchInterfaces = fileInterfaces.filter(f => batchFileSet.has(f.path));
        const crossRefs = [];
        for (const fi of batchInterfaces) {
            for (const importLine of fi.imports) {
                const importMatch = importLine.match(/from\s+['"]([^'"]+)['"]/) ||
                    importLine.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
                if (importMatch) {
                    const importPath = importMatch[1];
                    if (importPath.startsWith('.')) {
                        crossRefs.push(`${fi.path} imports: ${importLine.trim()}`);
                    }
                }
            }
        }
        if (crossRefs.length > 0) {
            crossRefHint = '\n\n## 本批次文件的 import 关系（注意保持一致）\n' +
                crossRefs.map(r => `- ${r}`).join('\n');
        }
    }
    const l1Section = await formatL1RecallSection(sandboxPath, projectContext, batch.files);
    // 提取可用依赖列表
    const availableDeps = await extractAvailableDependencies(sandboxPath);
    const depsList = [...availableDeps].sort().join(', ');
    const depsHint = availableDeps.size > 0
        ? `\n\n## ⚠️ 可用依赖（只允许 import 以下包，禁止使用其他第三方库）\n${depsList}\n\n如果需要的库不在上面的列表中，用原生 JavaScript/CSS 实现，或使用列表中已有的替代方案。`
        : '';
    const userMessage = `## 本批次需要生成的文件
${batch.files.join(', ')}
${globalContextHint}
${CODING_USER_EDIT_STRATEGY}
## 各文件原始内容和改动指令
${fileContexts.join('\n\n')}
${generatedSummaryHint}${crossRefHint}${l1Section}${constraintsHint}${depsHint}${errorHint ? '\n\n' + errorHint : ''}

请输出本批次所有文件的修改结果，JSON 数组格式。`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = await llmClient.chat(messages, codingLlmOptions('coding-batch'));
    const fromTools = extractSubmitFilesFromToolCalls(response.toolCalls);
    if (fromTools) {
        console.log(`[coding-batch] 使用 function calling 直接返回文件列表 (batch: ${batch.files.join(', ')})`);
        return fromTools;
    }
    // Fallback
    console.log(`[coding-batch] function calling 未命中，使用 fallback 解析 (batch: ${batch.files.join(', ')})`);
    console.log(`[coding-batch] response.finishReason=${response.finishReason}, content.length=${response.content?.length ?? 0}, content.first300=${response.content?.slice(0, 300)}`);
    console.log(`[coding-batch] usage: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`);
    return parseCodingBatchResponse(response.content, batch.files.map(path => ({ path, changeDescription: '', priority: 0 })));
}
/**
 * 从已生成的代码中提取接口摘要，供后续 batch 参考
 * 只提取 exports 和关键接口，不传全文
 */
export function extractInterfaceSummary(output) {
    const content = output.content;
    if (!content || content === '__DELETE__')
        return '已删除';
    const parts = [];
    // 提取 export 语句
    const exportMatches = content.match(/^export\s+.+/gm);
    if (exportMatches) {
        parts.push(`exports: ${exportMatches.slice(0, 5).join('; ')}`);
    }
    // 提取函数签名
    const funcMatches = content.match(/^(export\s+)?(function|class|const)\s+\w+/gm);
    if (funcMatches) {
        parts.push(`defines: ${funcMatches.slice(0, 5).join('; ')}`);
    }
    // 提取路由定义
    const routeMatches = content.match(/^router\.(get|post|put|delete|patch)\(.+/gm);
    if (routeMatches) {
        parts.push(`routes: ${routeMatches.slice(0, 5).join('; ')}`);
    }
    return parts.length > 0 ? parts.join(' | ') : output.summary || '已修改';
}
/**
 * 解析批量编码结果：JSON 数组
 * 使用深度计数提取最外层 JSON 片段，正确处理字符串内的括号和转义
 */
function parseCodingBatchResponse(response, plan) {
    if (!response?.trim())
        return [];
    const results = [];
    // 辅助：用深度计数找最外层 JSON 片段，提取所有能解析的文件，绝不提前退出
    function tryExtractByBracket(open, close) {
        let start = -1;
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = 0; i < response.length; i++) {
            const ch = response[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\' && inString) {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString)
                continue;
            if (ch === open) {
                if (depth === 0)
                    start = i;
                depth++;
            }
            else if (ch === close) {
                depth--;
                if (depth === 0 && start !== -1) {
                    const jsonStr = response.slice(start, i + 1);
                    try {
                        const parsed = JSON.parse(jsonStr);
                        extractFiles(parsed, results);
                        // 移除已提取的片段，继续往后找，绝不提前 return
                    }
                    catch {
                        // 继续尝试后面的片段
                    }
                    start = -1;
                }
            }
        }
    }
    // 0. 直接解析整个字符串（LLM 返回纯 JSON 的情况）
    try {
        const parsed = JSON.parse(response);
        extractFiles(parsed, results);
    }
    catch { }
    // 1. 从代码块中提取（先处理，因为 LLM 常用代码块包裹 JSON）
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(response)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            extractFiles(parsed, results);
        }
        catch { }
    }
    // 2. 用深度计数找最外层 JSON 数组或对象，绝不提前退出
    tryExtractByBracket('[', ']');
    tryExtractByBracket('{', '}');
    // 3. 输出完整性校验：有效JSON占比低于30%直接判定解析失败
    const totalResponseChars = response?.trim().length ?? 0;
    const totalExtractedChars = results.reduce((sum, f) => sum + f.content.length, 0);
    if (totalResponseChars > 0 && totalExtractedChars / totalResponseChars < 0.3) {
        console.warn(`[coding] 输出完整性校验失败: 有效内容占比仅 ${Math.round((totalExtractedChars / totalResponseChars) * 100)}%`);
        return [];
    }
    // 4. 解析器层绝对不自动补空文件！所有缺失文件的处理逻辑100%集中到上层审计层
    if (results.length === 0) {
        console.error(`[coding] batch parse failed, response first 300 chars: ${response?.slice(0, 300)}`);
    }
    return results;
}
function extractFiles(parsed, results) {
    const items = [];
    if (Array.isArray(parsed))
        items.push(...parsed);
    else if (parsed?.files && Array.isArray(parsed.files))
        items.push(...parsed.files);
    else if (parsed?.path && parsed?.content)
        items.push(parsed);
    for (const item of items) {
        if (item?.path && item?.content) {
            results.push({
                path: item.path,
                content: String(item.content),
                summary: item.summary ?? '',
            });
        }
    }
}
/**
 * 获取项目目录树（限制深度）
 */
async function getProjectTree(dirPath, maxDepth, currentDepth = 0, prefix = '') {
    if (currentDepth >= maxDepth)
        return '';
    const lines = [];
    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const filtered = entries
            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== 'build')
            .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory())
                return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        for (let i = 0; i < filtered.length; i++) {
            const entry = filtered[i];
            const isLast = i === filtered.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';
            lines.push(`${prefix}${connector}${entry.name}`);
            if (entry.isDirectory()) {
                const subTree = await getProjectTree(join(dirPath, entry.name), maxDepth, currentDepth + 1, prefix + childPrefix);
                if (subTree)
                    lines.push(subTree);
            }
        }
    }
    catch { }
    return lines.join('\n');
}
/**
 * 读取关键上下文文件（可由 thehand.readContextCandidates 追加候选路径）
 */
async function readContextFiles(sandboxPath, projectContext) {
    const contextFiles = [];
    const DEFAULT_CANDIDATES = [
        'frontend/src/main.jsx',
        'frontend/src/main.tsx',
        'frontend/src/router.jsx',
        'frontend/src/router.tsx',
        'frontend/src/App.jsx',
        'frontend/src/App.tsx',
        'frontend/package.json',
        'package.json',
    ];
    const extra = projectContext?.thehand?.readContextCandidates ?? [];
    const candidates = [...new Set([...DEFAULT_CANDIDATES, ...extra])];
    for (const file of candidates) {
        try {
            const content = await readFile(join(sandboxPath, file), 'utf-8');
            contextFiles.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        }
        catch { }
    }
    return contextFiles;
}
/**
 * 从沙箱中的 package.json 文件提取所有可用依赖名
 */
export async function extractAvailableDependencies(sandboxPath) {
    const deps = new Set();
    const pkgPaths = ['package.json', 'frontend/package.json', 'backend/package.json'];
    for (const pkgPath of pkgPaths) {
        try {
            const content = await readFile(join(sandboxPath, pkgPath), 'utf-8');
            const pkg = JSON.parse(content);
            for (const name of Object.keys(pkg.dependencies ?? {}))
                deps.add(name);
            for (const name of Object.keys(pkg.devDependencies ?? {}))
                deps.add(name);
        }
        catch { }
    }
    return deps;
}
/**
 * 验证生成的代码是否使用了未安装的依赖
 * 返回违规的 import 列表（空数组表示全部合法）
 */
export function validateImports(outputs, availableDeps) {
    const violations = [];
    // 匹配 import ... from 'xxx' 和 require('xxx')
    const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const file of outputs) {
        if (file.content === '__DELETE__')
            continue;
        if (!/\.(jsx?|tsx?|mjs|cjs|vue)$/.test(file.path))
            continue;
        let match;
        while ((match = importRegex.exec(file.content)) !== null) {
            const imp = match[1] ?? match[2];
            // 跳过相对路径和 node: 内置模块
            if (imp.startsWith('.') || imp.startsWith('node:'))
                continue;
            // 提取包名（scoped package 取前两段，普通包取第一段）
            const parts = imp.split('/');
            const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
            if (!availableDeps.has(pkgName)) {
                violations.push({ file: file.path, imp: pkgName });
            }
        }
    }
    return violations;
}
/**
 * 解析单文件编码结果（兼容旧接口，已 deprecated）
 * @deprecated 请使用 Function Calling 批量获取文件
 */
export function parseCodingFileResponse(response, expectedPath, defaultSummary) {
    if (!response?.trim())
        return null;
    const fromJson = tryParseCodingJson(response, expectedPath, defaultSummary);
    if (fromJson)
        return fromJson;
    const codeMatch = response.match(/```(?:javascript|js|jsx|json)?\n([\s\S]*?)```/);
    if (codeMatch) {
        const block = codeMatch[1].trim();
        const fromBlockJson = tryParseCodingJson(block, expectedPath, defaultSummary);
        if (fromBlockJson)
            return fromBlockJson;
        if (block.length > 0 && !block.trimStart().startsWith('{') && !block.trimStart().startsWith('[')) {
            return { path: expectedPath, content: block, summary: defaultSummary };
        }
    }
    const trimmed = response.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && trimmed.includes('\n')) {
        return { path: expectedPath, content: trimmed, summary: defaultSummary };
    }
    return null;
}
function tryParseCodingJson(text, expectedPath, defaultSummary) {
    let json = null;
    for (const candidate of extractJsonCandidates(text)) {
        try {
            json = JSON.parse(candidate);
            break;
        }
        catch { }
    }
    if (!json)
        return null;
    const items = [];
    if (Array.isArray(json))
        items.push(...json);
    else if (Array.isArray(json.files))
        items.push(...json.files);
    else
        items.push(json);
    for (const item of items) {
        if (!item?.path || !item?.content)
            continue;
        if (item.path === expectedPath || items.length === 1) {
            return {
                path: item.path,
                content: String(item.content),
                summary: item.summary ?? defaultSummary,
            };
        }
    }
    if (json.content) {
        return {
            path: json.path ?? expectedPath,
            content: String(json.content),
            summary: json.summary ?? defaultSummary,
        };
    }
    return null;
}
function extractJsonCandidates(text) {
    const candidates = [text.trim()];
    const filesMatch = text.match(/\{[\s\S]*?"files"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
    if (filesMatch)
        candidates.unshift(filesMatch[0]);
    const braceMatch = text.match(/\{[\s\S]*?\}/);
    if (braceMatch)
        candidates.push(braceMatch[0]);
    return [...new Set(candidates)];
}
//# sourceMappingURL=coding-agent.js.map