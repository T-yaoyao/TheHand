/**
 * Token 估算器
 * 基于字符数的快速 token 估算，不依赖外部 tokenizer 库
 */
/**
 * 估算文本的 token 数
 * 中文字符按 ~1.5 char/token，英文按 ~4 char/token
 */
export declare function estimateTokens(text: string): number;
/**
 * 估算 Message 数组的总 token 数
 */
export declare function estimateMessagesTokens(messages: {
    role: string;
    content: string | any[];
}[]): number;
//# sourceMappingURL=token-estimator.d.ts.map