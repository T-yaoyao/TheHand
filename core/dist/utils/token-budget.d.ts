import type { TokenBudget } from '../types.js';
/**
 * Token 预算管理器
 *
 * 职责：
 * 1. 追踪 LLM 调用的 token 消耗
 * 2. 在接近上限时自动裁剪低优先级信息
 * 3. 提供预算余量查询
 *
 * 设计原则：
 * - 默认窗口 128K tokens（支持配置）
 * - 预留 16K 给输出
 * - 超过 80% 使用率时触发裁剪警告
 */
export declare class TokenBudgetManager {
    private budgets;
    private defaultMaxInput;
    private outputReserve;
    private warningThreshold;
    constructor(options?: {
        maxInputTokens?: number;
        outputReserveTokens?: number;
        warningThreshold?: number;
    });
    /**
     * 为指定阶段创建预算
     */
    createBudget(phase: string, maxInput?: number): TokenBudget;
    /**
     * 记录 token 消耗
     */
    record(phase: string, inputTokens: number, outputTokens?: number): void;
    /**
     * 获取当前预算状态
     */
    getBudget(phase: string): TokenBudget | null;
    /**
     * 检查是否超过警告阈值
     */
    isWarning(phase: string): boolean;
    /**
     * 检查是否已耗尽
     */
    isExhausted(phase: string): boolean;
    /**
     * 计算内容可容纳的最大字符数（粗略估算：1 token ≈ 4 字符）
     */
    getMaxCharsForPhase(phase: string): number;
    /**
     * 根据预算裁剪上下文信息
     * 优先级：核心指令 > 文件内容 > 错误信息 > 历史输出 > 文件列表
     */
    trimContext(parts: {
        priority: number;
        label: string;
        content: string;
    }[], phase: string): string[];
    /**
     * 获取所有阶段的预算摘要
     */
    getSummary(): Record<string, TokenBudget>;
    /**
     * 重置指定阶段或所有阶段的预算
     */
    reset(phase?: string): void;
}
//# sourceMappingURL=token-budget.d.ts.map