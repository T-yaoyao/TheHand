import type { AgentDefinition, AgentContext, AgentResult, Tool } from '../types.js';
import type { LLMClient } from '../llm/llm-client.js';
/**
 * Agent 执行器
 * 对标 Claude Code 的 runAgent()，包装 query() 循环
 */
export declare class AgentRunner {
    private llmClient;
    private toolPool;
    private sandboxPath;
    constructor(llmClient: LLMClient, toolPool: Tool[], sandboxPath?: string);
    /**
     * 执行指定 Agent：循环调用 LLM → 提取 tool_use → 执行工具 → 循环
     *
     * 支持两种模式：
     * 1. 无工具 Agent（如 clarification）：直接调 LLM，返回 content
     * 2. 有工具 Agent（如 plan/coding/test）：tool-use 循环
     */
    run(agent: AgentDefinition, context: AgentContext): Promise<AgentResult>;
    /**
     * 过滤当前 Agent 可用的工具
     */
    private filterToolsForAgent;
    private resolveSystemPrompt;
    /**
     * 构建用户消息：包含需求和项目上下文
     */
    private buildUserMessage;
    /**
     * 解析 LLM 输出为 JSON 对象
     */
    private parseOutput;
    /**
     * 压缩消息历史，保留最近 3 轮完整对话，早期轮次压缩为摘要
     * 解决长循环中 token 膨胀问题（如边界测试 Agent 的 13 轮灾难）
     */
    private compactMessages;
    /**
     * 将 Zod schema 转换为 JSON Schema（简化版）
     */
    private zodToJsonSchema;
}
//# sourceMappingURL=agent-runner.d.ts.map