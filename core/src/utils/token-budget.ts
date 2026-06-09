import type { TokenBudget } from '../types.js'

/**
 * Token 预算管理器
 * 
 * 职责：
 * 1. 追踪 LLM 调用的 token 消耗
 * 2. 在接近上限时自动裁剪低优先级信息
 * 3. 提供预算余量查询
 * 
 * 设计原则：
 * - 默认窗口 128K tokens（支持配置）
 * - 预留 16K 给输出
 * - 超过 80% 使用率时触发裁剪警告
 */
export class TokenBudgetManager {
  private budgets: Map<string, TokenBudget> = new Map()
  private defaultMaxInput: number
  private outputReserve: number
  private warningThreshold: number

  constructor(options?: {
    maxInputTokens?: number
    outputReserveTokens?: number
    warningThreshold?: number
  }) {
    this.defaultMaxInput = options?.maxInputTokens ?? 112_000  // 128K - 16K output reserve
    this.outputReserve = options?.outputReserveTokens ?? 16_000
    this.warningThreshold = options?.warningThreshold ?? 0.8
  }

  /**
   * 为指定阶段创建预算
   */
  createBudget(phase: string, maxInput?: number): TokenBudget {
    const budget: TokenBudget = {
      maxTotal: maxInput ?? this.defaultMaxInput,
      used: 0,
      remaining: maxInput ?? this.defaultMaxInput,
    }
    this.budgets.set(phase, budget)
    return { ...budget }
  }

  /**
   * 记录 token 消耗
   */
  record(phase: string, inputTokens: number, outputTokens: number = 0): void {
    const budget = this.budgets.get(phase)
    if (!budget) return

    budget.used += inputTokens + outputTokens
    budget.remaining = Math.max(0, budget.maxTotal - budget.used)
  }

  /**
   * 获取当前预算状态
   */
  getBudget(phase: string): TokenBudget | null {
    const budget = this.budgets.get(phase)
    return budget ? { ...budget } : null
  }

  /**
   * 检查是否超过警告阈值
   */
  isWarning(phase: string): boolean {
    const budget = this.budgets.get(phase)
    if (!budget) return false
    return budget.used / budget.maxTotal >= this.warningThreshold
  }

  /**
   * 检查是否已耗尽
   */
  isExhausted(phase: string): boolean {
    const budget = this.budgets.get(phase)
    if (!budget) return false
    return budget.remaining <= 0
  }

  /**
   * 计算内容可容纳的最大字符数（粗略估算：1 token ≈ 4 字符）
   */
  getMaxCharsForPhase(phase: string): number {
    const budget = this.budgets.get(phase)
    if (!budget) return Infinity
    return budget.remaining * 4
  }

  /**
   * 根据预算裁剪上下文信息
   * 优先级：核心指令 > 文件内容 > 错误信息 > 历史输出 > 文件列表
   */
  trimContext(parts: { priority: number; label: string; content: string }[], phase: string): string[] {
    const budget = this.budgets.get(phase)
    if (!budget) return parts.map(p => p.content)

    const maxChars = budget.remaining * 4
    let currentChars = 0
    const result: string[] = []

    // 按优先级排序（数字越小优先级越高）
    const sorted = [...parts].sort((a, b) => a.priority - b.priority)

    for (const part of sorted) {
      const partChars = part.content.length
      if (currentChars + partChars <= maxChars) {
        result.push(part.content)
        currentChars += partChars
      } else {
        // 尝试截断
        const available = maxChars - currentChars
        if (available > 200) {
          const truncated = part.content.slice(0, available - 50) + '\n...(上下文预算不足，已截断)'
          result.push(truncated)
          currentChars += truncated.length
        }
        // 否则完全跳过该部分
      }
    }

    return result
  }

  /**
   * 获取所有阶段的预算摘要
   */
  getSummary(): Record<string, TokenBudget> {
    const summary: Record<string, TokenBudget> = {}
    for (const [phase, budget] of this.budgets) {
      summary[phase] = { ...budget }
    }
    return summary
  }

  /**
   * 重置指定阶段或所有阶段的预算
   */
  reset(phase?: string): void {
    if (phase) {
      this.budgets.delete(phase)
    } else {
      this.budgets.clear()
    }
  }
}
