/**
 * LLM Provider 注册表
 * 管理多个 LLM provider，支持按名称查找和 fallback
 */
import type { LLMProvider } from './provider.js';
export declare class ProviderRegistry {
    private providers;
    private defaultProviderName;
    constructor(defaultProviderName?: string);
    /** 注册一个 provider */
    register(provider: LLMProvider): void;
    /** 获取指定名称的 provider */
    get(name: string): LLMProvider | undefined;
    /** 获取默认 provider */
    getDefault(): LLMProvider;
    /** 获取所有已注册的 provider 名称 */
    list(): string[];
    /**
     * 智能获取 provider
     * 优先使用指定名称，否则使用默认
     */
    resolve(name?: string): LLMProvider;
}
/**
 * 创建默认的 provider registry
 * 自动注册 Doubao provider（从环境变量读取配置）
 */
export declare function createDefaultRegistry(): ProviderRegistry;
//# sourceMappingURL=provider-registry.d.ts.map