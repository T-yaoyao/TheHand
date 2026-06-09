import type { RequirementStatus, Requirement } from '../types.js'

/**
 * 显式状态机：定义合法的状态转换
 * 
 * 所有状态变更必须通过 transition() 函数执行，确保：
 * 1. 只有合法的转换被允许
 * 2. 每次转换被记录到日志
 * 3. 非法转换抛出错误而非静默失败
 */

/** 合法状态转换表 */
export const VALID_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  'idle':               ['clarifying', 'failed'],
  'clarifying':         ['waiting-for-pm', 'needs-confirmation', 'clarified', 'failed'],
  'waiting-for-pm':     ['clarifying', 'needs-confirmation', 'failed'],
  'needs-confirmation': ['clarifying', 'clarified', 'failed'],
  'clarified':          ['planning', 'failed'],
  'planning':           ['plan-ready', 'failed'],
  'plan-ready':         ['planning', 'coding', 'failed'],
  'plan-approved':      ['coding', 'failed'],
  'plan-rejected':      ['planning', 'clarifying', 'failed'],
  'coding':             ['testing', 'diff-ready', 'failed'],
  'testing':            ['coding', 'diff-ready', 'failed'],
  'diff-ready':         ['done', 'coding', 'failed'],
  'done':               [],
  'failed':             ['idle', 'clarifying', 'planning', 'coding'],
  'reverted':           ['idle', 'clarifying'],
}

/** 终态集合 */
export const TERMINAL_STATES: ReadonlySet<RequirementStatus> = new Set(['done', 'failed'])

/** 暂停点集合（保留沙箱，等待用户操作） */
export const PAUSE_POINTS: ReadonlySet<RequirementStatus> = new Set([
  'waiting-for-pm',
  'needs-confirmation',
  'plan-ready',
  'diff-ready',
])

/**
 * 执行状态转换：校验合法性 → 更新 requirement.status → 返回旧状态
 * @throws Error 非法转换
 */
export function transition(
  requirement: Requirement,
  to: RequirementStatus,
  reason?: string,
): RequirementStatus {
  const from = requirement.status

  if (!canTransition(from, to)) {
    throw new StateTransitionError(
      `非法状态转换: ${from} → ${to}` + (reason ? ` (${reason})` : ''),
      from,
      to,
    )
  }

  requirement.status = to
  requirement.updatedAt = new Date()

  return from
}

/**
 * 检查状态转换是否合法（不执行转换）
 */
export function canTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * 检查是否为终态
 */
export function isTerminal(status: RequirementStatus): boolean {
  return TERMINAL_STATES.has(status)
}

/**
 * 检查是否为暂停点（需要保留沙箱）
 */
export function isPausePoint(status: RequirementStatus): boolean {
  return PAUSE_POINTS.has(status)
}

/**
 * 获取从当前状态可以到达的所有合法状态
 */
export function getValidNextStates(status: RequirementStatus): RequirementStatus[] {
  return VALID_TRANSITIONS[status] ?? []
}

/**
 * 状态转换错误
 */
export class StateTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: RequirementStatus,
    public readonly to: RequirementStatus,
  ) {
    super(message)
    this.name = 'StateTransitionError'
  }
}
