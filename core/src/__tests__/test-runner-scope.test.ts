import { describe, it, expect } from 'vitest'
import { computeTestScope, scopeTestCommand } from '../git-ops/test-runner.js'

describe('computeTestScope', () => {
  it('should return null for empty array', () => {
    expect(computeTestScope([])).toBeNull()
  })

  it('should return null for root-level files', () => {
    expect(computeTestScope(['package.json'])).toBeNull()
  })

  it('should return the top-level dir when all files are in same dir', () => {
    expect(computeTestScope(['frontend/src/routes/Article/Article.jsx'])).toBe('frontend')
  })

  it('should return top-level dir for multiple files in same dir', () => {
    const files = [
      'frontend/src/routes/Article/Article.jsx',
      'frontend/src/components/Header.jsx',
      'frontend/src/utils/helpers.js',
    ]
    expect(computeTestScope(files)).toBe('frontend')
  })

  it('should return null when files span multiple top-level dirs', () => {
    const files = [
      'frontend/src/App.jsx',
      'backend/src/index.js',
    ]
    expect(computeTestScope(files)).toBeNull()
  })

  it('should handle Windows-style paths', () => {
    expect(computeTestScope(['frontend\\src\\App.jsx'])).toBe('frontend')
  })

  it('should return null for mix of root and subdirectory files', () => {
    expect(computeTestScope(['README.md', 'frontend/src/App.jsx'])).toBeNull()
  })
})

describe('scopeTestCommand', () => {
  it('should return base command when scope is null', () => {
    expect(scopeTestCommand('npm test', null)).toBe('npm test')
  })

  it('should append scope with -- for npm commands', () => {
    expect(scopeTestCommand('npm test', 'frontend')).toBe('npm test -- frontend')
  })

  it('should append scope with -- for npm run commands', () => {
    expect(scopeTestCommand('npm run test', 'frontend')).toBe('npm run test -- frontend')
  })

  it('should append scope directly for vitest commands', () => {
    expect(scopeTestCommand('vitest', 'frontend')).toBe('vitest frontend')
  })

  it('should append scope directly for npx vitest commands', () => {
    expect(scopeTestCommand('npx vitest run', 'frontend')).toBe('npx vitest run frontend')
  })

  it('should handle jest commands', () => {
    expect(scopeTestCommand('npx jest', 'frontend')).toBe('npx jest frontend')
  })

  it('should trim whitespace from base command', () => {
    expect(scopeTestCommand('npm test  ', 'frontend')).toBe('npm test -- frontend')
  })
})
