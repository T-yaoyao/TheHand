/**
 * LLM Provider 抽象层
 * 定义统一的 LLM 调用接口，支持多 provider 切换
 */
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
export interface ToolCall {
    id: string;
    name: string;
    arguments: any;
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
export interface ChatOptions {
    tools?: ToolDefinition[];
    agent?: string;
    maxTokens?: number;
    temperature?: number;
}
/**
 * LLM Provider 接口
 * 所有 LLM 后端必须实现此接口
 */
export interface LLMProvider {
    /** Provider 名称（如 'doubao', 'openai', 'anthropic'） */
    readonly name: string;
    /** 默认模型 ID */
    readonly defaultModel: string;
    /**
     * 调用 LLM
     */
    chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
}
//# sourceMappingURL=provider.d.ts.map