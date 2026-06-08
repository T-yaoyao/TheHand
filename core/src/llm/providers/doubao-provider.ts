/**
 * 豆包 (Doubao / Volcano Engine) Provider
 * OpenAI 兼容格式的 LLM 调用实现
 */

import type { LLMProvider, Message, ChatOptions, LLMResponse, ToolCall } from '../provider.js'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, LLM_REQUEST_TIMEOUT_MS } from '../../config.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('llm:doubao')

export interface DoubaoConfig {
  endpoint: string
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
}

export class DoubaoProvider implements LLMProvider {
  readonly name = 'doubao'
  readonly defaultModel: string

  private endpoint: string
  private apiKey: string
  private maxTokens: number
  private temperature: number

  constructor(config?: Partial<DoubaoConfig>) {
    this.endpoint = config?.endpoint ?? process.env.DOUBAO_ENDPOINT ?? ''
    this.apiKey = config?.apiKey ?? process.env.DOUBAO_API_KEY ?? ''
    this.defaultModel = config?.model ?? process.env.DOUBAO_MODEL ?? ''
    this.maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS
    this.temperature = config?.temperature ?? DEFAULT_TEMPERATURE
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse> {
    const body: any = {
      model: this.defaultModel,
      messages,
      temperature: options?.temperature ?? this.temperature,
      max_tokens: options?.maxTokens ?? this.maxTokens,
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API 调用失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any

    if (data.error) {
      throw new Error(`LLM API 错误: ${JSON.stringify(data.error)}`)
    }

    const choice = data.choices?.[0]
    if (!choice) {
      throw new Error('LLM API 返回空结果')
    }

    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    }

    // 解析 tool_calls
    let toolCalls: ToolCall[] | null = null
    if (choice.message?.tool_calls) {
      toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJSON(tc.function.arguments),
      }))
    }

    // 防御：finish_reason=tool_calls 但 tool_calls 为空（doubao API 兼容性问题）
    if (choice.finish_reason === 'tool_calls' && !toolCalls) {
      log.warn('finish_reason=tool_calls 但 message.tool_calls 为空，尝试 choice 级别提取')
      if (choice.tool_calls) {
        toolCalls = choice.tool_calls.map((tc: any) => ({
          id: tc.id ?? '',
          name: tc.function?.name ?? tc.name ?? '',
          arguments: safeParseJSON(tc.function?.arguments ?? tc.arguments ?? '{}'),
        }))
      }
    }

    return {
      content: choice.message?.content ?? '',
      toolCalls,
      usage,
      finishReason: choice.finish_reason ?? 'stop',
    }
  }
}

function safeParseJSON(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}
