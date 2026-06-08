/**
 * Prompt 预算管理器
 * 在拼装 prompt 前检查 token 预算，超限时自动截断
 */
export interface PromptBudgetConfig {
    /** 最大 context tokens（系统 prompt + 用户消息 + 预留输出空间） */
    maxContextTokens: number;
    /** 为输出预留的 token 数 */
    outputReserveTokens: number;
}
export declare class PromptBudget {
    private maxInputTokens;
    private usedTokens;
    constructor(config?: Partial<PromptBudgetConfig>);
    /** 获取可用于输入的 token 预算 */
    getMaxInputTokens(): number;
    /** 获取剩余可用 token 数 */
    getRemainingTokens(): number;
    /** 消耗 token 预算 */
    consume(text: string): number;
    /** 检查是否有足够预算 */
    hasBudgetFor(text: string): boolean;
    /**
     * 智能截断文本以适应预算
     * 保留头部（通常是最重要的指令）和尾部，截断中间部分
     */
    truncateToFit(text: string, maxTokens?: number): string;
    /**
     * 为文件内容列表分配预算
     * 按优先级排序，超出预算的文件会被截断或跳过
     */
    allocateForFiles(files: {
        path: string;
        content: string;
        priority?: number;
    }[], perFileMinTokens?: number): {
        path: string;
        content: string;
        truncated: boolean;
    }[];
}
//# sourceMappingURL=prompt-budget.d.ts.map