#!/usr/bin/env node
/**
 * thehand init — 根据目标仓库的 package.json、常见测试配置与目录结构，
 * 会读取目标仓库根目录若干 .env*（合并键，后读覆盖）与 package.json 依赖，推断数据库类型（仅协议/dialect，不打印密钥）。
 *
 * 用法：
 *   npm run thehand:init -- --repo /path/to/your-app [--id myapp] [--force]
 *   node scripts/thehand-init.mjs --repo ../sandbox-repo/conduit-realworld-example-app --id conduit
 *
 * 默认：--repo 为当前工作目录；--id 为仓库目录名；输出到本仓库 projects/<id>/
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const theHandRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { repo: null, id: null, force: false, help: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--force' || a === '-f') out.force = true
    else if (a === '--repo' && argv[i + 1]) {
      out.repo = argv[++i]
    } else if (a === '--id' && argv[i + 1]) {
      out.id = argv[++i]
    }
  }
  return out
}

function existsSync(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

function hasVitestConfig(dir) {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    return names.some(
      n =>
        /^vitest\.config\.(mts|cts|ts|js|mjs|cjs)$/i.test(n) ||
        n === 'vite.config.ts' ||
        n === 'vite.config.js',
    )
  } catch {
    return false
  }
}

function hasJestConfig(dir) {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    return names.some(n => /^jest\.config\.(js|ts|mjs|cjs)$/i.test(n) || n === 'jest.config.json')
  } catch {
    return false
  }
}

function depKeys(pkg) {
  const d = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  return Object.keys(d || {})
}

/** 解析 .env 风格（不输出值到控制台；仅用于推断数据库类型） */
function parseDotEnvFile(filePath) {
  const out = {}
  if (!existsSync(filePath)) return out
  let text
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return out
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}

function databaseKindFromConnectionString(str) {
  if (!str || typeof str !== 'string') return null
  const s = str.trim().toLowerCase()
  if (s.startsWith('mysql://') || s.startsWith('mariadb://')) return 'MySQL'
  if (s.startsWith('postgres://') || s.startsWith('postgresql://')) return 'PostgreSQL'
  if (s.startsWith('mongodb://') || s.startsWith('mongodb+srv://')) return 'MongoDB'
  if (s.startsWith('sqlite:') || /^file:.*\.sqlite/i.test(s)) return 'SQLite'
  return null
}

/**
 * 从仓库根目录若干 .env* 文件合并键（后读覆盖先读），再结合 package.json 依赖推断引擎。
 * 支持：DATABASE_URL、DB_URL、MYSQL_* 常见键；DB_DIALECT / DIALECT。
 */
function inferDatabaseEngine(repo, roots) {
  const envFiles = [
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.development.example',
    '.env.test.example',
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
  ]
  const merged = {}
  for (const name of envFiles) {
    Object.assign(merged, parseDotEnvFile(path.join(repo, name)))
  }

  const dialect = String(merged.DB_DIALECT || merged.DIALECT || merged.SEQUELIZE_DIALECT || '').toLowerCase()
  if (dialect === 'mysql' || dialect === 'mariadb') return 'MySQL（.env* 中 dialect）'
  if (dialect === 'postgres' || dialect === 'postgresql') return 'PostgreSQL（.env* 中 dialect）'
  if (dialect === 'sqlite' || dialect === 'sqlite3') return 'SQLite（.env* 中 dialect）'

  const urlKeys = [
    'DATABASE_URL',
    'DB_URL',
    'DATABASE_URI',
    'MYSQL_DATABASE_URL',
    'POSTGRES_URL',
    'PG_CONNECTION_STRING',
  ]
  for (const k of urlKeys) {
    const v = merged[k]
    if (!v) continue
    const kind = databaseKindFromConnectionString(v)
    if (kind) return `${kind}（.env* 中 ${k} 协议前缀）`
  }

  const all = new Set()
  for (const { pkg: p } of roots) depKeys(p).forEach(k => all.add(k))
  const keys = [...all]
  if (keys.some(k => k === 'mysql2' || k === 'mysql')) return 'MySQL（依赖含 mysql2/mysql）'
  if (keys.some(k => k === 'pg' || k === 'postgres')) return 'PostgreSQL（依赖含 pg）'
  if (keys.some(k => /sqlite3|better-sqlite3/i.test(k))) return 'SQLite（依赖含 sqlite）'
  if (keys.some(k => k === 'mongoose' || k.startsWith('mongodb'))) return 'MongoDB（依赖推断）'

  return null
}

