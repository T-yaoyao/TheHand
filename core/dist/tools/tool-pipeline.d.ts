import type { Tool, ToolResult, ToolContext } from '../types.js';
interface ToolUseBlock {
    id: string;
    name: string;
    input: any;
}
/**
 * 工具执行管线
 * 对标 Claude Code 的 runTools() + partitionToolCalls()
 */
export declare class ToolPipeline {
    private toolPool;
    private context;
    constructor(toolPool: Tool[], context: ToolContext);
    /**
     * 执行工具调用列表，自动分区并发/串行
     */
    execute(toolUseBlocks: ToolUseBlock[]): Promise<ToolResult[]>;
    /**
     * 单个工具执行：Schema 校验 → 语义校验 → 权限检查 → 执行
     */
    private executeSingle;
    /**
     * 对标 Claude Code 的 partitionToolCalls()
     * 连续的并发安全工具合并为一个并发批次，不安全的工具单独串行
     */
    private partitionByConcurrency;
}
export {};
//# sourceMappingURL=tool-pipeline.d.ts.map