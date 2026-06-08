/**
 * Prompt 预算管理器
 * 在拼装 prompt 前检查 token 预算，超限时自动截断
 */
import { estimateTokens } from './token-estimator.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('llm:budget');
const DEFAULT_CONFIG = {
    maxContextTokens: 128_000, // 128k context
    outputReserveTokens: 16_384, // 16k output
};
export class PromptBudget {
    maxInputTokens;
    usedTokens = 0;
    constructor(config = {}) {
        const merged = { ...DEFAULT_CONFIG, ...config };
        this.maxInputTokens = merged.maxContextTokens - merged.outputReserveTokens;
    }
    /** 获取可用于输入的 token 预算 */
    getMaxInputTokens() {
        return this.maxInputTokens;
    }
    /** 获取剩余可用 token 数 */
    getRemainingTokens() {
        return Math.max(0, this.maxInputTokens - this.usedTokens);
    }
    /** 消耗 token 预算 */
    consume(text) {
        const tokens = estimateTokens(text);
        this.usedTokens += tokens;
        return tokens;
    }
    /** 检查是否有足够预算 */
    hasBudgetFor(text) {
        const tokens = estimateTokens(text);
        return (this.usedTokens + tokens) <= this.maxInputTokens;
    }
    /**
     * 智能截断文本以适应预算
     * 保留头部（通常是最重要的指令）和尾部，截断中间部分
     */
    truncateToFit(text, maxTokens) {
        const target = maxTokens ?? this.getRemainingTokens();
        const estimated = estimateTokens(text);
        if (estimated <= target) {
            this.consume(text);
            return text;
        }
        // 计算可保留的字符数（粗略）
        const avgCharsPerToken = text.length / estimated;
        const targetChars = Math.floor(target * avgCharsPerToken * 0.8); // 留 20% 余量
        const headChars = Math.floor(targetChars * 0.7); // 保留 70% 给头部
        const tailChars = Math.floor(targetChars * 0.3); // 保留 30% 给尾部
        const head = text.slice(0, headChars);
        const tail = text.slice(-tailChars);
        const result = `${head}\n\n...(内容已截断，超出 token 预算)...\n\n${tail}`;
        log.warn(`文本超出 token 预算，已截断: ${estimated} → ~${target} tokens`);
        this.consume(result);
        return result;
    }
    /**
     * 为文件内容列表分配预算
     * 按优先级排序，超出预算的文件会被截断或跳过
     */
    allocateForFiles(files, perFileMinTokens = 500) {
        const remaining = this.getRemainingTokens();
        const sorted = [...files].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
        const results = [];
        let budgetLeft = remaining;
        for (const file of sorted) {
            const fileTokens = estimateTokens(file.content);
            if (fileTokens <= perFileMinTokens) {
                // 极小文件，直接包含
                results.push({ ...file, truncated: false });
                budgetLeft -= fileTokens;
                continue;
            }
            if (budgetLeft < perFileMinTokens) {
                // 预算不足，跳过剩余文件
                log.warn(`token 预算不足，跳过文件: ${file.path} (剩余 ~${budgetLeft} tokens)`);
                break;
            }
            if (fileTokens <= budgetLeft) {
                // 预算充足，完整包含
                results.push({ ...file, truncated: false });
                budgetLeft -= fileTokens;
            }
            else {
                // 需要截断
                const avgCharsPerToken = file.content.length / fileTokens;
                const targetChars = Math.floor(budgetLeft * avgCharsPerToken * 0.8);
                const head = file.content.slice(0, Math.floor(targetChars * 0.8));
                const tail = file.content.slice(-Math.floor(targetChars * 0.2));
                const truncated = `${head}\n\n...(截断)...\n\n${tail}`;
                results.push({ path: file.path, content: truncated, truncated: true });
                budgetLeft -= estimateTokens(truncated);
            }
        }
        return results;
    }
}
//# sourceMappingURL=prompt-budget.js.map