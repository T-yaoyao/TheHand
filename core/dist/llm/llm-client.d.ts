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
    chat(messages: Message[], options?: {
        tools?: ToolDefinition[];
        agent?: string;
        maxTokens?: number;
    }): Promise<LLMResponse>;
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
    private safeParseJSON;
}
//# sourceMappingURL=llm-client.d.ts.map