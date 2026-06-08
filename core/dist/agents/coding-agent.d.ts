import type { FilePlan, ProjectContext, ChangeBatch, FileInterface, ArchitectFileAnalysis, CrossFileRef } from '../types.js';
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
 * 分批生成代码：只生成一个 batch 的文件，带精简上下文
 * 用于纯代码分批策略下的单批次执行
 */
export declare function runCodingBatch(llmClient: LLMClient, promptManager: PromptManager, batch: ChangeBatch, plan: FilePlan[], fileInterfaces: FileInterface[], generatedSummaries: Map<string, string>, sandboxPath: string, projectContext?: ProjectContext, errorHint?: string, architectFiles?: ArchitectFileAnalysis[], crossFileRefs?: CrossFileRef[], globalContext?: string): Promise<CodeFileOutput[]>;
/**
 * 从已生成的代码中提取接口摘要，供后续 batch 参考
 * 只提取 exports 和关键接口，不传全文
 */
export declare function extractInterfaceSummary(output: CodeFileOutput): string;
/**
 * 从沙箱中的 package.json 文件提取所有可用依赖名
 */
export declare function extractAvailableDependencies(sandboxPath: string): Promise<Set<string>>;
/**
 * 验证生成的代码是否使用了未安装的依赖
 * 返回违规的 import 列表（空数组表示全部合法）
 */
export declare function validateImports(outputs: CodeFileOutput[], availableDeps: Set<string>): {
    file: string;
    imp: string;
}[];
/**
 * 解析单文件编码结果（兼容旧接口，已 deprecated）
 * @deprecated 请使用 Function Calling 批量获取文件
 */
export declare function parseCodingFileResponse(response: string, expectedPath: string, defaultSummary: string): CodeFileOutput | null;
//# sourceMappingURL=coding-agent.d.ts.map