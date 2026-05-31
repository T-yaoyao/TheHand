import { readFile } from 'fs/promises';
import { resolve } from 'path';
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
 * 按方案逐文件生成代码（与 cli.mjs 一致，避免 tool-use 循环输出不可解析）
 */
export async function runCoding(llmClient, promptManager, plan, sandboxPath, projectContext, lessonsHint) {
    const systemPrompt = await promptManager.load('coding');
    const results = [];
    // 构建项目约束 + 错误反馈 + 历史教训
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
    for (const file of plan) {
        // 路径穿越检查
        const fullPath = resolve(sandboxPath, file.path);
        if (!fullPath.startsWith(resolve(sandboxPath))) {
            continue; // 跳过越界路径
        }
        let originalContent = '';
        try {
            originalContent = await readFile(fullPath, 'utf-8');
        }
        catch {
            // 新文件，无原始内容
        }
        const userMessage = `技术方案条目：\n${JSON.stringify(file, null, 2)}\n\n原始文件 ${file.path}：\n\`\`\`\n${originalContent}\n\`\`\`\n\n请输出修改后的完整文件，JSON 格式包含 path、content、summary。${constraintsHint}`;
        const response = await llmClient.simpleChat(systemPrompt, userMessage, 'coding');
        const parsed = parseCodingFileResponse(response, file.path, file.changeDescription);
        if (parsed) {
            results.push(parsed);
        }
        else {
            console.error(`[coding] 文件 ${file.path} 的 LLM 输出解析失败，跳过。response 前200字: ${response?.slice(0, 200)}`);
        }
    }
    return results;
}
/**
 * 解析单文件编码结果：JSON、markdown 代码块或纯文本
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
        // 仅当代码块是源码（非 JSON 元数据）时才作为文件内容
        if (block.length > 0 && !block.trimStart().startsWith('{') && !block.trimStart().startsWith('[')) {
            return { path: expectedPath, content: block, summary: defaultSummary };
        }
    }
    // 无代码块时，若响应像源码则直接使用
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
        catch {
            // try next candidate
        }
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
    // 单对象未带 path 时回退到方案路径
    if (json.content) {
        return {
            path: json.path ?? expectedPath,
            content: String(json.content),
            summary: json.summary ?? defaultSummary,
        };
    }
    return null;
}
/** 从 LLM 回复中提取可能的 JSON 字符串（优先 files 包装结构） */
function extractJsonCandidates(text) {
    const candidates = [text.trim()];
    // 非贪婪匹配，避免跨越多个 JSON 对象
    const filesMatch = text.match(/\{[\s\S]*?"files"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
    if (filesMatch)
        candidates.unshift(filesMatch[0]);
    const braceMatch = text.match(/\{[\s\S]*?\}/);
    if (braceMatch)
        candidates.push(braceMatch[0]);
    return [...new Set(candidates)];
}
//# sourceMappingURL=coding-agent.js.map