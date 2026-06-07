/**
 * 检测「整文件凭记忆重写」导致的常见退化：体量骤减、React hooks 消失、关键 import 消失。
 * 用于编码写入前阻断，触发带说明的重试；可用 THEHAND_DISABLE_REGRESSION_GUARD=1 关闭。
 */
/**
 * @param original 磁盘上修改前的文件全文（已存在文件）
 * @param generated 本轮 LLM 提交的完整正文
 */
export declare function detectCodingRegression(original: string, generated: string): {
    suspicious: boolean;
    reasons: string[];
};
export declare function formatRegressionRetryHint(pathsAndReasons: {
    path: string;
    reasons: string[];
}[]): string;
//# sourceMappingURL=coding-regression-guard.d.ts.map