import { PRICING_CNY_PER_MILLION, TOKENS_PER_MILLION } from '../config.js';
/**
 * 按 config 中的单价估算单次或累计 LLM 费用（人民币，元）
 */
export function estimateLlmCostCny(inputTokens, outputTokens) {
    return ((inputTokens / TOKENS_PER_MILLION) * PRICING_CNY_PER_MILLION.input +
        (outputTokens / TOKENS_PER_MILLION) * PRICING_CNY_PER_MILLION.output);
}
//# sourceMappingURL=llm-cost.js.map