import type { StructuredRequirement, FilePlan, RiskAssessment } from '../types.js';
/**
 * 需求风险评估器
 * 自动评估需求的风险等级，低风险需求支持一键自动执行
 */
export declare class RiskAssessor {
    /**
     * 评估需求风险等级
     */
    assess(requirement: StructuredRequirement, plan: FilePlan[]): RiskAssessment;
    private getTypeScore;
    private getFileCountScore;
    private getScopeScore;
    private getEntityScore;
    private generateRecommendations;
    /**
     * 判断是否支持一键自动执行
     */
    canAutoApprove(assessment: RiskAssessment): boolean;
}
//# sourceMappingURL=risk-assessor.d.ts.map