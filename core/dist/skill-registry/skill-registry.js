import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { CODING_TOOLS } from '../agents/coding-agent.js';
import { Logger } from '../utils/logger.js';
const log = Logger.for('skill-registry');
/**
 * Skill 注册与发现机制
 * 对标 Claude Code 的 getSkillDirCommands() + createSkillCommand()
 *
 * 支持两种匹配模式：
 * 1. 声明式 SkillMatchRule（推荐）：多维匹配 + 优先级排序
 * 2. 传统 canHandle 函数（向后兼容）
 */
export class SkillRegistry {
    skills = new Map();
    /** 声明式匹配规则（优先级高于 canHandle） */
    matchRules = new Map();
    llmClient = null;
    /**
     * 注入 LLM 客户端，使 skill 执行成为可能
     */
    setLLMClient(client) {
        this.llmClient = client;
    }
    /**
     * 从项目目录自动发现并加载 Skills
     */
    async discover(projectDir) {
        const skillsDir = join(projectDir, 'skills');
        try {
            const entries = await readdir(skillsDir, { withFileTypes: true });
            await Promise.all(entries.filter(e => e.isDirectory()).map(async (entry) => {
                const skillPath = join(skillsDir, entry.name, 'SKILL.md');
                try {
                    const skill = await this.loadSkill(skillPath, entry.name);
                    this.skills.set(skill.name, skill);
                }
                catch {
                    // SKILL.md 不存在，跳过
                }
            }));
        }
        catch {
            // skills 目录不存在，跳过
        }
    }
    /**
     * 注册 Skill（支持声明式匹配规则）
     */
    register(skill, matchRule) {
        this.skills.set(skill.name, skill);
        if (matchRule) {
            this.matchRules.set(skill.name, matchRule);
        }
    }
    /**
     * 注销 Skill
     */
    unregister(name) {
        this.matchRules.delete(name);
        return this.skills.delete(name);
    }
    /**
     * 根据需求匹配 Skill
     * 优先使用声明式匹配规则（多维 + 优先级排序），回退到 canHandle 函数
     */
    match(requirement) {
        // 1. 声明式匹配：收集所有匹配的 skill 并按优先级排序
        const declarativeMatches = [];
        for (const [name, rule] of this.matchRules) {
            const score = this.evaluateMatchRule(rule, requirement);
            if (score > 0) {
                declarativeMatches.push({ name, score, priority: rule.priority ?? 0 });
            }
        }
        if (declarativeMatches.length > 0) {
            // 按优先级排序（高到低），再按分数排序（高到低）
            declarativeMatches.sort((a, b) => b.priority - a.priority || b.score - a.score);
            const best = declarativeMatches[0];
            const skill = this.skills.get(best.name);
            if (skill) {
                log.debug('声明式匹配命中', { skill: best.name, score: best.score, priority: best.priority });
                return skill;
            }
        }
        // 2. 回退：传统 canHandle 匹配（向后兼容）
        for (const skill of this.skills.values()) {
            if (skill.canHandle(requirement)) {
                return skill;
            }
        }
        return null;
    }
    /**
     * 评估声明式匹配规则的得分
     * 返回 0 表示不匹配，>0 表示匹配度
     */
    evaluateMatchRule(rule, req) {
        let score = 0;
        // type 匹配
        if (rule.type) {
            const types = Array.isArray(rule.type) ? rule.type : [rule.type];
            if (types.includes(req.type))
                score += 10;
            else
                return 0; // type 不匹配直接排除
        }
        // entity 匹配
        if (rule.entity) {
            const entities = Array.isArray(rule.entity) ? rule.entity : [rule.entity];
            if (entities.includes(req.entity))
                score += 5;
            else
                return 0;
        }
        // scope 匹配
        if (rule.scope) {
            const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
            if (scopes.includes(req.scope))
                score += 3;
            else
                return 0;
        }
        // description 关键词匹配
        if (rule.descriptionContains) {
            const keywords = Array.isArray(rule.descriptionContains) ? rule.descriptionContains : [rule.descriptionContains];
            const descLower = req.description.toLowerCase();
            for (const kw of keywords) {
                if (descLower.includes(kw.toLowerCase()))
                    score += 1;
            }
        }
        return score;
    }
    /**
     * 获取所有已注册的 Skill
     */
    getAll() {
        return Array.from(this.skills.values());
    }
    /**
     * 加载单个 Skill 文件
     */
    async loadSkill(path, name) {
        const content = await readFile(path, 'utf-8');
        const { frontmatter, body } = this.parseFrontmatter(content);
        return {
            name: frontmatter.name ?? name,
            description: frontmatter.description ?? '',
            canHandle: this.buildCanHandle(frontmatter.canHandle),
            execute: this.buildExecutor(body),
            prompt: body,
        };
    }
    /**
     * 从 skill body 构建执行器
     * 将 skill prompt 作为 system prompt，让 LLM 根据需求生成代码
     * Function Calling 优先路径，复用 CODING_TOOLS
     */
    buildExecutor(prompt) {
        return async (requirement, projectContext) => {
            if (!this.llmClient) {
                throw new Error('SkillRegistry 未注入 LLMClient，请先调用 setLLMClient()');
            }
            const systemPrompt = `你是代码生成专家。根据以下 Skill 模板和项目上下文，生成需要修改的文件的完整代码。

Skill 模板：
${prompt}

规则：
1. 输出每个文件的完整内容（不是 diff）
2. 保持原有代码风格
3. 只修改必要的内容`;
            const userMessage = `需求：\n${JSON.stringify(requirement, null, 2)}\n\n项目上下文：\n${JSON.stringify(projectContext, null, 2)}`;
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ];
            const response = await this.llmClient.chat(messages, {
                tools: CODING_TOOLS,
                agent: 'skill',
                maxTokens: 16384,
            });
            // 优先从 toolCalls 直接取结果
            if (response.toolCalls && response.toolCalls.length > 0) {
                const tc = response.toolCalls[0];
                if (tc.name === 'submit_files' && typeof tc.arguments === 'object' && tc.arguments !== null && tc.arguments.files) {
                    console.log('[skill] 使用 function calling 直接返回文件列表');
                    return tc.arguments.files;
                }
            }
            // Fallback：旧的解析逻辑兜底
            console.log('[skill] function calling 未命中，使用 fallback 解析');
            return this.parseSkillOutput(response.content);
        };
    }
    /**
     * 解析 LLM 输出为 SkillOutput 数组
     */
    parseSkillOutput(response) {
        // 尝试直接解析 JSON 数组
        try {
            const parsed = JSON.parse(response);
            if (Array.isArray(parsed)) {
                return this.normalizeOutputs(parsed);
            }
            if (parsed.files && Array.isArray(parsed.files)) {
                return this.normalizeOutputs(parsed.files);
            }
            if (parsed.path && parsed.content) {
                return [parsed];
            }
        }
        catch { }
        // 提取 JSON 块
        const jsonMatch = response.match(/```(?:json)?\n([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                if (Array.isArray(parsed))
                    return this.normalizeOutputs(parsed);
                return [parsed];
            }
            catch { }
        }
        // 提取花括号包裹的 JSON 对象
        const braceMatch = response.match(/\[[\s\S]*\]/);
        if (braceMatch) {
            try {
                const parsed = JSON.parse(braceMatch[0]);
                if (Array.isArray(parsed))
                    return this.normalizeOutputs(parsed);
            }
            catch { }
        }
        // 提取代码块作为单个文件
        const codeMatch = response.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
        if (codeMatch) {
            return [{
                    path: 'generated-code.js',
                    content: codeMatch[1].trim(),
                    summary: 'Skill 生成的代码',
                }];
        }
        return [{
                path: 'generated-output.txt',
                content: response,
                summary: 'Skill 原始输出',
            }];
    }
    /**
     * 标准化输出格式，确保每个条目都有 path、content、summary
     */
    normalizeOutputs(items) {
        return items
            .filter(item => item && (item.path || item.filePath || item.file))
            .map(item => ({
            path: item.path ?? item.filePath ?? item.file ?? 'unknown.js',
            content: item.content ?? item.code ?? '',
            summary: item.summary ?? item.description ?? '',
        }));
    }
    /**
     * 解析 YAML frontmatter
     */
    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match)
            return { frontmatter: {}, body: content };
        const frontmatter = {};
        for (const line of match[1].split('\n')) {
            const [key, ...valueParts] = line.split(':');
            if (key && valueParts.length > 0) {
                frontmatter[key.trim()] = valueParts.join(':').trim();
            }
        }
        return { frontmatter, body: match[2] };
    }
    /**
     * 构建 canHandle 函数（向后兼容，新代码应使用声明式 SkillMatchRule）
     */
    buildCanHandle(expression) {
        if (!expression)
            return () => false;
        // 尝试解析为声明式规则
        const rule = this.tryParseAsMatchRule(expression);
        if (rule) {
            return (req) => this.evaluateMatchRule(rule, req) > 0;
        }
        // 回退：旧式正则匹配
        const match = expression.match(/(?:requirement|req)\.type\s*={2,3}\s*['"](\w+)['"]/);
        if (match) {
            return (req) => req.type === match[1];
        }
        const typeNames = ['add_field', 'add_page', 'modify_api', 'delete_field', 'delete_page'];
        for (const name of typeNames) {
            if (expression.includes(name)) {
                return (req) => req.type === name;
            }
        }
        return () => false;
    }
    /**
     * 尝试将 SKILL.md 中的 canHandle 字符串解析为声明式规则
     * 支持格式："type:add_field,add_page scope:frontend"
     */
    tryParseAsMatchRule(expression) {
        const rule = {};
        let hasAny = false;
        // type:xxx,yyy
        const typeMatch = expression.match(/type:\s*([\w,]+)/);
        if (typeMatch) {
            rule.type = typeMatch[1].split(',').map(s => s.trim());
            hasAny = true;
        }
        // entity:xxx,yyy
        const entityMatch = expression.match(/entity:\s*([\w,]+)/);
        if (entityMatch) {
            rule.entity = entityMatch[1].split(',').map(s => s.trim());
            hasAny = true;
        }
        // scope:frontend,backend
        const scopeMatch = expression.match(/scope:\s*([\w,]+)/);
        if (scopeMatch) {
            const scopes = scopeMatch[1].split(',').map(s => s.trim());
            rule.scope = scopes;
            hasAny = true;
        }
        return hasAny ? rule : null;
    }
}
//# sourceMappingURL=skill-registry.js.map