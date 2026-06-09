import type { SkillDefinition, StructuredRequirement, SkillMatchRule } from '../types.js';
import type { LLMClient } from '../llm/llm-client.js';
/**
 * Skill 注册与发现机制
 * 对标 Claude Code 的 getSkillDirCommands() + createSkillCommand()
 *
 * 支持两种匹配模式：
 * 1. 声明式 SkillMatchRule（推荐）：多维匹配 + 优先级排序
 * 2. 传统 canHandle 函数（向后兼容）
 */
export declare class SkillRegistry {
    private skills;
    /** 声明式匹配规则（优先级高于 canHandle） */
    private matchRules;
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
     * 注册 Skill（支持声明式匹配规则）
     */
    register(skill: SkillDefinition, matchRule?: SkillMatchRule): void;
    /**
     * 注销 Skill
     */
    unregister(name: string): boolean;
    /**
     * 根据需求匹配 Skill
     * 优先使用声明式匹配规则（多维 + 优先级排序），回退到 canHandle 函数
     */
    match(requirement: StructuredRequirement): SkillDefinition | null;
    /**
     * 评估声明式匹配规则的得分
     * 返回 0 表示不匹配，>0 表示匹配度
     */
    private evaluateMatchRule;
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
     * 构建 canHandle 函数（向后兼容，新代码应使用声明式 SkillMatchRule）
     */
    private buildCanHandle;
    /**
     * 尝试将 SKILL.md 中的 canHandle 字符串解析为声明式规则
     * 支持格式："type:add_field,add_page scope:frontend"
     */
    private tryParseAsMatchRule;
}
//# sourceMappingURL=skill-registry.d.ts.map