function inferOrmFromDeps(roots) {
  const all = new Set()
  for (const { pkg: p } of roots) depKeys(p).forEach(k => all.add(k))
  const has = (x) => [...all].some(k => k.includes(x))
  if (has('sequelize')) return 'Sequelize'
  if (has('prisma')) return 'Prisma'
  if (has('typeorm')) return 'TypeORM'
  if (has('mongoose')) return 'mongoose'
  return '（未检测）'
}

function inferTechStack(repo, pkg, roots) {
  const all = new Set()
  for (const { pkg: p } of roots) depKeys(p).forEach(k => all.add(k))
  const has = (x) => [...all].some(k => k.includes(x))
  const frontend = has('react')
    ? has('vite')
      ? 'React + Vite'
      : 'React'
    : has('vue')
      ? 'Vue'
      : has('next')
        ? 'Next.js'
        : '（请手动填写）'
  const backend = has('express')
    ? 'Express'
    : has('fastify')
      ? 'Fastify'
      : has('koa')
        ? 'Koa'
        : has('@nestjs')
          ? 'NestJS'
          : '（无或未检测）'
  const engine = inferDatabaseEngine(repo, roots)
  const orm = inferOrmFromDeps(roots)
  const db = `${engine ?? '（未能从 .env* / package.json 推断数据库，请手动填写）'}；ORM：${orm}`
  const language = has('typescript') || roots.some(r => fs.existsSync(path.join(r.dir, 'tsconfig.json')))
    ? 'TypeScript'
    : 'JavaScript'
  return { frontend, backend, database: db, language }
}

function expandWorkspaceDirs(repo, pkg) {
  const roots = [{ dir: repo, pkg, rel: '' }]
  const ws = pkg.workspaces
  const patterns = Array.isArray(ws) ? ws : ws?.packages
  if (!patterns || !Array.isArray(patterns)) return roots
  for (const pat of patterns) {
    if (pat.includes('*')) {
      const parts = pat.split('/')
      const starIdx = parts.findIndex(p => p.includes('*'))
      if (starIdx < 0) continue
      const prefix = parts.slice(0, starIdx).join('/')
      const baseDir = path.join(repo, prefix || '.')
      if (!existsSync(baseDir)) continue
      for (const name of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!name.isDirectory() || name.name.startsWith('.')) continue
        const wdir = path.join(baseDir, name.name)
        const pj = path.join(wdir, 'package.json')
        if (existsSync(pj)) {
          const p = readJsonSafe(pj)
          if (p) roots.push({ dir: wdir, pkg: p, rel: path.join(prefix, name.name).split(path.sep).join('/') })
        }
      }
      continue
    }
    const wdir = path.join(repo, pat)
    const pj = path.join(wdir, 'package.json')
    if (existsSync(pj)) {
      const p = readJsonSafe(pj)
      if (p) roots.push({ dir: wdir, pkg: p, rel: pat.replace(/\\/g, '/') })
    }
  }
  return roots
}

function pickFirstExistingDir(repo, candidates) {
  for (const c of candidates) {
    const p = path.join(repo, c)
    if (existsSync(p) && fs.statSync(p).isDirectory()) return c.endsWith('/') ? c : `${c}/`
  }
  return ''
}

