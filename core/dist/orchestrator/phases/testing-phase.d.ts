import type { OrchestratorEvent, PhaseContext } from '../../types.js';
import { BasePhaseHandler } from '../phase-handler.js';
/**
 * 测试阶段处理器
 *
 * 职责：
 * - 运行 lint、单测、构建
 * - 环境错误分类（直接失败 vs 代码重试）
 * - 边界测试生成（非阻断性）
 * - Diff 安全检查
 * - 成功后进入 diff-ready 暂停
 */
export declare class TestingPhase extends BasePhaseHandler {
    readonly name = "testing";
    private readonly MAX_RETRIES;
    /** 环境错误模式：非代码问题，重试无法解决 */
    private static readonly ENV_ERROR_PATTERNS;
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    private runBoundaryTests;
    private generateDiffAndPause;
}
//# sourceMappingURL=testing-phase.d.ts.map