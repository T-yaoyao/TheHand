/**
 * OpenAI Provider
 * 标准 OpenAI API 格式的 LLM 调用实现
 */

import type { LLMProvider, Message, ChatOptions, LLMResponse, ToolCall } from '../provider.js'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, LLM_REQUEST_TIMEOUT_MS } from '../../config.js'

export interface OpenAIConfig {
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai'
  readonly defaultModel: string

  private apiKey: string
  private baseUrl: string
  private maxTokens: number
  private temperature: number

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey
    this.defaultModel = config.model ?? 'gpt-4o'
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE
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

    const url = `${this.baseUrl}/chat/completions`
    const response = await fetch(url, {
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
      throw new Error(`OpenAI API 调用失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any

    if (data.error) {
      throw new Error(`OpenAI API 错误: ${JSON.stringify(data.error)}`)
    }

    const choice = data.choices?.[0]
    if (!choice) {
      throw new Error('OpenAI API 返回空结果')
    }

    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    }

    let toolCalls: ToolCall[] | null = null
    if (choice.message?.tool_calls) {
      toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJSON(tc.function.arguments),
      }))
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
