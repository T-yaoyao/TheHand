/**
 * Token 估算器
 * 基于字符数的快速 token 估算，不依赖外部 tokenizer 库
 */
import { CHARS_PER_TOKEN_ZH, CHARS_PER_TOKEN_EN, TOKEN_ESTIMATE_SAFETY_MARGIN } from '../config.js';
/**
 * 估算文本的 token 数
 * 中文字符按 ~1.5 char/token，英文按 ~4 char/token
 */
export function estimateTokens(text) {
    if (!text)
        return 0;
    let zhChars = 0;
    let enChars = 0;
    for (const char of text) {
        // CJK 统一汉字 + 扩展
        if (/[一-鿿㐀-䶿]/.test(char)) {
            zhChars++;
        }
        else {
            enChars++;
        }
    }
    const zhTokens = zhChars / CHARS_PER_TOKEN_ZH;
    const enTokens = enChars / CHARS_PER_TOKEN_EN;
    return Math.ceil((zhTokens + enTokens) * TOKEN_ESTIMATE_SAFETY_MARGIN);
}
/**
 * 估算 Message 数组的总 token 数
 */
export function estimateMessagesTokens(messages) {
    let total = 0;
    for (const msg of messages) {
        // role 开销
        total += 4;
        if (typeof msg.content === 'string') {
            total += estimateTokens(msg.content);
        }
        else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') {
                    total += estimateTokens(part);
                }
                else if (part?.text) {
                    total += estimateTokens(part.text);
                }
            }
        }
    }
    return total;
}
//# sourceMappingURL=token-estimator.js.map