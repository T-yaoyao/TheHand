export interface LLMConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
}
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string | any[];
}
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}
export interface LLMChatOptions {
    tools?: ToolDefinition[];
    agent?: string;
    maxTokens?: number;
    /**
     * 强制模型以 function 形式调用指定工具（OpenAI 兼容 `tool_choice`）。
     * 编码阶段传入 `submit_files` 可显著降低「finish_reason=tool_calls 但未带回参」的概率。
     */
    requireFunctionCallName?: string;
}
export interface LLMResponse {
    content: string;
    toolCalls: ToolCall[] | null;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
    finishReason: string;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: any;
}
export interface TokenRecord {
    agent: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    timestamp: Date;
}
/**
 * 将 assistant message 里 tool 的 arguments 规范为对象。
 * 兼容：API 已解析为 object / 仍为 JSON 字符串 / 带 ```json 围栏 / 豆包偶发空串。
 */
export declare function normalizeAssistantToolArguments(raw: unknown): Record<string, unknown>;
/**
 * LLM 调用客户端
 * 封装火山方舟 doubao API（OpenAI 兼容格式）
 */
export declare class LLMClient {
    private config;
    private tokenHistory;
    constructor(config?: Partial<LLMConfig>);
    /**
     * 调用 LLM API（OpenAI 兼容格式）
     */
    chat(messages: Message[], options?: LLMChatOptions): Promise<LLMResponse>;
    /**
     * 从 OpenAI / 方舟等兼容响应中提取 tool_calls，尽量覆盖字段差异。
     */
    private extractToolCallsFromChoice;
    private mapOneToolCall;
    /**
     * 简单对话（不需要工具调用）
     */
    simpleChat(systemPrompt: string, userMessage: string, agent?: string): Promise<string>;
    /**
     * 获取 Token 使用统计
     */
    getStats(): {
        avgLatency: number;
        estimatedCost: number;
        inputTokens: number;
        outputTokens: number;
        totalLatency: number;
        calls: number;
    };
    /**
     * 获取 Token 历史记录
     */
    getHistory(): TokenRecord[];
}
//# sourceMappingURL=llm-client.d.ts.map