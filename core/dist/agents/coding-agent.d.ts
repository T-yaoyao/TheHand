import type { FilePlan } from '../types.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
export interface CodeFileOutput {
    path: string;
    content: string;
    summary: string;
}
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
 * 按方案逐文件生成代码（与 cli.mjs 一致，避免 tool-use 循环输出不可解析）
 */
export declare function runCoding(llmClient: LLMClient, promptManager: PromptManager, plan: FilePlan[], sandboxPath: string): Promise<CodeFileOutput[]>;
/**
 * 解析单文件编码结果：JSON、markdown 代码块或纯文本
 */
export declare function parseCodingFileResponse(response: string, expectedPath: string, defaultSummary: string): CodeFileOutput | null;
//# sourceMappingURL=coding-agent.d.ts.map