/**
 * TheHand CLI — 手动测试 Agent 链路
 * 用法: node cli.mjs "给文章加阅读时长"
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
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

// ============================================================
// LLM 调用
// ============================================================
async function llmChat(systemPrompt, userMessage) {
  const res = await fetch(env.DOUBAO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DOUBAO_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DOUBAO_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(JSON.stringify(data.error))
  return data.choices?.[0]?.message?.content ?? ''
}

// ============================================================
// 加载 Prompt 模板
// ============================================================
function loadPrompt(agentName) {
  return readFileSync(resolve(__dirname, 'prompts', agentName, 'v1.md'), 'utf-8')
}

// ============================================================
// 澄清 Agent
// ============================================================
async function runClarification(pmInput, currentReq = null) {
  const systemPrompt = loadPrompt('clarification')

  let userMessage = pmInput
  if (currentReq) {
    userMessage = `当前结构化需求：\n${JSON.stringify(currentReq, null, 2)}\n\nPM 新回复：${pmInput}`
  }

  const response = await llmChat(systemPrompt, userMessage)

  // 解析 JSON
  try {
    const json = JSON.parse(response)
    if (json.type && json.entity) {
      return { requirement: json, needsMoreInfo: false, questions: null }
    }
  } catch {
    const match = response.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const json = JSON.parse(match[0])
        if (json.type && json.entity) {
          return { requirement: json, needsMoreInfo: false, questions: null }
        }
      } catch {}
    }
  }

  // LLM 返回的是追问
  const questions = response.match(/[^。\n]+[？?]/g) ?? [response.trim()]
  return {
    requirement: currentReq ?? { type: 'unknown', entity: 'unknown', scope: 'fullstack', description: pmInput },
    needsMoreInfo: true,
    questions: questions.map(q => q.trim()),
  }
}

// ============================================================
// 方案 Agent
// ============================================================
async function runPlan(requirement) {
  const systemPrompt = loadPrompt('plan')
  const projectContext = readFileSync(resolve(__dirname, 'projects/conduit/context/models.json'), 'utf-8')
  const routes = readFileSync(resolve(__dirname, 'projects/conduit/context/routes.json'), 'utf-8')

  const userMessage = `结构化需求：\n${JSON.stringify(requirement, null, 2)}\n\n项目模型定义：\n${projectContext}\n\n路由表：\n${routes}`

  const response = await llmChat(systemPrompt, userMessage)

  try {
    return JSON.parse(response)
  } catch {
    const match = response.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('方案 Agent 返回非 JSON:\n' + response)
  }
}

// ============================================================
// 编码 Agent
// ============================================================
async function runCoding(plan) {
  const systemPrompt = loadPrompt('coding')
  const results = []

  for (const file of plan.files) {
    // 读取原始文件
    let originalContent = ''
    try {
      originalContent = readFileSync(resolve(__dirname, 'sandbox-repo', file.path), 'utf-8')
    } catch {
      // 新文件，没有原始内容
    }

    const userMessage = `技术方案：\n${JSON.stringify(file, null, 2)}\n\n原始文件 ${file.path}：\n\`\`\`\n${originalContent}\n\`\`\``

    const response = await llmChat(systemPrompt, userMessage)

    // 提取代码
    let content = response
    const codeMatch = response.match(/```(?:javascript|js)?\n([\s\S]*?)```/)
    if (codeMatch) content = codeMatch[1]

    results.push({
      path: file.path,
      content: content.trim(),
      summary: file.changeDescription,
    })
  }

  return results
}

// ============================================================
// 主流程
// ============================================================
const pmInput = process.argv[2]
if (!pmInput) {
  console.log('用法: node cli.mjs "你的需求描述"')
  console.log('示例: node cli.mjs "给文章加阅读时长"')
  process.exit(0)
}

// 启动日志记录
const logger = new RunLogger('cli')
logger.start(pmInput)

console.log(`\n${'='.repeat(60)}`)
console.log(`PM 输入: "${pmInput}"`)
console.log(`${'='.repeat(60)}\n`)

// Step 1: 澄清
console.log('--- Step 1: 澄清 ---\n')
const clarification = await runClarification(pmInput)

if (clarification.needsMoreInfo) {
  console.log('需要更多信息:')
  clarification.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`))
  console.log('\n(跳过追问，使用当前信息继续)')
} else {
  console.log('结构化需求:')
  console.log(JSON.stringify(clarification.requirement, null, 2))
}

// Step 2: 方案
console.log('\n--- Step 2: 方案 ---\n')
const plan = await runPlan(clarification.requirement)
console.log('修改方案:')
console.log(JSON.stringify(plan, null, 2))

// Step 3: 编码
console.log('\n--- Step 3: 编码 ---\n')
const codeResults = await runCoding(plan)
for (const file of codeResults) {
  console.log(`[${file.path}] ${file.summary}`)
  console.log(`  内容长度: ${file.content.length} 字符`)
}

console.log(`\n${'='.repeat(60)}`)
console.log('CLI 测试完成')
console.log(`${'='.repeat(60)}`)

// 结束日志记录
const logPath = logger.end()
console.log(`日志已保存: ${logPath}`)
