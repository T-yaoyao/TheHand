/**
 * 方案阶段
 * 根据结构化需求生成技术方案（FilePlan[]），含风险评估和自然语言摘要
 */
import type { Phase, PhaseContext } from '../phase.js';
import type { OrchestratorEvent } from '../../types.js';
export declare class PlanPhase implements Phase {
    readonly name = "plan";
    run(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
//# sourceMappingURL=plan-phase.d.ts.map