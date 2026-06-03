import { readFileSync } from 'fs'

// 读取 .env（去掉行内注释）
const env = Object.fromEntries(
  readFileSync('.env', 'utf-8')
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

const ENDPOINT = env.DOUBAO_ENDPOINT
const API_KEY = env.DOUBAO_API_KEY
const MODEL = env.DOUBAO_MODEL

async function chat(messages, maxTokens = 2048) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  })
  const data = await res.json()
  if (data.error) return `错误: ${JSON.stringify(data.error)}`
  const content = data.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
}

const DIVIDER = '\n' + '='.repeat(60) + '\n'

const SYSTEM_PROMPT = `你是需求澄清专家。PM 用自然语言描述需求，你输出结构化需求 JSON。

## 需求类型（type）

- add_display：纯前端展示变更，只改前端，不改后端
- add_page：新增页面、Tab、路由，改前端，可能需要路由注册
- add_field：给数据库模型新增字段，改 model + API + 前端展示
- modify_api：修改已有 API 的行为（返回值、过滤、排序等），改 API + 前端
- add_feature：新功能，需要新字段 + 新 API + 新业务逻辑（如幂等、状态枚举），改 model + API + 前端

## 输出格式

严格 JSON，不要其他文字：
{
  "type": "add_display|add_page|add_field|modify_api|add_feature",
  "entity": "Article|Comment|User|Tag|Profile",
  "fields": [{"name":"字段名","type":"类型","description":"描述"}],
  "scope": "frontend|backend|fullstack",
  "description": "需求描述"
}`

// ============================================================
// L1 + L2 测试题
// ============================================================

const tests = [
  // L1
  {
    name: 'L1-1: 文章列表加阅读量',
    pmInput: '在首页文章卡片上增加阅读量 icon + 数字展示，前端假数据即可，不改后端',
    expectedType: 'add_display',
  },
  {
    name: 'L1-2: Tags 前 5 个打标',
    pmInput: '为 Popular Tags 侧边栏接口返回的前 5 个标签增加视觉标识，纯前端取前 5',
    expectedType: 'add_display',
  },
  {
    name: 'L1-3: About Me Tab',
    pmInput: '在 Profile 页面现有 My Articles / Favorited Articles 之外新增一个 About Me Tab，展示 User.bio',
    expectedType: 'add_page',
  },
  {
    name: 'L1-4: 字数统计',
    pmInput: '在文章正文下方显示"本文共 XXX 字，预计阅读 X 分钟"，前端基于 Article.body 计算',
    expectedType: 'add_display',
  },
  // L2
  {
    name: 'L2-1: 文章加封面图',
    pmInput: 'Article 模型加 coverImage 字段，新建/编辑文章表单支持输入 URL，列表卡片和详情页展示封面图',
    expectedType: 'add_field',
  },
  {
    name: 'L2-2: 评论支持点赞',
    pmInput: 'Comment 增加 likeCount，并设计幂等点赞机制',
    expectedType: 'add_feature',
  },
  {
    name: 'L2-3: 文章草稿功能',
    pmInput: 'Article 增加 status 枚举（draft/published），编辑器新增"保存草稿"，列表默认过滤 draft，个人主页增加 Drafts Tab',
    expectedType: 'add_feature',
  },
  {
    name: 'L2-4: 最后编辑时间展示',
    pmInput: '利用 updatedAt 在文章详情页展示"最后编辑于 X 小时前"，同时后端保证 update 会刷新该字段',
    expectedType: 'modify_api',
  },
]

// ============================================================
// 运行
// ============================================================

console.log(`模型: ${MODEL}`)
console.log(`接口: ${ENDPOINT}\n`)

let pass = 0
let fail = 0

for (const test of tests) {
  console.log(`--- ${test.name} ---`)
  console.log(`PM: "${test.pmInput}"`)

  const result = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: test.pmInput },
  ])

  // 解析 JSON
  let json = null
  try {
    json = JSON.parse(result)
  } catch {
    const match = result.match(/\{[\s\S]*\}/)
    if (match) {
      try { json = JSON.parse(match[0]) } catch {}
    }
  }

  if (json) {
    const ok = json.type === test.expectedType
    if (ok) pass++; else fail++

    console.log(`${ok ? '✅' : '❌'} type: ${json.type} (期望: ${test.expectedType})`)
    console.log(`   entity: ${json.entity}`)
    console.log(`   scope: ${json.scope}`)
    console.log(`   fields: ${JSON.stringify(json.fields)}`)
    if (!ok) console.log(`   ⚠️ type 不匹配`)
  } else {
    fail++
    console.log(`❌ JSON 解析失败:\n${result}`)
  }

  console.log(DIVIDER)
}

console.log(`结果: ${pass}/${pass + fail} 通过`)
