/**
 * 检测「整文件凭记忆重写」导致的常见退化：体量骤减、React hooks 消失、关键 import 消失。
 * 用于编码写入前阻断，触发带说明的重试；可用 THEHAND_DISABLE_REGRESSION_GUARD=1 关闭。
 */

const HOOK_CHECKS: { label: string; re: RegExp }[] = [
  { label: 'useState', re: /\buseState\s*\(/ },
  { label: 'useEffect', re: /\buseEffect\s*\(/ },
  { label: 'useReducer', re: /\buseReducer\s*\(/ },
  { label: 'useLayoutEffect', re: /\buseLayoutEffect\s*\(/ },
  { label: 'useMemo', re: /\buseMemo\s*\(/ },
  { label: 'useCallback', re: /\buseCallback\s*\(/ },
  { label: 'useRef', re: /\buseRef\s*\(/ },
  { label: 'useContext', re: /\buseContext\s*\(/ },
]

function countImportLines(src: string): number {
  const m = src.match(/^import\s+/gm)
  return m?.length ?? 0
}

/**
 * @param original 磁盘上修改前的文件全文（已存在文件）
 * @param generated 本轮 LLM 提交的完整正文
 */
export function detectCodingRegression(original: string, generated: string): {
  suspicious: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  const o = original
  const g = generated
  if (!o.trim() || o === '（新文件，不存在）') return { suspicious: false, reasons: [] }
  if (g === '__DELETE__') return { suspicious: false, reasons: [] }

  const oLen = o.length
  const gLen = g.length

  for (const { label, re } of HOOK_CHECKS) {
    if (re.test(o) && !re.test(g)) {
      reasons.push(`原版含 ${label}，生成稿中缺失`)
    }
  }

  const oImports = countImportLines(o)
  const gImports = countImportLines(g)
  if (oImports >= 2 && gImports < oImports - 1) {
    reasons.push(`import 语句从约 ${oImports} 条减至 ${gImports} 条，疑似丢失依赖`)
  }

  // 相对路径 services / api 等常被整段漏掉
  if (/from\s+['"][^'"]*\/services\/[^'"]+['"]/.test(o) && !/from\s+['"][^'"]*\/services\/[^'"]+['"]/.test(g)) {
    reasons.push('原版含对 services/ 模块的 import，生成稿中缺失')
  }

  if (oLen > 500 && gLen < oLen * 0.45) {
    reasons.push(`生成稿长度约为原版的 ${Math.round((100 * gLen) / oLen)}%（${gLen}/${oLen} 字符），疑似大段删减或未基于原版编辑`)
  }

  // 任一 hook 丢失即视为高风险；无 hook 文件则要求至少两条独立信号才告警，减少误报
  const hookLost = HOOK_CHECKS.some(({ re }) => re.test(o) && !re.test(g))
  const suspicious =
    hookLost ||
    reasons.length >= 2 ||
    (reasons.length >= 1 && oLen > 800 && gLen < oLen * 0.38)

  return { suspicious, reasons }
}

export function formatRegressionRetryHint(pathsAndReasons: { path: string; reasons: string[] }[]): string {
  if (pathsAndReasons.length === 0) return ''
  const lines = pathsAndReasons.map(
    ({ path, reasons }) => `- **${path}**：${reasons.join('；')}`,
  )
  return `

## 编码自检：疑似「整文件凭记忆重写」退化（必须修正）

以下文件在沙箱磁盘上**仍有较完整旧版**，但本轮提交相对旧版明显变短、或丢失了 hooks / 关键 import。**禁止**从零默写组件；你必须以**本请求用户消息中「各文件原始内容」里的对应代码块**为唯一基底，在其上做**最小必要修改**后重新输出完整文件。

${lines.join('\n')}

若你认为旧版本身错误、必须大改，仍须**逐段保留**数据流（state、effects、数据请求）除非方案明确要求删除。`
}
