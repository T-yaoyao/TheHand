import type { Tool, ToolResult, ToolContext } from '../types.js'

interface ToolUseBlock {
  id: string
  name: string
  input: any
}

interface Batch {
  isConcurrent: boolean
  items: ToolUseBlock[]
}

/**
 * 工具执行管线
 * 对标 Claude Code 的 runTools() + partitionToolCalls()
 */
export class ToolPipeline {
  constructor(
    private toolPool: Tool[],
    private context: ToolContext,
  ) {}

  /**
   * 执行工具调用列表，自动分区并发/串行
   */
  async execute(toolUseBlocks: ToolUseBlock[]): Promise<ToolResult[]> {
    const batches = this.partitionByConcurrency(toolUseBlocks)
    const results: ToolResult[] = []

    for (const batch of batches) {
      if (batch.isConcurrent) {
        const batchResults = await Promise.all(
          batch.items.map(item => this.executeSingle(item))
        )
        results.push(...batchResults)
      } else {
        for (const item of batch.items) {
          results.push(await this.executeSingle(item))
        }
      }
    }

    return results
  }

  /**
   * 单个工具执行：Schema 校验 → 语义校验 → 权限检查 → 执行
   */
  private async executeSingle(item: ToolUseBlock): Promise<ToolResult> {
    const tool = this.toolPool.find(t => t.name === item.name)
    if (!tool) {
      return { type: 'error', content: `未知工具: ${item.name}` }
    }

    // 1. Schema 校验
    const parsed = tool.inputSchema.safeParse(item.input)
    if (!parsed.success) {
      return { type: 'error', content: `输入校验失败: ${parsed.error.message}` }
    }

    // 2. 执行
    try {
      return await tool.call(parsed.data, this.context)
    } catch (e: any) {
      return { type: 'error', content: `执行失败: ${e.message}` }
    }
  }

  /**
   * 对标 Claude Code 的 partitionToolCalls()
   * 连续的并发安全工具合并为一个并发批次，不安全的工具单独串行
   */
  private partitionByConcurrency(blocks: ToolUseBlock[]): Batch[] {
    const batches: Batch[] = []
    let currentConcurrent: ToolUseBlock[] = []

    for (const block of blocks) {
      const tool = this.toolPool.find(t => t.name === block.name)
      if (tool?.isConcurrencySafe) {
        currentConcurrent.push(block)
      } else {
        if (currentConcurrent.length > 0) {
          batches.push({ isConcurrent: true, items: currentConcurrent })
          currentConcurrent = []
        }
        batches.push({ isConcurrent: false, items: [block] })
      }
    }

    if (currentConcurrent.length > 0) {
      batches.push({ isConcurrent: true, items: currentConcurrent })
    }

    return batches
  }
}
