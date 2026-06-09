import type { OrchestratorEvent, PhaseContext } from '../../types.js';
import { BasePhaseHandler } from '../phase-handler.js';
/**
 * 澄清阶段处理器
 *
 * 职责：
 * - 通过 LLM 与 PM 多轮对话，将模糊需求结构化为 StructuredRequirement
 * - 校验结构化需求的完整性
 * - 支持追问和确认流程
 */
export declare class ClarificationPhase extends BasePhaseHandler {
    readonly name = "clarification";
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    private handleNeedsMoreInfo;
    private handleDefaultedRequirement;
    private handleValidationFailure;
}
//# sourceMappingURL=clarification-phase.d.ts.map