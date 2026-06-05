import type { FilePlan, ProjectContext } from '../types.js';
import type { LLMClient, ToolDefinition } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
export interface CodeFileOutput {
    path: string;
    content: string;
    summary: string;
}
/**
 * 编码 Agent Function Calling 工具定义
 */
export declare const CODING_TOOLS: ToolDefinition[];
/**
 * 编码 Agent 定义（供 AgentRunner 等场景使用）
 */
export declare function createCodingAgent(): {
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
};
/**
 * 批量生成代码：一次 LLM 调用生成所有文件，agent 可以看到全局上下文
 */
export declare function runCoding(llmClient: LLMClient, promptManager: PromptManager, plan: FilePlan[], sandboxPath: string, projectContext?: ProjectContext, lessonsHint?: string, previousOutputs?: CodeFileOutput[], testError?: string): Promise<CodeFileOutput[]>;
/**
 * 解析单文件编码结果（兼容旧接口，已 deprecated）
 * @deprecated 请使用 Function Calling 批量获取文件
 */
export declare function parseCodingFileResponse(response: string, expectedPath: string, defaultSummary: string): CodeFileOutput | null;
//# sourceMappingURL=coding-agent.d.ts.map