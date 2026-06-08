/**
 * 澄清阶段
 * 从 PM 原始输入中提取结构化需求，最多 3 轮追问
 */
import type { Phase, PhaseContext } from '../phase.js';
import type { OrchestratorEvent } from '../../types.js';
export declare class ClarifyPhase implements Phase {
    readonly name = "clarify";
    run(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
//# sourceMappingURL=clarify-phase.d.ts.map