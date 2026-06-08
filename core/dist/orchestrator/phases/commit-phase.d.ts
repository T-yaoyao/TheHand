/**
 * 提交阶段
 * Git commit + 应用到源仓库
 */
import type { Phase, PhaseContext } from '../phase.js';
import type { OrchestratorEvent } from '../../types.js';
export declare class CommitPhase implements Phase {
    readonly name = "commit";
    run(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
//# sourceMappingURL=commit-phase.d.ts.map