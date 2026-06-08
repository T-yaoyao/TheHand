/**
 * 项目自动扫描器
 * 混合模式：代码扫描（快/免费）+ LLM 分析（智能/有成本）
 *
 * 扫描内容：
 * 1. 路由模式 — 怎么注册路由
 * 2. 组件结构 — 目录命名约定
 * 3. 依赖列表 — 可用的库
 * 4. ORM 模式 — 数据库框架特征
 * 5. 样式模式 — CSS 方案
 * 6. 入口文件 — main/App/router 位置
 * 7. LLM 推导 — 复杂业务约定（导航模式、组件集成方式等）
 */

import { readFile, readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { createLogger } from '../utils/logger.js'
import type { LLMClient } from '../llm/llm-client.js'

const log = createLogger('scanner')

export interface ProjectScanResult {
  /** 自动推导的约束（注入到 prompt） */
  constraints: Record<string, string>
  /** 检测到的上下文文件 */
  contextFiles: string[]
  /** 检测到的语义标签（JSX 框架标签） */
  semanticTags: string[]
  /** 排除目录列表 */
  excludeDirs: string[]
  /** ORM 特征 */
  ormPatterns: { modelField?: string }
  /** 扫描诊断信息 */
  diagnostics: string[]
}

/**
 * 扫描项目代码，自动推导项目约定
 * @param sandboxPath 项目根目录
 * @param llmClient 可选，传入后启用 LLM 深度分析
 */
export async function scanProject(sandboxPath: string, llmClient?: LLMClient): Promise<ProjectScanResult> {
  const constraints: Record<string, string> = {}
  const contextFiles: string[] = []
  const semanticTags: string[] = []
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt']
  const ormPatterns: { modelField?: string } = {}
  const diagnostics: string[] = []

  // ── 1. 读取 package.json ──
  const pkgJson = await readJson(join(sandboxPath, 'package.json'))
  const allDeps = { ...pkgJson?.dependencies, ...pkgJson?.devDependencies }

  // ── 2. 检测技术栈 ──
  const framework = detectFramework(allDeps)
  if (framework) {
    constraints['framework'] = framework
    diagnostics.push(`framework: ${framework}`)
  }

  // ── 3. 检测 ORM ──
  const orm = detectORM(allDeps)
  if (orm) {
    constraints['orm'] = orm.description
    if (orm.modelFieldPattern) ormPatterns.modelField = orm.modelFieldPattern
    diagnostics.push(`orm: ${orm.name}`)
  }

  // ── 4. 检测路由模式 ──
  const routing = await detectRoutingPattern(sandboxPath, allDeps)
  if (routing) {
    constraints['routing'] = routing.description
    if (routing.contextFile) contextFiles.push(routing.contextFile)
    if (routing.semanticTags) semanticTags.push(...routing.semanticTags)
    diagnostics.push(`routing: ${routing.pattern}`)
  }

  // ── 5. 检测组件结构 ──
  const componentStructure = await detectComponentStructure(sandboxPath)
  if (componentStructure) {
    constraints['components'] = componentStructure.description
    diagnostics.push(`components: ${componentStructure.pattern}`)
  }

  // ── 6. 检测样式模式 ──
  const styling = detectStylingPattern(allDeps, sandboxPath)
  if (styling) {
    constraints['styles'] = styling
    diagnostics.push(`styles: ${styling}`)
  }

  // ── 7. 检测 API 模式 ──
  const apiPattern = detectAPIPattern(allDeps)
  if (apiPattern) {
    constraints['api'] = apiPattern
    diagnostics.push(`api: ${apiPattern}`)
  }

  // ── 8. 检测依赖约束 ──
  const depConstraint = detectDependencyConstraints(allDeps)
  if (depConstraint) {
    constraints['dependencies'] = depConstraint
  }

  // ── 9. 收集入口文件 ──
  const entries = await detectEntryFiles(sandboxPath)
  contextFiles.push(...entries)

  // ── 10. LLM 深度分析（可选）──
  if (llmClient) {
    try {
      const llmConstraints = await analyzeProjectWithLLM(sandboxPath, llmClient, constraints, contextFiles)
      Object.assign(constraints, llmConstraints)
      diagnostics.push(`llm: ${Object.keys(llmConstraints).length} constraints`)
    } catch (err) {
      diagnostics.push(`llm: failed (${(err as Error).message?.slice(0, 50)})`)
    }
  }

  // ── 11. 通用修改规则 ──
  constraints['modification'] = '修改已有文件时只改需要改的部分，不要整体重写'

  return { constraints, contextFiles, semanticTags, excludeDirs, ormPatterns, diagnostics }
}

/**
 * LLM 深度分析：读取关键文件，让 LLM 推导项目约定
 */
async function analyzeProjectWithLLM(
  sandboxPath: string,
  llmClient: LLMClient,
  existingConstraints: Record<string, string>,
  contextFiles: string[],
): Promise<Record<string, string>> {
  // 读取关键文件内容（最多 5 个，控制 token 成本）
  const filesToRead = contextFiles.slice(0, 5)
  const fileContents: string[] = []
  for (const file of filesToRead) {
    try {
      const content = await readFile(join(sandboxPath, file), 'utf-8')
      // 截断大文件，控制 token
      const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n...(truncated)' : content
      fileContents.push(`### ${file}\n\`\`\`\n${truncated}\n\`\`\``)
    } catch {}
  }

  // 读取一个样本组件（如果有 components 目录）
  const sampleComponent = await readSampleComponent(sandboxPath)
  if (sampleComponent) {
    fileContents.push(sampleComponent)
  }

  if (fileContents.length === 0) return {}

  const existing = Object.entries(existingConstraints).map(([k, v]) => `- ${k}: ${v}`).join('\n')

  const response = await llmClient.simpleChat(
    `You are a project convention analyzer. Given the following project files, output a JSON object of additional project conventions/constraints that a code generator should follow. Focus on patterns NOT already covered by these existing constraints:\n${existing}\n\nOutput ONLY a JSON object where keys are constraint names and values are short descriptions. No markdown, no explanation.`,
    fileContents.join('\n\n'),
    'scanner',
  )

  // 解析 LLM 返回的 JSON
  try {
    const parsed = JSON.parse(response)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, string>
    }
  } catch {}
  return {}
}

