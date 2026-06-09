import type { OrchestratorEvent, PhaseContext } from '../../types.js';
import { BasePhaseHandler } from '../phase-handler.js';
/**
 * 方案阶段处理器
 *
 * 职责：
 * - 基于结构化需求生成技术方案（FilePlan）
 * - 支持自愈重试（最多 3 轮）
 * - 风险评估和自然语言摘要生成
 */
export declare class PlanningPhase extends BasePhaseHandler {
    readonly name = "planning";
    private readonly MAX_RETRIES;
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    private buildDeleteHistoryHint;
    private scanExistingComponents;
    private parsePlan;
    private resolvePlanToExistingFiles;
    private listFilesRecursive;
}
//# sourceMappingURL=planning-phase.d.ts.map