/**
 * Phase 基类：提供通用辅助方法
 */
export class BasePhaseHandler {
    /**
     * 产出执行进度事件
     */
    progress(phase, progress, warnings) {
        return { type: 'executing', phase, progress, warnings };
    }
    /**
     * 产出状态变更事件
     */
    statusChange(status, agent) {
        return { type: 'status-change', status, agent };
    }
}
//# sourceMappingURL=phase-handler.js.map