/**
 * 读取一个样本组件文件，用于 LLM 分析组件约定
 */
async function readSampleComponent(sandboxPath: string): Promise<string | null> {
  const componentDirs = ['frontend/src/components', 'src/components']
  for (const dir of componentDirs) {
    try {
      const entries = await readdir(join(sandboxPath, dir), { withFileTypes: true })
      const firstDir = entries.find(e => e.isDirectory())
      if (firstDir) {
        const dirPath = join(sandboxPath, dir, firstDir.name)
        const files = await readdir(dirPath)
        const mainFile = files.find(f => /\.(jsx?|tsx|vue)$/.test(f) && f !== 'index.js' && f !== 'index.ts')
        if (mainFile) {
          const content = await readFile(join(dirPath, mainFile), 'utf-8')
          const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...(truncated)' : content
          return `### Sample component: ${dir}/${firstDir.name}/${mainFile}\n\`\`\`\n${truncated}\n\`\`\``
        }
      }
    } catch {}
  }
  return null
}

// ─── 检测函数 ───

function detectFramework(deps: Record<string, string>): string | null {
  if (deps?.['next']) return 'Next.js'
  if (deps?.['nuxt']) return 'Nuxt.js'
  if (deps?.['@angular/core']) return 'Angular'
  if (deps?.['vue']) return 'Vue'
  if (deps?.['svelte']) return 'Svelte'
  if (deps?.['react']) return 'React'
  return null
}

function detectORM(deps: Record<string, string>): { name: string; description: string; modelFieldPattern?: string } | null {
  if (deps?.['sequelize']) return {
    name: 'sequelize',
    description: '数据库模型使用 Sequelize ORM 定义',
    modelFieldPattern: 'DataTypes',
  }
  if (deps?.['typeorm']) return {
    name: 'typeorm',
    description: '数据库模型使用 TypeORM 装饰器定义',
    modelFieldPattern: '@Column',
  }
  if (deps?.['prisma']) return {
    name: 'prisma',
    description: '数据库模型在 schema.prisma 中定义',
    modelFieldPattern: 'model ',
  }
  if (deps?.['mongoose']) return {
    name: 'mongoose',
    description: '数据库模型使用 Mongoose Schema 定义',
    modelFieldPattern: 'Schema',
  }
  if (deps?.['knex']) return {
    name: 'knex',
    description: '数据库使用 Knex query builder，迁移文件定义表结构',
  }
  return null
}

