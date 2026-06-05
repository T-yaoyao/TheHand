import type { SkillDefinition, StructuredRequirement } from '../types.js';
import type { LLMClient } from '../llm/llm-client.js';
/**
 * Skill 注册与发现机制
 * 对标 Claude Code 的 getSkillDirCommands() + createSkillCommand()
 */
export declare class SkillRegistry {
    private skills;
    private llmClient;
    /**
     * 注入 LLM 客户端，使 skill 执行成为可能
     */
    setLLMClient(client: LLMClient): void;
    /**
     * 从项目目录自动发现并加载 Skills
     */
    discover(projectDir: string): Promise<void>;
    /**
     * 手动注册 Skill
     */
    register(skill: SkillDefinition): void;
    /**
     * 根据需求匹配 Skill
     */
    match(requirement: StructuredRequirement): SkillDefinition | null;
    /**
     * 获取所有已注册的 Skill
     */
    getAll(): SkillDefinition[];
    /**
     * 加载单个 Skill 文件
     */
    private loadSkill;
    /**
     * 从 skill body 构建执行器
     * 将 skill prompt 作为 system prompt，让 LLM 根据需求生成代码
     * Function Calling 优先路径，复用 CODING_TOOLS
     */
    private buildExecutor;
    /**
     * 解析 LLM 输出为 SkillOutput 数组
     */
    private parseSkillOutput;
    /**
     * 标准化输出格式，确保每个条目都有 path、content、summary
     */
    private normalizeOutputs;
    /**
     * 解析 YAML frontmatter
     */
    private parseFrontmatter;
    /**
     * 构建 canHandle 函数
     */
    private buildCanHandle;
}
//# sourceMappingURL=skill-registry.d.ts.map