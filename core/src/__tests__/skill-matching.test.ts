import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../skill-registry/skill-registry.js'
import type { SkillDefinition, StructuredRequirement, SkillMatchRule } from '../types.js'

function makeSkill(name: string, canHandle?: (req: StructuredRequirement) => boolean): SkillDefinition {
  return {
    name,
    description: `Test skill: ${name}`,
    canHandle: canHandle ?? (() => false),
    execute: async () => [],
    prompt: `prompt for ${name}`,
  }
}

function makeRequirement(overrides: Partial<StructuredRequirement> = {}): StructuredRequirement {
  return {
    type: 'add_field',
    entity: 'user',
    scope: 'frontend',
    description: 'Add a new email field to user profile',
    rawInput: 'add email field',
    details: {},
    ...overrides,
  }
}

describe('SkillRegistry - Declarative Matching', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  describe('register with matchRule', () => {
    it('should register skill with declarative match rule', () => {
      const skill = makeSkill('add-field-frontend')
      const rule: SkillMatchRule = { type: 'add_field', scope: 'frontend' }
      registry.register(skill, rule)

      const req = makeRequirement({ type: 'add_field', scope: 'frontend' })
      const matched = registry.match(req)
      expect(matched).not.toBeNull()
      expect(matched!.name).toBe('add-field-frontend')
    })

    it('should not match when type does not match', () => {
      const skill = makeSkill('add-field-only')
      const rule: SkillMatchRule = { type: 'add_field' }
      registry.register(skill, rule)

      const req = makeRequirement({ type: 'delete_field' })
      const matched = registry.match(req)
      expect(matched).toBeNull()
    })

    it('should not match when entity does not match', () => {
      const skill = makeSkill('user-field')
      const rule: SkillMatchRule = { type: 'add_field', entity: 'user' }
      registry.register(skill, rule)

      const req = makeRequirement({ type: 'add_field', entity: 'order' })
      const matched = registry.match(req)
      expect(matched).toBeNull()
    })

    it('should not match when scope does not match', () => {
      const skill = makeSkill('frontend-only')
      const rule: SkillMatchRule = { type: 'add_field', scope: 'frontend' }
      registry.register(skill, rule)

      const req = makeRequirement({ type: 'add_field', scope: 'backend' })
      const matched = registry.match(req)
      expect(matched).toBeNull()
    })
  })

  describe('multi-dimensional scoring', () => {
    it('should give higher score for more dimensions matched', () => {
      const broadSkill = makeSkill('broad')
      const broadRule: SkillMatchRule = { type: 'add_field' }
      registry.register(broadSkill, broadRule)

      const specificSkill = makeSkill('specific')
      const specificRule: SkillMatchRule = { type: 'add_field', entity: 'user', scope: 'frontend' }
      registry.register(specificSkill, specificRule)

      const req = makeRequirement({ type: 'add_field', entity: 'user', scope: 'frontend' })
      const matched = registry.match(req)
      // specific skill should win: type(10) + entity(5) + scope(3) = 18 vs type(10) = 10
      expect(matched!.name).toBe('specific')
    })

    it('should add score for descriptionContains keywords', () => {
      const skill = makeSkill('email-handler')
      const rule: SkillMatchRule = { type: 'add_field', descriptionContains: ['email', 'validation'] }
      registry.register(skill, rule)

      const req = makeRequirement({ type: 'add_field', description: 'Add email field with validation' })
      const matched = registry.match(req)
      expect(matched).not.toBeNull()
      expect(matched!.name).toBe('email-handler')
    })

    it('should handle array values in type field', () => {
      const skill = makeSkill('multi-type')
      const rule: SkillMatchRule = { type: ['add_field', 'add_page'] }
      registry.register(skill, rule)

      const req1 = makeRequirement({ type: 'add_field' })
      expect(registry.match(req1)?.name).toBe('multi-type')

      const req2 = makeRequirement({ type: 'add_page' })
      expect(registry.match(req2)?.name).toBe('multi-type')

      const req3 = makeRequirement({ type: 'delete_field' })
      expect(registry.match(req3)).toBeNull()
    })
  })

  describe('priority sorting', () => {
    it('should prefer higher priority rules when scores are equal', () => {
      const skillA = makeSkill('low-priority')
      const ruleA: SkillMatchRule = { type: 'add_field', priority: 1 }
      registry.register(skillA, ruleA)

      const skillB = makeSkill('high-priority')
      const ruleB: SkillMatchRule = { type: 'add_field', priority: 10 }
      registry.register(skillB, ruleB)

      const req = makeRequirement({ type: 'add_field' })
      const matched = registry.match(req)
      expect(matched!.name).toBe('high-priority')
    })

    it('should prefer higher priority over score (priority is primary sort key)', () => {
      const skillA = makeSkill('high-priority-low-score')
      const ruleA: SkillMatchRule = { type: 'add_field', priority: 100 }
      registry.register(skillA, ruleA)

      const skillB = makeSkill('low-priority-high-score')
      const ruleB: SkillMatchRule = { type: 'add_field', entity: 'user', scope: 'frontend', priority: 1 }
      registry.register(skillB, ruleB)

      const req = makeRequirement({ type: 'add_field', entity: 'user', scope: 'frontend' })
      const matched = registry.match(req)
      // skillA priority=100 beats skillB priority=1 even though skillB has higher score
      expect(matched!.name).toBe('high-priority-low-score')
    })
  })

  describe('fallback to canHandle', () => {
    it('should fall back to canHandle when no declarative rules match', () => {
      const skill = makeSkill('legacy-skill', (req) => req.type === 'add_page')
      registry.register(skill) // no matchRule

      const req = makeRequirement({ type: 'add_page' })
      const matched = registry.match(req)
      expect(matched).not.toBeNull()
      expect(matched!.name).toBe('legacy-skill')
    })

    it('should prefer declarative match over canHandle', () => {
      const legacySkill = makeSkill('legacy', (req) => req.type === 'add_field')
      registry.register(legacySkill)

      const modernSkill = makeSkill('modern')
      const rule: SkillMatchRule = { type: 'add_field', scope: 'frontend' }
      registry.register(modernSkill, rule)

      const req = makeRequirement({ type: 'add_field', scope: 'frontend' })
      const matched = registry.match(req)
      expect(matched!.name).toBe('modern')
    })
  })

  describe('unregister', () => {
    it('should remove skill and its match rule', () => {
      const skill = makeSkill('removable')
      const rule: SkillMatchRule = { type: 'add_field' }
      registry.register(skill, rule)

      expect(registry.unregister('removable')).toBe(true)

      const req = makeRequirement({ type: 'add_field' })
      const matched = registry.match(req)
      expect(matched).toBeNull()
    })

    it('should return false for non-existent skill', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })
  })

  describe('getAll', () => {
    it('should return all registered skills', () => {
      registry.register(makeSkill('a'))
      registry.register(makeSkill('b'))
      registry.register(makeSkill('c'))
      expect(registry.getAll()).toHaveLength(3)
    })
  })
})
