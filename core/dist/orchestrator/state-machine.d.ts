import type { RequirementStatus, Requirement } from '../types.js';
/**
 * 显式状态机：定义合法的状态转换
 *
 * 所有状态变更必须通过 transition() 函数执行，确保：
 * 1. 只有合法的转换被允许
 * 2. 每次转换被记录到日志
 * 3. 非法转换抛出错误而非静默失败
 */
/** 合法状态转换表 */
export declare const VALID_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]>;
/** 终态集合 */
export declare const TERMINAL_STATES: ReadonlySet<RequirementStatus>;
/** 暂停点集合（保留沙箱，等待用户操作） */
export declare const PAUSE_POINTS: ReadonlySet<RequirementStatus>;
/**
 * 执行状态转换：校验合法性 → 更新 requirement.status → 返回旧状态
 * @throws Error 非法转换
 */
export declare function transition(requirement: Requirement, to: RequirementStatus, reason?: string): RequirementStatus;
/**
 * 检查状态转换是否合法（不执行转换）
 */
export declare function canTransition(from: RequirementStatus, to: RequirementStatus): boolean;
/**
 * 检查是否为终态
 */
export declare function isTerminal(status: RequirementStatus): boolean;
/**
 * 检查是否为暂停点（需要保留沙箱）
 */
export declare function isPausePoint(status: RequirementStatus): boolean;
/**
 * 获取从当前状态可以到达的所有合法状态
 */
export declare function getValidNextStates(status: RequirementStatus): RequirementStatus[];
/**
 * 状态转换错误
 */
export declare class StateTransitionError extends Error {
    readonly from: RequirementStatus;
    readonly to: RequirementStatus;
    constructor(message: string, from: RequirementStatus, to: RequirementStatus);
}
//# sourceMappingURL=state-machine.d.ts.map