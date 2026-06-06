export interface LLMConfig {
  endpoint: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string | any[]
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

export interface LLMResponse {
  content: string
  toolCalls: ToolCall[] | null
  usage: {
    inputTokens: number
    outputTokens: number
  }
  finishReason: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: any
}

export interface TokenRecord {
  agent: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  timestamp: Date
}

/** 豆包标准推理定价（元/百万 tokens，输入 <=32k 分段） */
const PRICING_CNY_PER_MILLION = {
  input: 0.6,
  output: 3.6,
} as const

const TOKENS_PER_MILLION = 1_000_000

/**
 * LLM 调用客户端
 * 封装火山方舟 doubao API（OpenAI 兼容格式）
 */
export class LLMClient {
  private config: LLMConfig
  private tokenHistory: TokenRecord[] = []

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      endpoint: process.env.DOUBAO_ENDPOINT ?? '',
      apiKey: process.env.DOUBAO_API_KEY ?? '',
      model: process.env.DOUBAO_MODEL ?? '',
      maxTokens: 4096,
      temperature: 0.1,
      ...config,
    }
  }

  /**
   * 调用 LLM API（OpenAI 兼容格式）
   */
  async chat(
    messages: Message[],
    options?: { tools?: ToolDefinition[]; agent?: string; maxTokens?: number }
  ): Promise<LLMResponse> {
    const startTime = Date.now()

    const body: any = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
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

    const latencyMs = Date.now() - startTime
    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    }

    // Token 追踪（限制历史长度避免内存泄漏）
    this.tokenHistory.push({
      agent: options?.agent ?? 'unknown',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      timestamp: new Date(),
    })
    if (this.tokenHistory.length > 1000) {
      this.tokenHistory = this.tokenHistory.slice(-500)
    }

    // 解析 tool_calls（如果有）
    let toolCalls: ToolCall[] | null = null
    if (choice.message?.tool_calls) {
      toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParseJSON(tc.function.arguments),
      }))
    }

    return {
      content: choice.message?.content ?? '',
      toolCalls,
      usage,
      finishReason: choice.finish_reason ?? 'stop',
    }
  }

  /**
   * 简单对话（不需要工具调用）
   */
  async simpleChat(
    systemPrompt: string,
    userMessage: string,
    agent?: string,
  ): Promise<string> {
    const response = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { agent },
    )
    return response.content
  }

  /**
   * 获取 Token 使用统计
   */
  getStats() {
    const total = this.tokenHistory.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        totalLatency: acc.totalLatency + r.latencyMs,
        calls: acc.calls + 1,
      }),
      { inputTokens: 0, outputTokens: 0, totalLatency: 0, calls: 0 }
    )
    return {
      ...total,
      avgLatency: total.calls > 0 ? Math.round(total.totalLatency / total.calls) : 0,
      estimatedCost:
        (total.inputTokens / TOKENS_PER_MILLION) * PRICING_CNY_PER_MILLION.input +
        (total.outputTokens / TOKENS_PER_MILLION) * PRICING_CNY_PER_MILLION.output,
    }
  }

  /**
   * 获取 Token 历史记录
   */
  getHistory(): TokenRecord[] {
    return [...this.tokenHistory]
  }

  private safeParseJSON(str: string): any {
    try {
      return JSON.parse(str)
    } catch {
      return str
    }
  }
}
