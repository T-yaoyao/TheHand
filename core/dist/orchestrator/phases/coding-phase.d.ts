/**
 * 编码+测试阶段
 * Architect 分析 → 分批编码 → 文件校验 → 测试 → Diff 生成
 *
 * 支持三种输出模式：
 * 1. 全量重写（默认）- AI 输出完整文件
 * 2. __APPEND__ 追加 - CSS 等大文件只追加新内容
 * 3. __PATCH__ 手术式编辑 - diff-safety 失败后自动切换，AI 只输出要改的行
 */
import type { Phase, PhaseContext } from '../phase.js';
import type { OrchestratorEvent } from '../../types.js';
export declare class CodingPhase implements Phase {
    readonly name = "coding";
    run(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    /**
     * 手术式 Patch 模式
     * 当全量重写反复触发 diff-safety 时，改用此模式
     * AI 只输出要插入/替换的具体行，系统做精确手术
     */
    private runPatchMode;
    /** 安全调用 runCodingBatch，捕获异常 */
    private runCodingBatchSafe;
    private checkOrphanComponents;
    private cleanOrigFiles;
}
//# sourceMappingURL=coding-phase.d.ts.map