import type { AgentDefinition, StructuredRequirement } from '../types.js';
import type { LLMClient, ToolDefinition } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
export interface ClarificationResult {
    requirement: StructuredRequirement;
    needsMoreInfo: boolean;
    questions: string[] | null;
    round: number;
}
/**
 * 澄清 Agent Function Calling 工具定义
 */
export declare const CLARIFICATION_TOOLS: ToolDefinition[];
/**
 * 澄清 Agent：识别模糊需求中的歧义，主动追问，输出结构化需求 JSON
 * 对标 PRD 中的状态机：idle → clarifying → clarified/failed
 */
export declare function createClarificationAgent(): AgentDefinition;
/**
 * 澄清 Agent 的实际执行逻辑
 * Function Calling 优先路径，保留旧解析作为 fallback
 */
export declare function runClarification(llmClient: LLMClient, promptManager: PromptManager, pmInput: string, projectContext: any, currentRequirement?: StructuredRequirement | null, round?: number, previousQuestions?: string[], pmReplies?: string[]): Promise<ClarificationResult>;
//# sourceMappingURL=clarification-agent.d.ts.map