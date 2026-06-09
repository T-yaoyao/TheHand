import type { OrchestratorEvent, PhaseContext } from '../../types.js';
import { BasePhaseHandler } from '../phase-handler.js';
/**
 * 提交阶段处理器
 *
 * 职责：
 * - 将沙箱中的代码提交到 git
 * - 应用变更到源仓库
 * - 标记需求为 done
 */
export declare class CommitPhase extends BasePhaseHandler {
    readonly name = "commit";
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
//# sourceMappingURL=commit-phase.d.ts.map