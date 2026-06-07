import { mkdir, mkdtemp, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { findUnresolvedRelativeImportsInFileMap } from './relative-import-resolve-guard.js'
import type { ProjectContext } from '../types.js'

describe('findUnresolvedRelativeImportsInFileMap', () => {
  let sandbox: string
  const projectContext: ProjectContext = {
    id: 't',
    name: 't',
    techStack: { frontend: '', backend: '', database: '', language: 'js' },
    structure: { frontend: 'frontend/src/', backend: '', models: '', routes: '', components: '' },
    models: {},
    routes: {},
    commands: { lint: '', test: '', dev: '', build: '' },
  }

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'thehand-import-guard-'))
    await mkdir(join(sandbox, 'frontend', 'src'), { recursive: true })
    await writeFile(
      join(sandbox, 'frontend', 'src', 'App.jsx'),
      'export default function App(){return null}\n',
      'utf-8',
    )
  })

  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('flags hallucinated ./components/App when only ./App exists', async () => {
    const fileMap = new Map<string, { path: string; content: string }>([
      [
        'frontend/src/main.jsx',
        {
          path: 'frontend/src/main.jsx',
          content: `import React from 'react'
import App from './components/App'
export default function Root(){return <App/>}
`,
        },
      ],
    ])
    const v = await findUnresolvedRelativeImportsInFileMap(sandbox, projectContext, [], fileMap)
    expect(v.length).toBeGreaterThan(0)
    expect(v.some(x => x.specifier === './components/App')).toBe(true)
  })

  it('accepts valid ./App import', async () => {
    const fileMap = new Map<string, { path: string; content: string }>([
      [
        'frontend/src/main.jsx',
        {
          path: 'frontend/src/main.jsx',
          content: `import App from './App'
export default function Root(){return <App/>}
`,
        },
      ],
    ])
    const v = await findUnresolvedRelativeImportsInFileMap(sandbox, projectContext, [], fileMap)
    expect(v.filter(x => x.specifier === './App')).toHaveLength(0)
  })

  it('scans plan file on disk when not present in fileMap', async () => {
    await writeFile(
      join(sandbox, 'frontend', 'src', 'main.jsx'),
      `import React from 'react'\nimport App from './components/App'\n`,
      'utf-8',
    )
    const plan = [{ path: 'frontend/src/main.jsx', changeDescription: 'fix', priority: 1 }]
    const v = await findUnresolvedRelativeImportsInFileMap(sandbox, projectContext, plan, new Map())
    expect(v.some(x => x.specifier === './components/App')).toBe(true)
  })
})
