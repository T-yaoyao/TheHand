import { describe, it, expect } from 'vitest'
import { computeTestScope, scopeTestCommand, isNoTestFilesFound } from '../git-ops/test-runner.js'

describe('computeTestScope', () => {
  it('should return null for empty array', () => {
    expect(computeTestScope([])).toBeNull()
  })

  it('should return null for root-level files', () => {
    expect(computeTestScope(['package.json'])).toBeNull()
  })

  it('should return the file directory for single file', () => {
    expect(computeTestScope(['frontend/src/routes/Article/Article.jsx'])).toBe('frontend/src/routes/Article')
  })

  it('should return common parent dir for multiple files in same subtree', () => {
    const files = [
      'frontend/src/routes/Article/Article.jsx',
      'frontend/src/routes/Article/CommentsSection.jsx',
    ]
    // common dir: frontend/src/routes/Article → parent: frontend/src/routes
    expect(computeTestScope(files)).toBe('frontend/src/routes')
  })

  it('should return common prefix parent for files in different subtrees', () => {
    const files = [
      'frontend/src/routes/Article/Article.jsx',
      'frontend/src/components/Header/Header.jsx',
    ]
    // common dir: frontend/src → parent: frontend
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
    expect(computeTestScope(['frontend\\src\\App.jsx'])).toBe('frontend/src')
  })

  it('should return null for mix of root and subdirectory files', () => {
    expect(computeTestScope(['README.md', 'frontend/src/App.jsx'])).toBeNull()
  })

  it('should return file dir for two files in same directory', () => {
    const files = [
      'frontend/src/routes/Article/Article.jsx',
      'frontend/src/routes/Article/Article.test.jsx',
    ]
    // common dir: frontend/src/routes/Article → parent: frontend/src/routes
    expect(computeTestScope(files)).toBe('frontend/src/routes')
  })

  it('should handle files at different depths', () => {
    const files = [
      'frontend/src/App.jsx',
      'frontend/src/routes/Article/Article.jsx',
    ]
    // common dir: frontend/src → parent: frontend
    expect(computeTestScope(files)).toBe('frontend')
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

describe('isNoTestFilesFound', () => {
  it('should detect vitest "No test files found" message', () => {
    const output = `No test files found, exiting with code 1\n\nfilter: frontend/src/components/ArticlesPreview`
    expect(isNoTestFilesFound(output)).toBe(true)
  })

  it('should detect case-insensitive match', () => {
    expect(isNoTestFilesFound('NO TEST FILES FOUND')).toBe(true)
  })

  it('should return false for actual test failures', () => {
    const output = `FAIL frontend/src/components/PopularTags/PopularTags.test.jsx\nTypeError: Cannot read properties of undefined`
    expect(isNoTestFilesFound(output)).toBe(false)
  })

  it('should return false for empty output', () => {
    expect(isNoTestFilesFound('')).toBe(false)
  })

  it('should detect vitest output with MISSING DEPENDENCY warning', () => {
    const output = `MISSING DEPENDENCY  Cannot find dependency 'jsdom'\n\nNo test files found, exiting with code 1\n\nfilter: frontend/src/components/ArticlesPreview`
    expect(isNoTestFilesFound(output)).toBe(true)
  })
})
