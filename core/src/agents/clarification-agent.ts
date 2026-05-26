import type { AgentDefinition, AgentContext, StructuredRequirement } from '../types.js'
import type { LLMClient } from '../llm/llm-client.js'
import type { PromptManager } from '../llm/prompt-manager.js'

export interface ClarificationResult {
  requirement: StructuredRequirement
  needsMoreInfo: boolean
  questions: string[] | null
  round: number
}

/**
 * 澄清 Agent：识别模糊需求中的歧义，主动追问，输出结构化需求 JSON
 * 对标 PRD 中的状态机：idle → clarifying → clarified/failed
 */
export function createClarificationAgent(): AgentDefinition {
  return {
    name: 'clarification',
    description: '识别 PM 模糊需求中的歧义，主动追问，输出结构化需求 JSON',
    systemPrompt: '',  // 由 PromptManager 动态加载
    tools: [],
    maxRounds: 3,
  }
}

/**
 * 澄清 Agent 的实际执行逻辑
 * 不走 tool-use 循环，直接调 LLM 解析 JSON
 */
export async function runClarification(
  llmClient: LLMClient,
  promptManager: PromptManager,
  pmInput: string,
  projectContext: any,
  currentRequirement?: StructuredRequirement | null,
  round: number = 1,
): Promise<ClarificationResult> {
  // 加载 prompt 模板
  const systemPrompt = await promptManager.load('clarification')

  // 构建用户消息：当前结构化需求 + PM 新输入
  let userMessage = pmInput
  if (currentRequirement) {
    userMessage = `当前结构化需求：\n${JSON.stringify(currentRequirement, null, 2)}\n\nPM 新回复：${pmInput}`
  }

  // 如果有项目上下文，注入模型信息
  if (projectContext?.models) {
    userMessage += `\n\n项目模型定义：\n${JSON.stringify(projectContext.models, null, 2)}`
  }

  // 调用 LLM
  const response = await llmClient.simpleChat(systemPrompt, userMessage)

  // 解析 JSON 响应
  const result = parseClarificationResponse(response, round)

  return result
}

/**
 * 解析 LLM 返回的澄清结果
 */
function parseClarificationResponse(response: string, round: number): ClarificationResult {
  // 尝试直接解析
  let json: any = null
  try {
    json = JSON.parse(response)
  } catch {
    // 尝试从文本中提取 JSON
    const match = response.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        json = JSON.parse(match[0])
      } catch {}
    }
  }

  // 如果解析成功且包含必要字段
  if (json && json.type && json.entity) {
    return {
      requirement: json as StructuredRequirement,
      needsMoreInfo: false,
      questions: null,
      round,
    }
  }

  // 如果 LLM 返回的是追问问题（不是 JSON）
  return {
    requirement: currentOrDefault(response),
    needsMoreInfo: true,
    questions: extractQuestions(response),
    round,
  }
}

/**
 * 提取 LLM 返回的追问问题
 */
function extractQuestions(text: string): string[] {
  // 匹配带编号的问题：1. xxx 或 ① xxx
  const numbered = text.match(/\d+[\.\)]\s*(.+)/g)
  if (numbered) return numbered.map(q => q.replace(/^\d+[\.\)]\s*/, ''))

  // 匹配问号结尾的句子
  const questions = text.match(/[^。！\n]+[？?]/g)
  if (questions) return questions.map(q => q.trim())

  return [text.trim()]
}

/**
 * 默认/降级的结构化需求
 */
function currentOrDefault(text: string): StructuredRequirement {
  return {
    type: 'unknown',
    entity: 'unknown',
    scope: 'fullstack',
    description: text.slice(0, 200),
  }
}
