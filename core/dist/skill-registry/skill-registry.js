import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
/**
 * Skill 注册与发现机制
 * 对标 Claude Code 的 getSkillDirCommands() + createSkillCommand()
 */
export class SkillRegistry {
    skills = new Map();
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
     * 手动注册 Skill
     */
    register(skill) {
        this.skills.set(skill.name, skill);
    }
    /**
     * 根据需求匹配 Skill
     */
    match(requirement) {
        for (const skill of this.skills.values()) {
            if (skill.canHandle(requirement)) {
                return skill;
            }
        }
        return null;
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
3. 只修改必要的内容
4. 必须输出 JSON 数组，每个元素包含 path、content、summary 三个字段
5. path 是相对于项目根目录的文件路径

输出格式（严格 JSON 数组）：
[
  {
    "path": "server/models/Article.js",
    "content": "完整的文件内容...",
    "summary": "新增 readingTime 字段"
  }
]`;
            const userMessage = `需求：\n${JSON.stringify(requirement, null, 2)}\n\n项目上下文：\n${JSON.stringify(projectContext, null, 2)}`;
            const response = await this.llmClient.simpleChat(systemPrompt, userMessage);
            // 解析 LLM 返回的文件列表
            return this.parseSkillOutput(response);
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
     * 构建 canHandle 函数
     */
    buildCanHandle(expression) {
        if (!expression)
            return () => false;
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
}
//# sourceMappingURL=skill-registry.js.map