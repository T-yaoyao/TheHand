import type { AgentDefinition } from '../types.js';
import type { ToolDefinition } from '../llm/llm-client.js';
/**
 * 测试 Agent Function Calling 输出工具定义
 */
export declare const TEST_OUTPUT_TOOL: ToolDefinition;
/**
 * 测试 Agent：执行 lint、单测、集成测试，验证生成代码的正确性
 *
 * @deprecated 当前测试逻辑由 TestRunner 直接执行，此定义保留供未来 Agent-based 测试使用。
 * 如果未来需要让 LLM 分析测试结果并自动修复，可以通过 AgentRunner 调用此定义。
 */
export declare function createTestAgent(): AgentDefinition;
/**
 * 边界测试生成 Agent：分析变更代码，生成补充测试用例
 *
 * 优化点（v2）：
 * - 注入沙箱环境先验知识，避免用 find/head 等命令试错
 * - maxRounds 从 30 降到 15，减少无效循环
 * - 明确测试命令模板，避免路径试错
 * - 限制工具调用次数提示，鼓励高效执行
 */
export declare function createBoundaryTestAgent(sandboxInfo?: {
    testCommand?: string;
    testFramework?: string;
    changedFiles?: string[];
}): AgentDefinition;
//# sourceMappingURL=test-agent.d.ts.map