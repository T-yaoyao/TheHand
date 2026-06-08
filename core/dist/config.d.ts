/**
 * 全局配置常量
 * 所有魔法数字集中管理，支持环境变量覆盖
 * 所有枚举值单一数据源，其他模块从此 import
 */
export declare const MAX_RETRIES: number;
export declare const MAX_CLARIFICATION_ROUNDS: number;
export declare const MAX_AGENT_ROUNDS: number;
export declare const DEFAULT_TEMPERATURE: number;
export declare const DEFAULT_MAX_TOKENS: number;
export declare const CODING_MAX_TOKENS: number;
export declare const SHELL_TIMEOUT_MS: number;
export declare const BUILD_TIMEOUT_MS: number;
export declare const TEST_TIMEOUT_MS: number;
export declare const DEPS_INSTALL_TIMEOUT_MS: number;
export declare const GIT_TIMEOUT_MS: number;
export declare const LLM_REQUEST_TIMEOUT_MS: number;
export declare const SHELL_MAX_BUFFER_BYTES: number;
export declare const TEST_OUTPUT_MAX_CHARS = 2000;
export declare const ERROR_OUTPUT_MAX_CHARS = 1000;
export declare const MAX_CONVERSATIONS_IN_CONTEXT: number;
export declare const MAX_LESSONS_IN_CONTEXT: number;
export declare const MAX_SSE_EVENTS = 500;
export declare const SSE_TRIM_TO = 250;
export declare const MAX_FILES_PER_BATCH: number;
export declare const CHARS_PER_TOKEN_ZH = 1.5;
export declare const CHARS_PER_TOKEN_EN = 0.25;
export declare const TOKEN_ESTIMATE_SAFETY_MARGIN = 1.2;
export declare const PRICING_CNY_PER_MILLION: {
    readonly input: 0.6;
    readonly output: 3.6;
};
export declare const TOKENS_PER_MILLION = 1000000;
export declare const RISK_AUTO_APPROVE_THRESHOLD = 80;
export declare const RISK_LOW_THRESHOLD = 80;
export declare const RISK_MEDIUM_THRESHOLD = 50;
export declare const MIN_OUTPUT_CONTENT_RATIO = 0.3;
export declare const DANGEROUS_CODE_PATTERNS: readonly [RegExp, RegExp, RegExp, RegExp, RegExp];
export declare const BLOCKED_SHELL_COMMANDS: readonly [RegExp, RegExp, RegExp, RegExp, RegExp];
export declare const REQUIREMENT_TYPES: readonly ["add_display", "add_page", "add_field", "modify_api", "add_feature", "delete_page", "delete_field"];
export type RequirementType = typeof REQUIREMENT_TYPES[number];
export declare const FIELDS_REQUIRED_TYPES: readonly ["add_field", "delete_field"];
export declare const RISK_TYPE_MAP: Record<'low' | 'medium' | 'high', readonly string[]>;
export declare const VALID_SCOPES: readonly ["frontend", "backend", "fullstack"];
export type RequirementScope = typeof VALID_SCOPES[number];
export declare const REQUIREMENT_STATUSES: readonly ["idle", "clarifying", "clarified", "waiting-for-pm", "needs-confirmation", "planning", "plan-ready", "plan-approved", "plan-rejected", "coding", "testing", "diff-ready", "done", "failed", "reverted"];
export declare const DEFAULT_PROJECT_ID: string;
//# sourceMappingURL=config.d.ts.map