import type { AgentDefinition, AgentContext } from '../types.js'
import type { ToolDefinition } from '../llm/llm-client.js'

/**
 * 方案 Agent Function Calling 输出工具定义
 */
export const PLAN_OUTPUT_TOOL: ToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'submit_plan',
    description: '提交技术方案。包含需要修改的文件列表。',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              changeDescription: { type: 'string', description: '改动说明' },
              priority: { type: 'number', description: '优先级' },
            },
            required: ['path', 'changeDescription', 'priority'],
          },
        },
        summary: { type: 'string', description: '方案摘要' },
      },
      required: ['files', 'summary'],
    },
  },
}

/**
 * 方案 Agent：根据结构化需求，定位需要修改的文件，生成技术方案
 */
export function createPlanAgent(): AgentDefinition {
  return {
    name: 'plan',
    description: '根据结构化需求，定位需要修改的文件，生成技术方案',
    maxRounds: 3,
    systemPrompt: (ctx: AgentContext) => `你是一个技术方案专家。根据结构化需求，确定需要修改哪些文件。

结构化需求：
${JSON.stringify(ctx.requirement.structuredRequirement, null, 2)}

项目上下文（模块结构、路由表、模型定义）：
${JSON.stringify(ctx.projectContext, null, 2)}

项目约束：
${ctx.projectContext.constraints ? Object.entries(ctx.projectContext.constraints).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '无'}

规则：
- **直接输出方案**：项目上下文已提供完整的文件结构和模型定义，大多数情况下直接输出方案即可，不需要读取文件
- 仅当目标文件不在项目上下文的 keyFiles 中时，才用 file-read 确认路径（最多读 1 个文件）
- 新增路由必须注册在 frontend/src/main.jsx 中（内联 <Route>），不要创建独立的路由文件
- 修改已有组件时只改需要改的部分，不要整体重写组件
- **删除操作（delete_page/delete_field）必须列出所有受影响文件**：不仅是直接操作的文件，还要包括 import 它的路由文件、引用它的导航组件、导出它的 index 文件等
- 删除页面时，至少需要列出：导航组件（删链接）、路由文件（删 import + route 定义）、页面组件文件（删除）
- 需要删除的文件，changeDescription 标注为"删除文件"`,
    tools: ['file-read'],
    outputTool: PLAN_OUTPUT_TOOL,
  }
}
