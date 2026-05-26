/**
 * 工具执行管线
 * 对标 Claude Code 的 runTools() + partitionToolCalls()
 */
export class ToolPipeline {
    toolPool;
    context;
    constructor(toolPool, context) {
        this.toolPool = toolPool;
        this.context = context;
    }
    /**
     * 执行工具调用列表，自动分区并发/串行
     */
    async execute(toolUseBlocks) {
        const batches = this.partitionByConcurrency(toolUseBlocks);
        const results = [];
        for (const batch of batches) {
            if (batch.isConcurrent) {
                const batchResults = await Promise.all(batch.items.map(item => this.executeSingle(item)));
                results.push(...batchResults);
            }
            else {
                for (const item of batch.items) {
                    results.push(await this.executeSingle(item));
                }
            }
        }
        return results;
    }
    /**
     * 单个工具执行：Schema 校验 → 语义校验 → 权限检查 → 执行
     */
    async executeSingle(item) {
        const tool = this.toolPool.find(t => t.name === item.name);
        if (!tool) {
            return { type: 'error', content: `未知工具: ${item.name}` };
        }
        // 1. Schema 校验
        const parsed = tool.inputSchema.safeParse(item.input);
        if (!parsed.success) {
            return { type: 'error', content: `输入校验失败: ${parsed.error.message}` };
        }
        // 2. 执行
        try {
            return await tool.call(parsed.data, this.context);
        }
        catch (e) {
            return { type: 'error', content: `执行失败: ${e.message}` };
        }
    }
    /**
     * 对标 Claude Code 的 partitionToolCalls()
     * 连续的并发安全工具合并为一个并发批次，不安全的工具单独串行
     */
    partitionByConcurrency(blocks) {
        const batches = [];
        let currentConcurrent = [];
        for (const block of blocks) {
            const tool = this.toolPool.find(t => t.name === block.name);
            if (tool?.isConcurrencySafe) {
                currentConcurrent.push(block);
            }
            else {
                if (currentConcurrent.length > 0) {
                    batches.push({ isConcurrent: true, items: currentConcurrent });
                    currentConcurrent = [];
                }
                batches.push({ isConcurrent: false, items: [block] });
            }
        }
        if (currentConcurrent.length > 0) {
            batches.push({ isConcurrent: true, items: currentConcurrent });
        }
        return batches;
    }
}
//# sourceMappingURL=tool-pipeline.js.map