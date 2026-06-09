import type { OrchestratorEvent, PhaseContext } from '../../types.js';
import { BasePhaseHandler } from '../phase-handler.js';
/**
 * 编码阶段处理器
 *
 * 职责：
 * - Architect 分析依赖 + 分批
 * - 分批 Coding（LLM 生成代码）
 * - 多层校验（依赖、退化、孤立组件、路由一致性、import 解析）
 * - 写入沙箱 + Diff 验证
 * - 最多 3 轮重试
 */
export declare class CodingPhase extends BasePhaseHandler {
    readonly name = "coding";
    private readonly MAX_RETRIES;
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    private runCodingBatches;
    private checkDependencyViolations;
    private validateFiles;
    private checkRegressions;
    private checkOrphanComponents;
    private checkOutletNavViolations;
    private checkRelativeImportViolations;
    private writeFilesToSandbox;
    private failRequirement;
}
//# sourceMappingURL=coding-phase.d.ts.map