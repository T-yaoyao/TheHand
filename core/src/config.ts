/**
 * 全局配置常量
 * 所有魔法数字集中管理，支持环境变量覆盖
 * 所有枚举值单一数据源，其他模块从此 import
 */

// ── 重试策略 ──
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? '3', 10)
export const MAX_CLARIFICATION_ROUNDS = parseInt(process.env.MAX_CLARIFICATION_ROUNDS ?? '3', 10)
export const MAX_AGENT_ROUNDS = parseInt(process.env.MAX_AGENT_ROUNDS ?? '10', 10)

// ── LLM 配置 ──
export const DEFAULT_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE ?? '0.1')
export const DEFAULT_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS ?? '4096', 10)
export const CODING_MAX_TOKENS = parseInt(process.env.LLM_CODING_MAX_TOKENS ?? '16384', 10)

// ── 超时（毫秒）──
export const SHELL_TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS ?? '60000', 10)
export const BUILD_TIMEOUT_MS = parseInt(process.env.BUILD_TIMEOUT_MS ?? '120000', 10)
export const TEST_TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS ?? '120000', 10)
export const DEPS_INSTALL_TIMEOUT_MS = parseInt(process.env.DEPS_INSTALL_TIMEOUT_MS ?? '180000', 10)
export const GIT_TIMEOUT_MS = parseInt(process.env.GIT_TIMEOUT_MS ?? '30000', 10)
export const LLM_REQUEST_TIMEOUT_MS = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? '120000', 10)

// ── 缓冲区大小 ──
export const SHELL_MAX_BUFFER_BYTES = parseInt(process.env.SHELL_MAX_BUFFER ?? String(5 * 1024 * 1024), 10)
export const TEST_OUTPUT_MAX_CHARS = 2000
export const ERROR_OUTPUT_MAX_CHARS = 1000

// ── Context 管理 ──
export const MAX_CONVERSATIONS_IN_CONTEXT = parseInt(process.env.MAX_CONVERSATIONS ?? '10', 10)
export const MAX_LESSONS_IN_CONTEXT = parseInt(process.env.MAX_LESSONS ?? '5', 10)
export const MAX_SSE_EVENTS = 500
export const SSE_TRIM_TO = 250

// ── 编码分批 ──
export const MAX_FILES_PER_BATCH = parseInt(process.env.MAX_FILES_PER_BATCH ?? '3', 10)

// ── Token 估算系数 ──
export const CHARS_PER_TOKEN_ZH = 1.5   // 中文字符 → token
export const CHARS_PER_TOKEN_EN = 0.25  // 英文字符 → token
export const TOKEN_ESTIMATE_SAFETY_MARGIN = 1.2 // 安全系数

// ── 定价（元/百万 tokens）──
export const PRICING_CNY_PER_MILLION = {
  input: 0.6,
  output: 3.6,
} as const
export const TOKENS_PER_MILLION = 1_000_000

// ── 风险评估阈值 ──
export const RISK_AUTO_APPROVE_THRESHOLD = 80
export const RISK_LOW_THRESHOLD = 80
export const RISK_MEDIUM_THRESHOLD = 50

// ── 代码输出校验 ──
export const MIN_OUTPUT_CONTENT_RATIO = 0.3  // FC 输出中有效 JSON 占比最低阈值

// ── 危险代码模式 ──
export const DANGEROUS_CODE_PATTERNS = [
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bexecSync\s*\(/,
  /\brm\s+-rf\b/,
  /\bchild_process\b/,
] as const

export const BLOCKED_SHELL_COMMANDS = [
  /\brm\s+-rf\s+\/\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bmkfs\b/,
  /\bdd\b/,
] as const

// ── 需求类型枚举（单一数据源）──
export const REQUIREMENT_TYPES = [
  'add_display', 'add_page', 'add_field', 'modify_api', 'add_feature', 'delete_page', 'delete_field',
] as const
export type RequirementType = typeof REQUIREMENT_TYPES[number]

// 需要 fields 的需求类型
export const FIELDS_REQUIRED_TYPES = ['add_field', 'delete_field'] as const

// 需求类型 → 风险分级
export const RISK_TYPE_MAP: Record<'low' | 'medium' | 'high', readonly string[]> = {
  low: ['add_field', 'modify_text', 'add_tag', 'add_style', 'add_display'],
  medium: ['add_page', 'modify_api', 'add_component', 'add_feature'],
  high: ['delete_page', 'delete_field', 'refactor', 'change_database'],
}

// 有效 scope 值
export const VALID_SCOPES = ['frontend', 'backend', 'fullstack'] as const
export type RequirementScope = typeof VALID_SCOPES[number]

// 所有 RequirementStatus 值（与 types.ts 保持同步）
export const REQUIREMENT_STATUSES = [
  'idle', 'clarifying', 'clarified', 'waiting-for-pm', 'needs-confirmation',
  'planning', 'plan-ready', 'plan-approved', 'plan-rejected',
  'coding', 'testing', 'diff-ready', 'done', 'failed', 'reverted',
] as const

// 默认项目 ID（可通过环境变量覆盖）
export const DEFAULT_PROJECT_ID = process.env.DEFAULT_PROJECT ?? 'conduit'
