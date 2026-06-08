import type { AgentDefinition } from '../types.js';
import type { ToolDefinition } from '../llm/llm-client.js';
/**
 * 测试 Agent Function Calling 输出工具定义
 */
export declare const TEST_OUTPUT_TOOL: ToolDefinition;
/**
 * 测试 Agent：执行 lint、单测、集成测试，验证生成代码的正确性
 */
export declare function createTestAgent(): AgentDefinition;
/**
 * 边界测试生成 Agent：分析变更代码，生成补充测试用例
 */
export declare function createBoundaryTestAgent(): AgentDefinition;
//# sourceMappingURL=test-agent.d.ts.map