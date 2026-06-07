import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FilePlan, ProjectContext } from '../types.js'
import { enrichPlanWithIntegrationEntryFiles } from './plan-integration-enrich.js'

const baseCtx: ProjectContext = {
  id: 'x',
  name: 'x',
  techStack: { frontend: '', backend: '', database: '', language: '' },
  structure: { frontend: 'frontend/src/', backend: '', models: '', routes: '', components: '' },
  models: {},
  routes: {},
  commands: { lint: '', test: '', dev: '', build: '' },
  thehand: { readContextCandidates: ['frontend/src/App.jsx'] },
}

describe('plan-integration-enrich', () => {
  let sandbox: string

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'plan-enrich-'))
    await mkdir(join(sandbox, 'frontend/src'), { recursive: true })
    await writeFile(join(sandbox, 'frontend/src/main.jsx'), '//\n', 'utf-8')
    await writeFile(join(sandbox, 'frontend/src/App.jsx'), '//\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('does not add entry or readContext when includeRouteEntryContext is false', () => {
    const plan: FilePlan[] = [
      {
        path: 'frontend/src/routes/Profile/ProfileAboutMe.jsx',
        changeDescription: '新增 About Me Tab 页面组件',
        priority: 1,
      },
    ]
    const out = enrichPlanWithIntegrationEntryFiles(plan, sandbox, baseCtx, false)
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('frontend/src/routes/Profile/ProfileAboutMe.jsx')
  })

  it('adds main and existing readContextCandidates when includeRouteEntryContext is true', () => {
    const plan: FilePlan[] = [
      {
        path: 'frontend/src/routes/Profile/ProfileAboutMe.jsx',
        changeDescription: '新增 About Me Tab 页面组件',
        priority: 1,
      },
    ]
    const out = enrichPlanWithIntegrationEntryFiles(plan, sandbox, baseCtx, true)
    expect(out.some(f => f.path === 'frontend/src/main.jsx')).toBe(true)
    expect(out.some(f => f.path === 'frontend/src/App.jsx')).toBe(true)
  })
})
