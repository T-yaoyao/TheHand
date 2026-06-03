import type { StructuredRequirement, FilePlan, NaturalLanguageSummary } from '../types.js';
/**
 * 自然语言变更摘要生成器
 * 将技术方案翻译成 PM 能完全理解的大白话
 */
export declare class NaturalSummaryGenerator {
    generate(requirement: StructuredRequirement, plan: FilePlan[]): NaturalLanguageSummary;
    private generateTitle;
    private generateDescription;
    private generateChangesList;
    private generateImpact;
}
//# sourceMappingURL=natural-summary-generator.d.ts.map