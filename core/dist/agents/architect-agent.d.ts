import type { FilePlan, FileInterface, ChangeBatch, ArchitectOutput, ProjectContext, StructuredRequirement } from '../types.js';
import type { AgentDefinition } from '../types.js';
import type { ToolDefinition } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
import type { AgentRunner } from './agent-runner.js';
export declare const ARCHITECT_OUTPUT_TOOL: ToolDefinition;
/**
 * 用正则提取文件的接口信息
 * 只读 imports 等骨架行，不关注实现细节
 */
export declare function extractFileInterfaces(sandboxPath: string, plan: FilePlan[]): Promise<FileInterface[]>;
/**
 * 创建 Architect Agent 定义
 */
export declare function createArchitectAgent(systemPrompt: string): AgentDefinition;
/**
 * LLM Architect 主入口
 * 用大模型分析文件依赖、产出精确分批方案 + 详细改动指令
 *
 * @returns ArchitectOutput | null（LLM 失败时返回 null，调用方可降级到正则分批）
 */
export declare function runArchitect(agentRunner: AgentRunner, promptManager: PromptManager, plan: FilePlan[], sandboxPath: string, projectContext: ProjectContext, structuredRequirement: StructuredRequirement): Promise<ArchitectOutput | null>;
/**
 * 降级入口：基于依赖分析的纯代码分批
 * 零 LLM 消耗，确定性执行，不会失败
 * 当 LLM Architect 失败时作为 fallback 使用
 */
export declare function buildBatches(sandboxPath: string, plan: FilePlan[]): Promise<{
    batches: ChangeBatch[];
    fileInterfaces: FileInterface[];
}>;
//# sourceMappingURL=architect-agent.d.ts.map