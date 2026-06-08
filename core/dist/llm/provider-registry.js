/**
 * LLM Provider 注册表
 * 管理多个 LLM provider，支持按名称查找和 fallback
 */
import { DoubaoProvider } from './providers/doubao-provider.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('llm:registry');
export class ProviderRegistry {
    providers = new Map();
    defaultProviderName;
    constructor(defaultProviderName = 'doubao') {
        this.defaultProviderName = defaultProviderName;
    }
    /** 注册一个 provider */
    register(provider) {
        this.providers.set(provider.name, provider);
        log.info(`注册 LLM Provider: ${provider.name} (model: ${provider.defaultModel})`);
    }
    /** 获取指定名称的 provider */
    get(name) {
        return this.providers.get(name);
    }
    /** 获取默认 provider */
    getDefault() {
        const provider = this.providers.get(this.defaultProviderName);
        if (!provider) {
            const available = Array.from(this.providers.keys()).join(', ');
            throw new Error(`默认 LLM Provider "${this.defaultProviderName}" 未注册。可用: ${available}`);
        }
        return provider;
    }
    /** 获取所有已注册的 provider 名称 */
    list() {
        return Array.from(this.providers.keys());
    }
    /**
     * 智能获取 provider
     * 优先使用指定名称，否则使用默认
     */
    resolve(name) {
        if (!name)
            return this.getDefault();
        const provider = this.providers.get(name);
        if (!provider) {
            log.warn(`Provider "${name}" 未注册，回退到默认 provider "${this.defaultProviderName}"`);
            return this.getDefault();
        }
        return provider;
    }
}
/**
 * 创建默认的 provider registry
 * 自动注册 Doubao provider（从环境变量读取配置）
 */
export function createDefaultRegistry() {
    const registry = new ProviderRegistry('doubao');
    registry.register(new DoubaoProvider());
    return registry;
}
//# sourceMappingURL=provider-registry.js.map