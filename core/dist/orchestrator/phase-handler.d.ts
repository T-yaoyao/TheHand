import type { OrchestratorEvent, PhaseContext } from '../types.js';
/**
 * Phase Handler 接口：每个阶段实现此接口
 *
 * 职责：
 * - 执行单个阶段的完整逻辑
 * - 通过 AsyncGenerator 产出事件流
 * - 每个阶段可独立测试
 */
export interface PhaseHandler {
    /** 阶段名称，用于日志和事件标识 */
    readonly name: string;
    /**
     * 执行阶段逻辑
     * @param ctx 阶段共享上下文
     * @returns 事件流（AsyncGenerator）
     */
    execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
/**
 * Phase 基类：提供通用辅助方法
 */
export declare abstract class BasePhaseHandler implements PhaseHandler {
    abstract readonly name: string;
    abstract execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
    /**
     * 产出执行进度事件
     */
    protected progress(phase: string, progress: number, warnings?: string[]): OrchestratorEvent;
    /**
     * 产出状态变更事件
     */
    protected statusChange(status: import('../types.js').RequirementStatus, agent: string): OrchestratorEvent;
}
//# sourceMappingURL=phase-handler.d.ts.map