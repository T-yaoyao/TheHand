/**
 * TheHand CLI — 使用 Orchestrator 的正式端到端测试
 * 用法: node cli-orchestrator.mjs "给文章加阅读时长"
 */
import { readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { RunLogger } from './log.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============================================================
// 读取 .env
// ============================================================
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '.env'), 'utf-8')
    .split('\n')
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const idx = line.indexOf('=')
      const key = line.slice(0, idx).trim()
      let val = line.slice(idx + 1).trim()
      const commentIdx = val.indexOf('  #')
      if (commentIdx !== -1) val = val.slice(0, commentIdx).trim()
      return [key, val]
    })
    .filter(([k, v]) => k && v)
)

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = ((ms % 60000) / 1000).toFixed(0)
  return `${m}m${s}s`
}

// 设置环境变量
Object.assign(process.env, env)

// ============================================================
// 动态导入 core 模块（需要先编译）
// ============================================================
async function main() {
  const pmInput = process.argv[2]
  if (!pmInput) {
    console.log('用法: node cli-orchestrator.mjs "你的需求描述"')
    console.log('示例: node cli-orchestrator.mjs "给文章加阅读时长"')
    process.exit(0)
  }

  // 启动日志记录
  const logger = new RunLogger('orchestrator')
  logger.start(pmInput)

  // 编译 core（确保 dist 与源码同步）
  const { execSync } = await import('child_process')
  execSync('npm run build', { cwd: resolve(__dirname, 'core'), stdio: 'inherit' })

  // 动态导入编译后的模块
  const {
    LLMClient,
    PromptManager,
    AgentRunner,
    SkillRegistry,
    DockerSandboxManager,
    RequirementMemory,
    ProjectMemory,
    Orchestrator,
    createFileReadTool,
    createFileWriteTool,
    createShellTool,
    resolveSandboxRepoAbs,
    resolveProjectsDir,
    getDefaultProjectId,
    assertTheHandRequiredEnv,
  } = await import('./core/dist/index.js')

  assertTheHandRequiredEnv()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`TheHand Orchestrator Pipeline`)
  console.log(`PM 输入: "${pmInput}"`)
  console.log(`${'='.repeat(60)}\n`)

  // 1. 创建依赖
  const projectId = getDefaultProjectId()
  const llmClient = new LLMClient()
  const promptManager = new PromptManager(resolve(__dirname, 'prompts'))
  const projectMemory = new ProjectMemory(resolveProjectsDir())
  const requirementMemory = new RequirementMemory()

  // 创建沙箱管理器（Docker 容器隔离）
  const sandboxPath = resolveSandboxRepoAbs()
  const sandboxManager = new DockerSandboxManager(sandboxPath, {
    network: process.env.SANDBOX_NETWORK ?? 'none',
    memory: process.env.SANDBOX_MEMORY ?? '1g',
    cpus: process.env.SANDBOX_CPUS ?? '1.0',
  })

  // 创建工具
  const tools = [
    createFileReadTool(sandboxPath),
    createFileWriteTool(sandboxPath),
    createShellTool(sandboxPath),
  ]

  // 创建 Agent Runner
  const agentRunner = new AgentRunner(llmClient, tools, sandboxPath)

  // 创建 Skill Registry
  const skillRegistry = new SkillRegistry()
  skillRegistry.setLLMClient(llmClient)
  await skillRegistry.discover(join(resolveProjectsDir(), projectId))

  // 2. 创建 Orchestrator
  const orchestrator = new Orchestrator({
    agentRunner,
    llmClient,
    promptManager,
    skillRegistry,
    sandboxManager,
    projectMemory,
    requirementMemory,
  })

  // 3. 创建需求对象
  const requirement = {
    id: crypto.randomUUID(),
    status: 'idle',
    pmInput,
    structuredRequirement: null,
    plan: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // 4. 运行 Orchestrator
  console.log('--- 运行 Orchestrator ---\n')

  const pipelineStart = Date.now()
  let eventCount = 0
  let phaseStart = pipelineStart
  const phaseTimings = []

  for await (const event of orchestrator.run(requirement, projectId)) {
    const now = Date.now()

    // 记录每个阶段的耗时
    if (event.type === 'status-change' || event.type === 'executing' || event.type === 'plan-ready' || event.type === 'test-result' || event.type === 'completed' || event.type === 'failed') {
      const phaseDuration = now - phaseStart
      if (eventCount > 0) {
        phaseTimings.push({ phase: event.phase ?? event.status ?? event.type, durationMs: phaseDuration })
      }
      phaseStart = now
    }
    eventCount++
    const timestamp = new Date().toISOString().slice(11, 19)

    switch (event.type) {
      case 'status-change':
        console.log(`[${timestamp}] 状态变更: ${event.status} (Agent: ${event.agent})`)
        break
      case 'waiting-for-pm':
        console.log(`[${timestamp}] 等待 PM 回复:`)
        event.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`))
        break
      case 'plan-ready':
        console.log(`[${timestamp}] 方案就绪:`)
        event.plan.forEach(f => console.log(`  - ${f.path}: ${f.changeDescription}`))
        break
      case 'executing':
        console.log(`[${timestamp}] 执行中: ${event.phase} (${event.progress}%)`)
        break
      case 'test-result':
        console.log(`[${timestamp}] 测试结果: ${event.passed ? '✅ PASSED' : '❌ FAILED'}`)
        if (!event.passed) console.log(`  详情: ${event.details?.slice(0, 200)}`)
        break
      case 'completed':
        console.log(`\n[${timestamp}] ✅ 需求完成!`)
        console.log(`  结构化需求: ${JSON.stringify(event.requirement.structuredRequirement, null, 2)}`)
        break
      case 'failed':
        console.log(`\n[${timestamp}] ❌ 需求失败: ${event.error}`)
        break
    }
  }

  const pipelineEnd = Date.now()
  const totalDuration = pipelineEnd - pipelineStart

  console.log(`\n${'='.repeat(60)}`)
  console.log(`共处理 ${eventCount} 个事件`)

  // 端到端时间统计
  console.log(`\n时间统计:`)
  console.log(`  端到端总耗时: ${formatDuration(totalDuration)}`)
  console.log(`  各阶段耗时:`)
  for (const t of phaseTimings) {
    console.log(`    ${t.phase}: ${formatDuration(t.durationMs)} (${(t.durationMs / totalDuration * 100).toFixed(0)}%)`)
  }

  // Token 统计
  const stats = llmClient.getStats()
  console.log(`\nToken 统计:`)
  console.log(`  输入: ${stats.inputTokens}`)
  console.log(`  输出: ${stats.outputTokens}`)
  console.log(`  调用次数: ${stats.calls}`)
  console.log(`  平均延迟: ${formatDuration(stats.avgLatency)}`)
  console.log(`  预估成本: ¥${stats.estimatedCost.toFixed(4)}`)
  console.log(`${'='.repeat(60)}\n`)

  // 结束日志记录
  const logPath = logger.end()
  console.log(`日志已保存: ${logPath}`)
}

main().catch(err => {
  console.error('执行失败:', err)
  process.exit(1)
})
