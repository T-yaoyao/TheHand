import { describe, it, expect } from 'vitest'
import { extractErrorFilePaths } from '../utils/error-file-extractor.js'

describe('error-file-extractor', () => {
  describe('extractErrorFilePaths', () => {
    it('should extract Vite/Rollup error paths', () => {
      const output = `src/agent.js (2:9): "getToken" is not exported from "src/utils/auth.js"`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/agent.js')).toBe(true)
    })

    it('should extract TypeScript error paths', () => {
      const output = `src/foo.ts(10,5): error TS2322: Type 'string' is not assignable`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/foo.ts')).toBe(true)
    })

    it('should extract ESLint error paths', () => {
      const output = `src/components/App.jsx:10:5: error 'foo' is not defined`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/components/App.jsx')).toBe(true)
    })

    it('should extract "is not exported by" paths', () => {
      const output = `"getToken" is not exported by "src/context/AuthContext.jsx"`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/context/AuthContext.jsx')).toBe(true)
    })

    it('should extract "imported by" paths', () => {
      const output = `imported by "src/agent.js"`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/agent.js')).toBe(true)
    })

    it('should exclude node_modules paths', () => {
      const output = `node_modules/rollup/dist/parseAst.js(2:9): error`
      const paths = extractErrorFilePaths(output)
      expect(paths.size).toBe(0)
    })

    it('should exclude vite internal paths', () => {
      const output = `vite/dist/node-entry.js(2:9): error`
      const paths = extractErrorFilePaths(output)
      expect(paths.size).toBe(0)
    })

    it('should normalize frontend/ prefix', () => {
      const output = `frontend/src/components/Button.jsx (10:5): "onClick" is not exported`
      const paths = extractErrorFilePaths(output)
      // frontend/src/components/Button.jsx should be normalized to src/components/Button.jsx
      expect(paths.has('src/components/Button.jsx')).toBe(true)
    })

    it('should handle multiple errors in same output', () => {
      const output = `
src/agent.js (2:9): "getToken" is not exported
src/auth.js:10:5: error TS2322
src/lib/helper.ts(5,3): error TS2345
`
      const paths = extractErrorFilePaths(output)
      expect(paths.size).toBe(3)
      expect(paths.has('src/agent.js')).toBe(true)
      expect(paths.has('src/auth.js')).toBe(true)
      expect(paths.has('src/lib/helper.ts')).toBe(true)
    })

    it('should return empty set for unrelated output', () => {
      const output = `All tests passed. 5 passed, 0 failed.`
      const paths = extractErrorFilePaths(output)
      expect(paths.size).toBe(0)
    })

    it('should handle sandbox absolute paths', () => {
      const output = `file: /sandbox/workspace/src/components/Header.jsx (10:5)`
      const paths = extractErrorFilePaths(output)
      expect(paths.has('src/components/Header.jsx')).toBe(true)
    })
  })
})
