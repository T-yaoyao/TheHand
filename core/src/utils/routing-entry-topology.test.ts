import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FilePlan, ProjectContext } from '../types.js'
import {
  entryFileDeclaresRoutesJsx,
  entryImportsRelativeRouterModule,
  isPhantomRouteTableVersusEntryTopology,
  sanitizePhantomRouteTablesAgainstEntryTopology,
} from './routing-entry-topology.js'

const baseCtx = (): ProjectContext => ({
  id: 'x',
  name: 'x',
  techStack: { frontend: '', backend: '', database: '', language: '' },
  structure: { frontend: 'frontend/src/', backend: '', models: '', routes: '', components: '' },
  models: {},
  routes: {},
  commands: { lint: '', test: '', dev: '', build: '' },
  thehand: {},
})

describe('routing-entry-topology', () => {
  describe('entryFileDeclaresRoutesJsx', () => {
    it('detects <Routes', () => {
      expect(entryFileDeclaresRoutesJsx('export default function X(){return <Routes>')).toBe(true)
    })
    it('detects <RouterProvider', () => {
      expect(entryFileDeclaresRoutesJsx('<RouterProvider router={r} />')).toBe(true)
    })
    it('returns false when no route tree in JSX', () => {
      expect(entryFileDeclaresRoutesJsx('import App from "./App"')).toBe(false)
    })
  })

  describe('entryImportsRelativeRouterModule', () => {
    it('detects ./router import', () => {
      expect(entryImportsRelativeRouterModule(`import { routes } from './router.jsx'`)).toBe(true)
    })
    it('detects ../router', () => {
      expect(entryImportsRelativeRouterModule(`export { x } from "../router"`)).toBe(true)
    })
    it('detects side-effect import ./router', () => {
      expect(entryImportsRelativeRouterModule(`import './router.jsx'`)).toBe(true)
    })
    it('ignores non-relative router paths', () => {
      expect(entryImportsRelativeRouterModule(`import r from '@/router'`)).toBe(false)
    })
  })

  describe('isPhantomRouteTableVersusEntryTopology', () => {
    let sandbox: string

    beforeAll(async () => {
      sandbox = await mkdtemp(join(tmpdir(), 'routing-topo-'))
      await mkdir(join(sandbox, 'frontend/src'), { recursive: true })
      await writeFile(
        join(sandbox, 'frontend/src/main.jsx'),
        `import { Routes, Route } from 'react-router-dom'
export default function Root() {
  return <Routes><Route path="/" element={<div/>} /></Routes>
}`,
        'utf-8',
      )
    })

    afterAll(async () => {
      await rm(sandbox, { recursive: true, force: true })
    })

    it('flags non-existent router.* when entry inlines Routes and does not import ./router', () => {
      expect(
        isPhantomRouteTableVersusEntryTopology(
          'frontend/src/router.jsx',
          sandbox,
          'frontend/src/main.jsx',
          `return <Routes></Routes>`,
        ),
      ).toBe(true)
    })

    it('does not flag when router file exists on disk', async () => {
      await writeFile(join(sandbox, 'frontend/src/router.jsx'), '//', 'utf-8')
      expect(
        isPhantomRouteTableVersusEntryTopology(
          'frontend/src/router.jsx',
          sandbox,
          'frontend/src/main.jsx',
          `return <Routes></Routes>`,
        ),
      ).toBe(false)
      await rm(join(sandbox, 'frontend/src/router.jsx'), { force: true })
    })

    it('does not flag when entry imports ./router', () => {
      expect(
        isPhantomRouteTableVersusEntryTopology(
          'frontend/src/router.jsx',
          sandbox,
          'frontend/src/main.jsx',
          `import './router.jsx'\nreturn <Routes></Routes>`,
        ),
      ).toBe(false)
    })

    it('does not flag non-route-table paths', () => {
      expect(
        isPhantomRouteTableVersusEntryTopology(
          'frontend/src/routes/Home.jsx',
          sandbox,
          'frontend/src/main.jsx',
          `return <Routes></Routes>`,
        ),
      ).toBe(false)
    })
  })

  describe('sanitizePhantomRouteTablesAgainstEntryTopology', () => {
    let sandbox: string

    beforeAll(async () => {
      sandbox = await mkdtemp(join(tmpdir(), 'routing-sanitize-'))
      await mkdir(join(sandbox, 'frontend/src'), { recursive: true })
      await writeFile(
        join(sandbox, 'frontend/src/main.jsx'),
        `import { Routes, Route } from 'react-router-dom'
export default function Root() {
  return <Routes><Route path="/" element={<div/>} /></Routes>
}`,
        'utf-8',
      )
    })

    afterAll(async () => {
      await rm(sandbox, { recursive: true, force: true })
    })

    it('removes phantom router plan row and merges note onto entry plan', () => {
      const plan: FilePlan[] = [
        { path: 'frontend/src/routes/Foo.jsx', changeDescription: 'page', priority: 1 },
        { path: 'frontend/src/router.jsx', changeDescription: 'new router', priority: 2 },
        { path: 'frontend/src/main.jsx', changeDescription: 'wire routes', priority: 3 },
      ]
      const out = sanitizePhantomRouteTablesAgainstEntryTopology(plan, sandbox, baseCtx())
      expect(out.some(f => f.path === 'frontend/src/router.jsx')).toBe(false)
      const main = out.find(f => f.path === 'frontend/src/main.jsx')
      expect(main?.changeDescription).toContain('TheHand')
      expect(main?.changeDescription).toContain('frontend/src/router.jsx')
    })

    it('adds entry-only row when plan had no entry but phantom router was listed', () => {
      const plan: FilePlan[] = [
        { path: 'frontend/src/router.tsx', changeDescription: 'router', priority: 1 },
      ]
      const out = sanitizePhantomRouteTablesAgainstEntryTopology(plan, sandbox, baseCtx())
      expect(out.some(f => f.path === 'frontend/src/router.tsx')).toBe(false)
      expect(out.some(f => f.path === 'frontend/src/main.jsx')).toBe(true)
    })
  })
})
