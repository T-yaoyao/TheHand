import type { AgentDefinition } from '../types.js';
import type { ToolDefinition } from '../llm/llm-client.js';
/**
 * 方案 Agent Function Calling 输出工具定义
 */
export declare const PLAN_OUTPUT_TOOL: ToolDefinition;
/**
 * 方案 Agent：根据结构化需求，定位需要修改的文件，生成技术方案
 */
export declare function createPlanAgent(): AgentDefinition;
//# sourceMappingURL=plan-agent.d.ts.map