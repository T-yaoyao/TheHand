/**
 * Prompt 模板管理器（版本化）
 * 对标 Claude Code 的 prompt 管理机制
 *
 * 目录结构：
 *   prompts/<agent-name>/v1.md
 *   prompts/<agent-name>/v2.md
 */
export declare class PromptManager {
    private cache;
    private promptsDir;
    constructor(promptsDir?: string);
    /**
     * 加载指定版本的 prompt 模板
     */
    load(agentName: string, version?: string): Promise<string>;
    /**
     * 获取某个 agent 的最新版本
     */
    getLatestVersion(agentName: string): Promise<string>;
    /**
     * 变量替换
     * 对标 Claude Code 的 substituteArguments
     * 支持 {{variable}} 语法
     */
    render(template: string, variables: Record<string, string>): string;
    /**
     * 加载 + 渲染
     */
    loadAndRender(agentName: string, variables: Record<string, string>, version?: string): Promise<string>;
    /**
     * 清除缓存（用于热更新 prompt）
     */
    clearCache(): void;
}
//# sourceMappingURL=prompt-manager.d.ts.map