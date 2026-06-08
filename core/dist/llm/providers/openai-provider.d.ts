/**
 * OpenAI Provider
 * 标准 OpenAI API 格式的 LLM 调用实现
 */
import type { LLMProvider, Message, ChatOptions, LLMResponse } from '../provider.js';
export interface OpenAIConfig {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}
export declare class OpenAIProvider implements LLMProvider {
    readonly name = "openai";
    readonly defaultModel: string;
    private apiKey;
    private baseUrl;
    private maxTokens;
    private temperature;
    constructor(config: OpenAIConfig);
    chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
}
//# sourceMappingURL=openai-provider.d.ts.map