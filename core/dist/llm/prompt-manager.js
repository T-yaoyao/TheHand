import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
/**
 * Prompt 模板管理器（版本化）
 * 对标 Claude Code 的 prompt 管理机制
 *
 * 目录结构：
 *   prompts/<agent-name>/v1.md
 *   prompts/<agent-name>/v2.md
 */
export class PromptManager {
    cache = new Map();
    promptsDir;
    constructor(promptsDir) {
        this.promptsDir = promptsDir ?? resolve(process.cwd(), 'prompts');
    }
    /**
     * 加载指定版本的 prompt 模板
     */
    async load(agentName, version = 'v1') {
        const cacheKey = `${agentName}/${version}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const path = join(this.promptsDir, agentName, `${version}.md`);
        const content = await readFile(path, 'utf-8');
        this.cache.set(cacheKey, content);
        return content;
    }
    /**
     * 获取某个 agent 的最新版本
     */
    async getLatestVersion(agentName) {
        const agentDir = join(this.promptsDir, agentName);
        try {
            const files = await readdir(agentDir);
            const versions = files
                .filter(f => f.endsWith('.md'))
                .map(f => f.replace('.md', ''))
                .sort();
            return versions[versions.length - 1] ?? 'v1';
        }
        catch {
            return 'v1';
        }
    }
    /**
     * 变量替换
     * 对标 Claude Code 的 substituteArguments
     * 支持 {{variable}} 语法
     */
    render(template, variables) {
        let result = template;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        return result;
    }
    /**
     * 加载 + 渲染
     */
    async loadAndRender(agentName, variables, version) {
        const v = version ?? await this.getLatestVersion(agentName);
        const template = await this.load(agentName, v);
        return this.render(template, variables);
    }
    /**
     * 清除缓存（用于热更新 prompt）
     */
    clearCache() {
        this.cache.clear();
    }
}
//# sourceMappingURL=prompt-manager.js.map