function inferStructure(repo) {
  const rootPkg = readJsonSafe(path.join(repo, 'package.json')) || {}
  const roots = expandWorkspaceDirs(repo, rootPkg)

  let frontend =
    pickFirstExistingDir(repo, ['frontend/src', 'apps/web/src', 'apps/frontend/src', 'client/src']) ||
    (existsSync(path.join(repo, 'src')) &&
    (existsSync(path.join(repo, 'src', 'App.jsx')) ||
      existsSync(path.join(repo, 'src', 'App.tsx')) ||
      existsSync(path.join(repo, 'src', 'main.jsx')) ||
      existsSync(path.join(repo, 'src', 'main.tsx')))
      ? 'src/'
      : '')

  if (!frontend) {
    for (const { dir, rel } of roots) {
      if (existsSync(path.join(dir, 'src')) && (depKeys(readJsonSafe(path.join(dir, 'package.json')) || {}).length || true)) {
        const prefix = rel ? `${rel}/` : ''
        frontend = `${prefix}src/`.replace(/^\//, '')
        break
      }
    }
  }

  const backend =
    pickFirstExistingDir(repo, ['backend', 'server', 'api', 'apps/api', 'apps/server']) ||
    (() => {
      const ws = roots.find(r => r.rel && /backend|server|api/i.test(r.rel))
      return ws ? `${ws.rel}/` : ''
    })()

  const b = backend.replace(/\/$/, '')
  const modelCandidates = ['backend/models/', 'server/models/']
  if (b) modelCandidates.unshift(`${b}/models/`)
  const models = pickFirstExistingDir(repo, modelCandidates).replace(/^\//, '')

  const routeCandidates = ['backend/routes/', 'server/routes/']
  if (b) routeCandidates.unshift(`${b}/routes/`)
  const routes = pickFirstExistingDir(repo, routeCandidates).replace(/^\//, '')

  let components = ''
  if (frontend) {
    const fc = path.join(repo, frontend.replace(/\/$/, ''), 'components')
    if (existsSync(fc)) components = `${frontend.replace(/\/$/, '')}/components/`
  }

  return {
    frontend: frontend || '（请手动填写 frontend/src 等）',
    backend: backend || '（请手动填写 backend 等）',
    models: models || '',
    routes: routes || '',
    components: components || '',
  }
}

function inferTestCommand(repo, rootPkg, roots) {
  if (rootPkg.scripts?.test && typeof rootPkg.scripts.test === 'string') {
    const t = rootPkg.scripts.test.trim()
    // 编排器在沙箱内对 commands.test 做 exec，不经 npm 时裸 vitest 不在 PATH；对外统一用 npm test
    if (t === 'vitest' || t.startsWith('vitest ') || t === 'npx vitest' || t.startsWith('npx vitest ')) {
      return 'npm test'
    }
    return t
  }
  for (const { dir, rel, pkg } of roots) {
    if (!pkg) continue
    if (pkg.scripts?.test) {
      if (rel && rootPkg.workspaces) {
        const wsName = rel.split('/')[0] || rel
        return `npm run test -w ${wsName}`
      }
      const wt = pkg.scripts.test.trim()
      if (wt === 'vitest' || wt.startsWith('vitest ') || wt === 'npx vitest' || wt.startsWith('npx vitest ')) {
        return 'npm test'
      }
      return wt
    }
  }
  for (const { dir, rel } of roots) {
    try {
      if (hasVitestConfig(dir)) {
        return `npm test --prefix "${dir}"`
      }
    } catch {
      /* empty */
    }
  }
  for (const { dir } of roots) {
    try {
      if (hasJestConfig(dir)) return `npm test --prefix "${dir}"`
    } catch {
      /* empty */
    }
  }
  return 'npm test'
}

function listSourceFiles(relDir, repo, max) {
  const abs = path.join(repo, relDir.replace(/\/$/, ''))
  if (!existsSync(abs)) return []
  const acc = []
  const exts = /\.(jsx?|tsx?|vue|mjs|cjs)$/
  function walk(d, baseRel) {
    if (acc.length >= max) return
    let ents
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      const r = path.join(baseRel, e.name).split(path.sep).join('/')
      if (e.isDirectory()) walk(p, r)
      else if (exts.test(e.name)) {
        acc.push(r)
        if (acc.length >= max) return
      }
    }
  }
  walk(abs, relDir.replace(/\/$/, ''))
  return acc
}

function isResolvedPath(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('请手动') && !p.includes('（')
}

/**
 * Plan / recall 用的上下文路径：只列入目标仓库中真实存在的文件，避免默认指向不存在的 router.* 诱导臆造路由表。
 * 顺序：入口 → App → 独立 router（若确有该文件）。
 */
function pickExistingReadContextCandidates(repo, fe, max = 8) {
  const candidates = [
    `${fe}/main.jsx`,
    `${fe}/main.tsx`,
    `${fe}/index.jsx`,
    `${fe}/index.tsx`,
    `${fe}/App.jsx`,
    `${fe}/App.tsx`,
    `${fe}/router.jsx`,
    `${fe}/router.tsx`,
  ]
  const out = []
  for (const rel of candidates) {
    if (out.length >= max) break
    const abs = path.join(repo, rel)
    if (existsSync(abs)) out.push(rel)
  }
  if (out.length === 0) {
    return [`${fe}/main.jsx`, `${fe}/App.jsx`]
  }
  return out
}

/**
 * 写入 project.json 的 thehand 模板（routingIntegration 默认关闭，避免未改 glob 就误触发 Architect 注入）。
 * 路径按 structure.frontend 推断；若推断失败则退回 frontend/src。
 */
function buildTheHandTemplate(structure, repo) {
  const raw = typeof structure.frontend === 'string' ? structure.frontend : ''
  const bad = !raw || raw.includes('请手动') || raw.includes('（')
  const fe = (bad ? 'frontend/src' : raw).replace(/\\/g, '/').replace(/\/+$/, '')

  const shallowRoutesDir = `${fe}/routes`
  const entryCandidates = [
    `${fe}/main.jsx`,
    `${fe}/main.tsx`,
    `${fe}/index.jsx`,
    `${fe}/index.tsx`,
    `${fe}/App.jsx`,
    `${fe}/App.tsx`,
  ]

  return {
    routingIntegration: {
      enabled: false,
      routeEntryFiles: [`${fe}/main.jsx`, `${fe}/main.tsx`],
      nestedNewPageGlob: `${fe}/routes/**/*.jsx`,
      nestedNewPageExcludeGlobs: [],
      injectSiblingRouteHint: '与同级路由或 Tab 一致（按项目修改）',
      nestedRouteParentHint: '父布局 / 导航中的 path 或路由名须一致（按项目修改）',
    },
    recallL1: {
      entryCandidates,
      shallowRoutesDir,
    },
    orphanGuard: {
      entrySkipGlobs: [
        '**/main.jsx',
        '**/main.tsx',
        '**/bootstrap.jsx',
        '**/bootstrap.tsx',
        '**/bootstrap.js',
        '**/bootstrap.ts',
      ],
    },
    readContextCandidates: pickExistingReadContextCandidates(repo, fe),
  }
}

function buildKeyFiles(structure, repo) {
  const out = { models: [], routes: [], components: [], services: [] }
  if (isResolvedPath(structure.models)) out.models = listSourceFiles(structure.models, repo, 25)
  if (isResolvedPath(structure.routes)) out.routes = listSourceFiles(structure.routes, repo, 25)
  if (isResolvedPath(structure.components)) out.components = listSourceFiles(structure.components, repo, 35)
  const svcCandidates = ['frontend/src/services/', 'src/services/']
  if (isResolvedPath(structure.frontend)) {
    svcCandidates.unshift(`${structure.frontend.replace(/\/$/, '')}/services/`)
  }
  const svc = pickFirstExistingDir(repo, svcCandidates)
  if (svc) out.services = listSourceFiles(svc, repo, 20)
  return out
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(`Usage: node scripts/thehand-init.mjs [--repo DIR] [--id ID] [--force]

  --repo   目标应用仓库根目录（含 package.json），默认当前目录
  --id     写入本仓库 projects/<id>/，默认取仓库目录名
  --force  已存在 project.json 时覆盖
`)
    process.exit(0)
  }

  const repo = path.resolve(process.cwd(), args.repo || '.')
  const pkgPath = path.join(repo, 'package.json')
  if (!existsSync(pkgPath)) {
    console.error(`[thehand-init] 未找到 package.json: ${pkgPath}`)
    process.exit(1)
  }

  const rootPkg = readJsonSafe(pkgPath)
  const roots = expandWorkspaceDirs(repo, rootPkg)
  const id = args.id || path.basename(repo.replace(/[/\\]$/, '')) || 'myapp'
  const outDir = path.join(theHandRoot, 'projects', id)
  const outFile = path.join(outDir, 'project.json')
  const readmeFile = path.join(outDir, 'INIT.generated.md')

  if (existsSync(outFile) && !args.force) {
    console.error(`[thehand-init] 已存在 ${outFile}，请加 --force 覆盖`)
    process.exit(1)
  }

  const structure = inferStructure(repo)
  const techStack = inferTechStack(repo, rootPkg, roots)
  const test = inferTestCommand(repo, rootPkg, roots)
  const lint =
    (rootPkg.scripts && typeof rootPkg.scripts.lint === 'string' && rootPkg.scripts.lint.trim()) ||
    "echo 'lint: 请在 package.json 增加 scripts.lint 后改 project.json'"
  let build =
    (rootPkg.scripts && typeof rootPkg.scripts.build === 'string' && rootPkg.scripts.build.trim()) || ''
  // 根 package 无 build 但为 npm workspaces 且存在 frontend 子包带 vite build 时，供 TheHand 测试阶段跑 Vite 编译
  if (
    !build &&
    Array.isArray(rootPkg.workspaces) &&
    rootPkg.workspaces.some(w => /(^|\/)frontend$/i.test(String(w).replace(/\\/g, '/')))
  ) {
    const fePkgPath = path.join(repo, 'frontend', 'package.json')
    if (existsSync(fePkgPath)) {
      const fePkg = readJsonSafe(fePkgPath)
      if (fePkg.scripts && typeof fePkg.scripts.build === 'string' && fePkg.scripts.build.trim()) {
        build = 'npm run build -w frontend'
      }
    }
  }
  const dev =
    (rootPkg.scripts && typeof rootPkg.scripts.dev === 'string' && rootPkg.scripts.dev.trim()) || ''

  const keyFiles = buildKeyFiles(structure, repo)

  const draft = {
    id,
    name: (rootPkg.name && String(rootPkg.name)) || id,
    repo: typeof rootPkg.repository === 'string' ? rootPkg.repository : rootPkg.repository?.url || '',
    techStack,
    structure,
    keyFiles,
    commands: { lint, test, dev, build },
    constraints: {},
    thehand: buildTheHandTemplate(structure, repo),
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf-8')

  const readme = `# ${id}（thehand init 草稿）

- 生成时间: ${new Date().toISOString()}
- 扫描仓库: \`${repo}\`

## 你必须手动的部分

1. **constraints**：把路由入口、Navbar、目录约定等写进 \`project.json\` 的 \`constraints\`（见 README「接入新项目」与 prompts/plan）。
2. **thehand**：已生成模板块。\`routingIntegration.enabled\` 默认为 \`false\`；若需要 Architect 自动把「新建子页」补进顶层路由表，请改为 \`true\` 并按仓库调整 \`routeEntryFiles\`、\`nestedNewPageGlob\` / \`nestedNewPageExcludeGlobs\`。\`readContextCandidates\` 已按仓库内**真实存在**的 main/index/App/router 路径填充；若仍不全请手改。\`recallL1\` / \`orphanGuard\` 可按目录结构微调。
3. **commands**：若 monorepo 测试需 \`-w package\`，请改成与你团队一致的命令。
4. **structure / keyFiles**：若推断路径不对，直接改 JSON（并同步修正 \`thehand\` 里与 \`structure.frontend\` 相关的路径）。
5. **techStack.database**：脚本会读 \`.env*\` 里 \`DATABASE_URL\` 协议前缀、\`DB_DIALECT\` 及 \`mysql2\`/\`pg\` 等依赖；若仓库只用 docker-compose 或 CI 密钥注入而无本地 .env，可能推断失败，请手改。

删除本说明文件不影响加载；TheHand 只读取 \`project.json\` 与可选 \`context/*.json\`。
`
  fs.writeFileSync(readmeFile, readme, 'utf-8')

  console.log(`[thehand-init] 已写入:\n  ${outFile}\n  ${readmeFile}`)
  console.log(`[thehand-init] 推断 test: ${test}`)
  console.log(`[thehand-init] 推断 database: ${techStack.database}`)
  console.log(`[thehand-init] 下一步: 编辑 constraints / thehand 模板，并在编排/API 中使用 projectId=${id}`)
}

main()
