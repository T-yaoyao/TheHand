import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
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
    // 读取关键上下文文件（main.jsx, router 等）
    const contextFiles = await readContextFiles(sandboxPath);
    let contextHint = '';
    if (contextFiles.length > 0) {
        contextHint = '\n\n## 关键上下文文件\n' + contextFiles.join('\n\n');
    }
    // 构建错误反馈（重试时）
    let errorHint = '';
    if (testError) {
        errorHint = `\n\n## 上轮测试失败\n${testError}\n请分析错误原因并修正代码。`;
    }
    if (previousOutputs && previousOutputs.length > 0) {
        errorHint += '\n\n## 上轮生成的代码（仅供参考，请修正错误后重新生成）\n' +
            previousOutputs.map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 500)}${f.content.length > 500 ? '\n...(截断)' : ''}\n\`\`\``).join('\n');
    }
    const userMessage = `## 技术方案（需要生成的文件）\n${plan.map(f => `- ${f.path}: ${f.changeDescription}`).join('\n')}

## 项目目录结构
\`\`\`
${projectTree}
\`\`\`

## 各文件原始内容
${fileContexts.join('\n\n')}
${contextHint}${constraintsHint}${errorHint}

请输出所有文件的修改结果，JSON 数组格式。`;
    const response = await llmClient.simpleChat(systemPrompt, userMessage, 'coding');
    return parseCodingBatchResponse(response, plan);
}
/**
 * 解析批量编码结果：JSON 数组
 */
function parseCodingBatchResponse(response, plan) {
    if (!response?.trim())
        return [];
    const results = [];
    // 优先从 markdown 代码块中提取（LLM 最常见的输出格式）
    const codeBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
        try {
            const parsed = JSON.parse(codeBlockMatch[1].trim());
            extractFiles(parsed, results);
            if (results.length > 0)
                return results;
        }
        catch { }
    }
    // 尝试直接解析整个响应为 JSON
    try {
        const parsed = JSON.parse(response.trim());
        extractFiles(parsed, results);
        if (results.length > 0)
            return results;
    }
    catch { }
    // 尝试匹配 JSON 数组（贪婪，匹配最大的 [...]）
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            extractFiles(parsed, results);
            if (results.length > 0)
                return results;
        }
        catch { }
    }
    // 尝试匹配单个 JSON 对象
    const braceMatch = response.match(/\{[\s\S]*?\}/);
    if (braceMatch) {
        try {
            const obj = JSON.parse(braceMatch[0]);
            if (obj?.path && obj?.content) {
                return [{ path: obj.path, content: String(obj.content), summary: obj.summary ?? '' }];
            }
        }
        catch { }
    }
    console.error(`[coding] batch parse failed, response first 300 chars: ${response?.slice(0, 300)}`);
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
 * 读取关键上下文文件（main.jsx, router, package.json 等）
 */
async function readContextFiles(sandboxPath) {
    const contextFiles = [];
    const candidates = [
        'frontend/src/main.jsx',
        'frontend/src/main.tsx',
        'frontend/src/router.jsx',
        'frontend/src/router.tsx',
        'frontend/src/App.jsx',
        'frontend/src/App.tsx',
        'frontend/package.json',
        'package.json',
    ];
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
 * 解析单文件编码结果（兼容旧接口）
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