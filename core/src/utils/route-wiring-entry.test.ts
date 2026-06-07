import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProjectContext } from '../types.js'
import { collectRouteIntegrationContextPaths, pickApplicationEntryForRouteTable } from './route-wiring-entry.js'

describe('route-wiring-entry', () => {
  let sandbox: string

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'route-entry-'))
    await mkdir(join(sandbox, 'frontend/src'), { recursive: true })
    await writeFile(join(sandbox, 'frontend/src/main.jsx'), '// main\n', 'utf-8')
    await writeFile(join(sandbox, 'frontend/src/App.jsx'), '// app\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('pickApplicationEntryForRouteTable prefers first existing configured entry', () => {
    const ctx: ProjectContext = {
      id: 'x',
      name: 'x',
      techStack: { frontend: '', backend: '', database: '', language: '' },
      structure: { frontend: 'frontend/src/', backend: '', models: '', routes: '', components: '' },
      models: {},
      routes: {},
      commands: { lint: '', test: '', dev: '', build: '' },
      thehand: {
        routingIntegration: {
          enabled: false,
          routeEntryFiles: ['frontend/src/main.jsx', 'frontend/src/main.tsx'],
          nestedNewPageGlob: '',
          nestedNewPageExcludeGlobs: [],
          injectSiblingRouteHint: '',
          nestedRouteParentHint: '',
        },
      },
    }
    expect(pickApplicationEntryForRouteTable(sandbox, ctx)).toBe('frontend/src/main.jsx')
  })

  it('collectRouteIntegrationContextPaths includes main and App when both exist', () => {
    const ctx: ProjectContext = {
      id: 'x',
      name: 'x',
      techStack: { frontend: '', backend: '', database: '', language: '' },
      structure: { frontend: 'frontend/src/', backend: '', models: '', routes: '', components: '' },
      models: {},
      routes: {},
      commands: { lint: '', test: '', dev: '', build: '' },
      thehand: {
        readContextCandidates: ['frontend/src/App.jsx'],
      },
    }
    const paths = collectRouteIntegrationContextPaths(sandbox, ctx)
    expect(paths).toContain('frontend/src/main.jsx')
    expect(paths).toContain('frontend/src/App.jsx')
    expect(paths.indexOf('frontend/src/main.jsx')).toBeLessThan(paths.indexOf('frontend/src/App.jsx'))
  })
})