async function detectRoutingPattern(
  sandboxPath: string,
  deps: Record<string, string>,
): Promise<{ pattern: string; description: string; contextFile?: string; semanticTags?: string[] } | null> {
  // React Router
  if (deps?.['react-router'] || deps?.['react-router-dom']) {
    // 扫描 main.jsx 看路由注册方式
    const mainFile = await findFile(sandboxPath, ['frontend/src/main.jsx', 'frontend/src/main.tsx', 'src/main.jsx', 'src/main.tsx', 'src/index.jsx', 'src/index.tsx'])
    if (mainFile) {
      const content = await readFile(mainFile, 'utf-8')
      const relPath = relative(sandboxPath, mainFile).replace(/\\/g, '/')
      if (content.includes('<Route') || content.includes('createBrowserRouter')) {
        return {
          pattern: 'inline-routes',
          description: `路由在 ${relPath} 中内联定义（<Route>），不要创建独立的路由配置文件`,
          contextFile: relPath,
          semanticTags: ['Outlet', 'Route', 'Link', 'NavLink', 'Navigate', 'Routes'],
        }
      }
    }
    return {
      pattern: 'react-router',
      description: '使用 React Router 管理路由',
      semanticTags: ['Outlet', 'Route', 'Link', 'NavLink', 'Navigate', 'Routes'],
    }
  }

  // Next.js App Router
  if (deps?.['next']) {
    return {
      pattern: 'next-app-router',
      description: '使用 Next.js App Router（app/ 目录下的 page.tsx 和 layout.tsx）',
    }
  }

  // Vue Router
  if (deps?.['vue-router']) {
    return {
      pattern: 'vue-router',
      description: '使用 Vue Router，在 router/index.ts 中定义路由配置',
    }
  }

  // Express API routes
  if (deps?.['express']) {
    return {
      pattern: 'express-router',
      description: '后端 API 使用 Express Router 定义路由',
    }
  }

  return null
}

async function detectComponentStructure(sandboxPath: string): Promise<{ pattern: string; description: string } | null> {
  // 扫描 components 目录，检测命名约定
  const componentDirs = [
    'frontend/src/components',
    'src/components',
    'app/components',
  ]

  for (const dir of componentDirs) {
    const fullPath = join(sandboxPath, dir)
    try {
      const entries = await readdir(fullPath, { withFileTypes: true })
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)

      if (dirs.length === 0) continue

      // 检测是否有 ComponentName/ComponentName.jsx + index.js 模式
      let barrelPattern = 0
      let flatPattern = 0
      for (const d of dirs.slice(0, 10)) {
        const dirPath = join(fullPath, d)
        const files = await readdir(dirPath).catch(() => [])
        const hasIndex = files.some(f => f === 'index.js' || f === 'index.ts' || f === 'index.jsx' || f === 'index.tsx')
        const hasSelfNamed = files.some(f => f.startsWith(d) && /\.(jsx?|tsx)$/.test(f))
        if (hasIndex && hasSelfNamed) barrelPattern++
        else flatPattern++
      }

      if (barrelPattern > flatPattern) {
        return {
          pattern: 'barrel',
          description: `组件目录结构为 ComponentName/ComponentName.jsx + ComponentName/index.js（barrel re-export）`,
        }
      }
      return {
        pattern: 'flat',
        description: `组件为扁平结构（直接在 components/ 下放置文件）`,
      }
    } catch {}
  }

  return null
}

function detectStylingPattern(deps: Record<string, string>, sandboxPath: string): string | null {
  if (deps?.['styled-components']) return '样式使用 styled-components（CSS-in-JS）'
  if (deps?.['@emotion/react'] || deps?.['@emotion/styled']) return '样式使用 Emotion（CSS-in-JS）'
  if (deps?.['tailwindcss']) return '样式使用 Tailwind CSS'
  if (deps?.['sass'] || deps?.['node-sass']) return '样式使用 SCSS 文件'
  if (deps?.['less']) return '样式使用 LESS 文件'
  // 默认：普通 CSS
  return '样式使用 CSS 文件'
}

function detectAPIPattern(deps: Record<string, string>): string | null {
  if (deps?.['express'] && deps?.['sequelize']) return '后端 API 在 routes/ 中定义，使用 Express Router + Sequelize ORM'
  if (deps?.['express']) return '后端 API 在 routes/ 中定义，使用 Express Router'
  if (deps?.['koa']) return '后端 API 使用 Koa Router'
  if (deps?.['fastify']) return '后端 API 使用 Fastify 路由'
  return null
}

function detectDependencyConstraints(deps: Record<string, string>): string | null {
  if (!deps) return null
  const available = Object.keys(deps).filter(k => !k.startsWith('@types/')).slice(0, 20)
  if (available.length > 0) {
    return `只使用 package.json 中已安装的依赖，不要引入未安装的库。已安装：${available.join(', ')}`
  }
  return null
}

async function detectEntryFiles(sandboxPath: string): Promise<string[]> {
  const candidates = [
    'frontend/src/main.jsx', 'frontend/src/main.tsx',
    'frontend/src/App.jsx', 'frontend/src/App.tsx',
    'src/main.jsx', 'src/main.tsx',
    'src/App.jsx', 'src/App.tsx',
    'src/index.jsx', 'src/index.tsx',
    'app/layout.tsx', 'app/page.tsx',
    'frontend/package.json',
    'package.json',
  ]

  const found: string[] = []
  for (const file of candidates) {
    try {
      await stat(join(sandboxPath, file))
      found.push(file)
    } catch {}
  }
  return found
}

// ─── 工具函数 ───

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

async function findFile(base: string, candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      await stat(join(base, c))
      return join(base, c)
    } catch {}
  }
  return null
}
