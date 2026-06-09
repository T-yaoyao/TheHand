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
    /** 单次调用级覆盖（默认使用 setObservabilityContext 注入的 requirementId） */
    requirementId?: string;
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
/** 单次 LLM 调用可观测记录（内存历史 + 可选落盘） */
export interface LlmUsageRecord {
    id: string;
    agent: string;
    model: string;
    requirementId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costCny: number;
    finishReason: string;
    timestamp: Date;
}
/** @deprecated 使用 LlmUsageRecord */
export type TokenRecord = LlmUsageRecord;
export interface LLMClientHooks {
    /** 每次成功完成 chat 后回调（用于 JSONL 落盘 / 外部监控） */
    onUsage?: (record: LlmUsageRecord) => void;
}
export type LLMClientOptions = Partial<LLMConfig> & {
    hooks?: LLMClientHooks;
};
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
    private hooks;
    private observabilityContext;
    constructor(config?: LLMClientOptions);
    /** 由编排入口在每轮需求处理开始时注入，关联 LLM 调用与 requirementId */
    setObservabilityContext(ctx: {
        requirementId?: string;
    }): void;
    clearObservabilityContext(): void;
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
     * 获取指定时间之后的 Token 统计（用于单次 run 的精确成本计算）
     * 解决单例 LLMClient 累积统计导致成本失真的问题
     */
    getStatsSince(since: Date): ReturnType<typeof this.getStats>;
    /**
     * 重置统计历史（谨慎使用，主要用于测试）
     */
    resetStats(): void;
    private aggregateStats;
    /**
     * 获取 Token 历史记录
     */
    getHistory(): LlmUsageRecord[];
}
//# sourceMappingURL=llm-client.d.ts.map