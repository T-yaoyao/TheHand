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

export interface LLMChatOptions {
  tools?: ToolDefinition[]
  agent?: string
  maxTokens?: number
  /**
   * 强制模型以 function 形式调用指定工具（OpenAI 兼容 `tool_choice`）。
   * 编码阶段传入 `submit_files` 可显著降低「finish_reason=tool_calls 但未带回参」的概率。
   */
  requireFunctionCallName?: string
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
 * 将 assistant message 里 tool 的 arguments 规范为对象。
 * 兼容：API 已解析为 object / 仍为 JSON 字符串 / 带 ```json 围栏 / 豆包偶发空串。
 */
export function normalizeAssistantToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string') return {}
  let s = raw.trim()
  if (!s) return {}
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/m)
  if (fence) s = fence[1].trim()
  try {
    const v = JSON.parse(s)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const v = JSON.parse(s.slice(start, end + 1))
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    return {}
  }
}

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
    options?: LLMChatOptions,
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
      if (options.requireFunctionCallName) {
        body.tool_choice = {
          type: 'function',
          function: { name: options.requireFunctionCallName },
        }
      }
    }

    let res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      let errText = await res.text()
      if (
        options?.requireFunctionCallName &&
        body.tool_choice &&
        (res.status === 400 || res.status === 422)
      ) {
        console.warn('[llm] tool_choice 被拒，重试省略 tool_choice:', errText.slice(0, 400))
        const { tool_choice: _omit, ...retryBody } = body
        res = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(retryBody),
        })
        if (!res.ok) {
          errText = await res.text()
          throw new Error(`LLM API 调用失败 (${res.status}): ${errText}`)
        }
      } else {
        throw new Error(`LLM API 调用失败 (${res.status}): ${errText}`)
      }
    }

    const data = await res.json() as any

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

    // Token 追踪（限制历史长度避免内存泄漏，上限 200 条足够单次 run 分析）
    this.tokenHistory.push({
      agent: options?.agent ?? 'unknown',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      timestamp: new Date(),
    })
    if (this.tokenHistory.length > 200) {
      this.tokenHistory = this.tokenHistory.slice(-100)
    }

    // 解析 tool_calls：合并多路径、规范化 arguments（object / JSON 字符串 / 围栏）
    const toolCalls = this.extractToolCallsFromChoice(data, choice)

    return {
      content: choice.message?.content ?? '',
      toolCalls,
      usage,
      finishReason: choice.finish_reason ?? 'stop',
    }
  }

  /**
   * 从 OpenAI / 方舟等兼容响应中提取 tool_calls，尽量覆盖字段差异。
   */
  private extractToolCallsFromChoice(data: any, choice: any): ToolCall[] | null {
    const rawList: any[] = []
    const pushArr = (arr: unknown) => {
      if (Array.isArray(arr)) rawList.push(...arr)
    }
    pushArr(choice.message?.tool_calls)
    pushArr(choice.tool_calls)
    pushArr(data.message?.tool_calls)

    if (rawList.length === 0) {
      if (choice.finish_reason === 'tool_calls') {
        console.warn('[llm] finish_reason=tool_calls 但各路径 tool_calls 均为空，choice 截断:', JSON.stringify(choice).slice(0, 600))
      }
      return null
    }

    const out: ToolCall[] = []
    const seen = new Set<string>()
    for (const tc of rawList) {
      const mapped = this.mapOneToolCall(tc)
      if (!mapped) continue
      const dedupeKey = mapped.id || `${mapped.name}:${JSON.stringify(mapped.arguments).slice(0, 120)}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      out.push(mapped)
    }
    return out.length > 0 ? out : null
  }

  private mapOneToolCall(tc: any): ToolCall | null {
    if (!tc || typeof tc !== 'object') return null
    const fn = tc.function ?? tc
    const name = String(fn?.name ?? tc.name ?? '').trim()
    if (!name) return null
    const rawArgs = fn?.arguments ?? tc.arguments
    const argumentsObj = normalizeAssistantToolArguments(rawArgs)
    return {
      id: String(tc.id ?? ''),
      name,
      arguments: argumentsObj,
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
    return this.aggregateStats(this.tokenHistory)
  }

  /**
   * 获取指定时间之后的 Token 统计（用于单次 run 的精确成本计算）
   * 解决单例 LLMClient 累积统计导致成本失真的问题
   */
  getStatsSince(since: Date): ReturnType<typeof this.getStats> {
    const filtered = this.tokenHistory.filter(r => r.timestamp >= since)
    return this.aggregateStats(filtered)
  }

  /**
   * 重置统计历史（谨慎使用，主要用于测试）
   */
  resetStats(): void {
    this.tokenHistory = []
  }

  private aggregateStats(records: TokenRecord[]) {
    const total = records.reduce(
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
}

