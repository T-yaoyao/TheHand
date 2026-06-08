/**
 * 豆包 (Doubao / Volcano Engine) Provider
 * OpenAI 兼容格式的 LLM 调用实现
 */
import type { LLMProvider, Message, ChatOptions, LLMResponse } from '../provider.js';
export interface DoubaoConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
}
export declare class DoubaoProvider implements LLMProvider {
    readonly name = "doubao";
    readonly defaultModel: string;
    private endpoint;
    private apiKey;
    private maxTokens;
    private temperature;
    constructor(config?: Partial<DoubaoConfig>);
    chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
}
//# sourceMappingURL=doubao-provider.d.ts.map