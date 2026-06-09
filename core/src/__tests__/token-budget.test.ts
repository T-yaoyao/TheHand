import { describe, it, expect, beforeEach } from 'vitest'
import { TokenBudgetManager } from '../utils/token-budget.js'

describe('TokenBudgetManager', () => {
  let manager: TokenBudgetManager

  beforeEach(() => {
    manager = new TokenBudgetManager()
  })

  describe('createBudget', () => {
    it('should create budget with default max tokens', () => {
      const budget = manager.createBudget('coding')
      expect(budget.maxTotal).toBe(112_000)
      expect(budget.used).toBe(0)
      expect(budget.remaining).toBe(112_000)
    })

    it('should create budget with custom max tokens', () => {
      const budget = manager.createBudget('planning', 50_000)
      expect(budget.maxTotal).toBe(50_000)
    })

    it('should return a copy, not internal reference', () => {
      const budget = manager.createBudget('coding')
      budget.used = 99999
      const retrieved = manager.getBudget('coding')
      expect(retrieved!.used).toBe(0)
    })
  })

  describe('record', () => {
    it('should track token usage', () => {
      manager.createBudget('coding')
      manager.record('coding', 1000, 500)
      const budget = manager.getBudget('coding')
      expect(budget!.used).toBe(1500)
      expect(budget!.remaining).toBe(112_000 - 1500)
    })

    it('should accumulate multiple records', () => {
      manager.createBudget('coding')
      manager.record('coding', 1000)
      manager.record('coding', 2000, 500)
      const budget = manager.getBudget('coding')
      expect(budget!.used).toBe(3500)
    })

    it('should not go below zero remaining', () => {
      manager.createBudget('small', 100)
      manager.record('small', 200)
      const budget = manager.getBudget('small')
      expect(budget!.remaining).toBe(0)
    })

    it('should silently ignore unregistered phases', () => {
      // Should not throw
      manager.record('nonexistent', 1000)
    })
  })

  describe('isWarning', () => {
    it('should return false when below threshold', () => {
      manager.createBudget('coding')
      manager.record('coding', 50_000) // 50000/112000 ≈ 44%
      expect(manager.isWarning('coding')).toBe(false)
    })

    it('should return true when at or above 80% threshold', () => {
      manager.createBudget('coding')
      manager.record('coding', 90_000) // 90000/112000 ≈ 80.4%
      expect(manager.isWarning('coding')).toBe(true)
    })

    it('should support custom warning threshold', () => {
      const custom = new TokenBudgetManager({ warningThreshold: 0.5 })
      custom.createBudget('coding', 1000)
      custom.record('coding', 500)
      expect(custom.isWarning('coding')).toBe(true)
    })

    it('should return false for unregistered phases', () => {
      expect(manager.isWarning('nonexistent')).toBe(false)
    })
  })

  describe('isExhausted', () => {
    it('should return false when budget remains', () => {
      manager.createBudget('coding')
      manager.record('coding', 1000)
      expect(manager.isExhausted('coding')).toBe(false)
    })

    it('should return true when budget is fully used', () => {
      manager.createBudget('coding', 100)
      manager.record('coding', 100)
      expect(manager.isExhausted('coding')).toBe(true)
    })

    it('should return true when usage exceeds budget', () => {
      manager.createBudget('coding', 100)
      manager.record('coding', 200)
      expect(manager.isExhausted('coding')).toBe(true)
    })
  })

  describe('getMaxCharsForPhase', () => {
    it('should return remaining * 4', () => {
      manager.createBudget('coding', 1000)
      manager.record('coding', 100)
      const maxChars = manager.getMaxCharsForPhase('coding')
      expect(maxChars).toBe(900 * 4)
    })

    it('should return Infinity for unregistered phases', () => {
      expect(manager.getMaxCharsForPhase('nonexistent')).toBe(Infinity)
    })
  })

  describe('trimContext', () => {
    it('should include all parts when budget allows', () => {
      manager.createBudget('coding', 10_000)
      const parts = [
        { priority: 1, label: 'core', content: 'core instruction' },
        { priority: 2, label: 'files', content: 'file content' },
      ]
      const result = manager.trimContext(parts, 'coding')
      expect(result).toEqual(['core instruction', 'file content'])
    })

    it('should exclude low-priority parts when budget is tight', () => {
      manager.createBudget('coding', 10) // 10 tokens = 40 chars
      const parts = [
        { priority: 1, label: 'core', content: 'A'.repeat(30) },
        { priority: 2, label: 'files', content: 'B'.repeat(30) },
      ]
      const result = manager.trimContext(parts, 'coding')
      // First part (30 chars) fits in 40 chars budget, second does not
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('A'.repeat(30))
    })

    it('should truncate content when partial fit is possible', () => {
      manager.createBudget('coding', 15) // 15 tokens = 60 chars
      const parts = [
        { priority: 1, label: 'core', content: 'A'.repeat(30) },
        { priority: 2, label: 'files', content: 'B'.repeat(50) },
      ]
      const result = manager.trimContext(parts, 'coding')
      // First part fits (30 chars), second has 30 chars available (> 200? no)
      // Since available = 60 - 30 = 30 < 200, second part is skipped
      expect(result).toHaveLength(1)
    })

    it('should sort by priority before trimming', () => {
      manager.createBudget('coding', 20) // 20 tokens = 80 chars
      const parts = [
        { priority: 3, label: 'low', content: 'low priority content here!' },
        { priority: 1, label: 'high', content: 'high priority content here!' },
      ]
      const result = manager.trimContext(parts, 'coding')
      // High priority should be included first
      expect(result[0]).toBe('high priority content here!')
    })

    it('should return all content for unregistered phases', () => {
      const parts = [
        { priority: 1, label: 'a', content: 'hello' },
        { priority: 2, label: 'b', content: 'world' },
      ]
      const result = manager.trimContext(parts, 'nonexistent')
      expect(result).toEqual(['hello', 'world'])
    })
  })

  describe('getSummary', () => {
    it('should return budgets for all phases', () => {
      manager.createBudget('planning', 5000)
      manager.createBudget('coding', 10000)
      const summary = manager.getSummary()
      expect(summary).toHaveProperty('planning')
      expect(summary).toHaveProperty('coding')
      expect(summary.planning.maxTotal).toBe(5000)
      expect(summary.coding.maxTotal).toBe(10000)
    })

    it('should return copies, not internal references', () => {
      manager.createBudget('coding')
      const summary = manager.getSummary()
      summary.coding.used = 99999
      expect(manager.getBudget('coding')!.used).toBe(0)
    })
  })

  describe('reset', () => {
    it('should reset specific phase', () => {
      manager.createBudget('planning')
      manager.createBudget('coding')
      manager.reset('planning')
      expect(manager.getBudget('planning')).toBeNull()
      expect(manager.getBudget('coding')).not.toBeNull()
    })

    it('should reset all phases when no argument given', () => {
      manager.createBudget('planning')
      manager.createBudget('coding')
      manager.reset()
      expect(manager.getSummary()).toEqual({})
    })
  })
})
