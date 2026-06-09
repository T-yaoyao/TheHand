import { describe, it, expect } from 'vitest'
import {
  transition,
  canTransition,
  isTerminal,
  isPausePoint,
  getValidNextStates,
  VALID_TRANSITIONS,
  StateTransitionError,
} from '../orchestrator/state-machine.js'
import type { Requirement, RequirementStatus } from '../types.js'

function makeRequirement(status: RequirementStatus = 'idle'): Requirement {
  return {
    id: 'test-req-1',
    status,
    pmInput: 'test input',
    structuredRequirement: null,
    plan: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('State Machine', () => {
  describe('VALID_TRANSITIONS', () => {
    it('should define transitions for all statuses', () => {
      const allStatuses: RequirementStatus[] = [
        'idle', 'clarifying', 'clarified', 'waiting-for-pm', 'needs-confirmation',
        'planning', 'plan-ready', 'plan-approved', 'plan-rejected',
        'coding', 'testing', 'diff-ready', 'done', 'failed', 'reverted',
      ]
      for (const status of allStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status)
      }
    })

    it('done should have no outgoing transitions', () => {
      expect(VALID_TRANSITIONS['done']).toEqual([])
    })

    it('failed should allow recovery transitions', () => {
      const fromFailed = VALID_TRANSITIONS['failed']
      expect(fromFailed).toContain('idle')
      expect(fromFailed).toContain('clarifying')
    })
  })

  describe('canTransition', () => {
    it('should allow valid transitions', () => {
      expect(canTransition('idle', 'clarifying')).toBe(true)
      expect(canTransition('clarifying', 'waiting-for-pm')).toBe(true)
      expect(canTransition('clarifying', 'clarified')).toBe(true)
      expect(canTransition('planning', 'plan-ready')).toBe(true)
      expect(canTransition('plan-ready', 'coding')).toBe(true)
      expect(canTransition('coding', 'testing')).toBe(true)
      expect(canTransition('testing', 'diff-ready')).toBe(true)
      expect(canTransition('diff-ready', 'done')).toBe(true)
    })

    it('should reject invalid transitions', () => {
      expect(canTransition('idle', 'done')).toBe(false)
      expect(canTransition('done', 'idle')).toBe(false)
      expect(canTransition('coding', 'idle')).toBe(false)
      expect(canTransition('clarifying', 'done')).toBe(false)
    })

    it('should allow most non-terminal states to transition to failed', () => {
      const canFailStatuses: RequirementStatus[] = [
        'idle', 'clarifying', 'clarified', 'waiting-for-pm', 'needs-confirmation',
        'planning', 'plan-ready', 'plan-approved', 'plan-rejected',
        'coding', 'testing', 'diff-ready',
      ]
      for (const status of canFailStatuses) {
        expect(canTransition(status, 'failed')).toBe(true)
      }
    })

    it('reverted state cannot transition to failed', () => {
      // reverted is a recovery state; must go through idle/clarifying first
      expect(canTransition('reverted', 'failed')).toBe(false)
    })
  })

  describe('transition', () => {
    it('should update requirement status on valid transition', () => {
      const req = makeRequirement('idle')
      const oldStatus = transition(req, 'clarifying', 'test')
      expect(oldStatus).toBe('idle')
      expect(req.status).toBe('clarifying')
    })

    it('should update updatedAt timestamp', () => {
      const req = makeRequirement('idle')
      const oldTime = req.updatedAt
      // Wait a bit to ensure timestamp difference
      transition(req, 'clarifying')
      expect(req.updatedAt.getTime()).toBeGreaterThanOrEqual(oldTime.getTime())
    })

    it('should throw StateTransitionError on invalid transition', () => {
      const req = makeRequirement('idle')
      expect(() => transition(req, 'done', 'test reason')).toThrow(StateTransitionError)
      // Status should remain unchanged
      expect(req.status).toBe('idle')
    })

    it('should include reason in error message', () => {
      const req = makeRequirement('done')
      expect(() => transition(req, 'idle', 'should not work')).toThrow(/should not work/)
    })

    it('should support the full happy path flow', () => {
      const req = makeRequirement('idle')
      
      transition(req, 'clarifying')
      expect(req.status).toBe('clarifying')
      
      transition(req, 'clarified')
      expect(req.status).toBe('clarified')
      
      transition(req, 'planning')
      expect(req.status).toBe('planning')
      
      transition(req, 'plan-ready')
      expect(req.status).toBe('plan-ready')
      
      transition(req, 'coding')
      expect(req.status).toBe('coding')
      
      transition(req, 'testing')
      expect(req.status).toBe('testing')
      
      transition(req, 'diff-ready')
      expect(req.status).toBe('diff-ready')
      
      transition(req, 'done')
      expect(req.status).toBe('done')
    })

    it('should support clarification loop with waiting-for-pm', () => {
      const req = makeRequirement('clarifying')
      
      transition(req, 'waiting-for-pm')
      expect(req.status).toBe('waiting-for-pm')
      
      transition(req, 'clarifying')
      expect(req.status).toBe('clarifying')
      
      transition(req, 'clarified')
      expect(req.status).toBe('clarified')
    })
  })

  describe('isTerminal', () => {
    it('should return true for terminal states', () => {
      expect(isTerminal('done')).toBe(true)
      expect(isTerminal('failed')).toBe(true)
    })

    it('should return false for non-terminal states', () => {
      expect(isTerminal('idle')).toBe(false)
      expect(isTerminal('coding')).toBe(false)
      expect(isTerminal('plan-ready')).toBe(false)
    })
  })

  describe('isPausePoint', () => {
    it('should return true for pause points', () => {
      expect(isPausePoint('waiting-for-pm')).toBe(true)
      expect(isPausePoint('needs-confirmation')).toBe(true)
      expect(isPausePoint('plan-ready')).toBe(true)
      expect(isPausePoint('diff-ready')).toBe(true)
    })

    it('should return false for non-pause states', () => {
      expect(isPausePoint('coding')).toBe(false)
      expect(isPausePoint('testing')).toBe(false)
      expect(isPausePoint('done')).toBe(false)
    })
  })

  describe('getValidNextStates', () => {
    it('should return valid next states', () => {
      const nextStates = getValidNextStates('idle')
      expect(nextStates).toContain('clarifying')
      expect(nextStates).toContain('failed')
    })

    it('should return empty array for terminal states', () => {
      expect(getValidNextStates('done')).toEqual([])
    })
  })
})
