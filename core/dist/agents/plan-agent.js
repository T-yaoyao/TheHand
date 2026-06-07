/**
 * 方案 Agent Function Calling 输出工具定义
 */
export const PLAN_OUTPUT_TOOL = {
    type: 'function',
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
                includeRouteEntryContext: {
                    type: 'boolean',
                    description: '是否需要在编码阶段自动并入应用路由入口（如 main.jsx）及 project.json 的 readContextCandidates。凡前端方案含 routes/ 下 jsx|tsx 且需求涉及 Tab/子路由/嵌套/Outlet/NavItem/NavLink/新 path 须为 true，以便首轮改路由；仅同一路由下纯 UI/数据展示、不动 path 与 Tab 为 false。',
                },
            },
            required: ['files', 'summary', 'includeRouteEntryContext'],
        },
    },
};
/**
 * 方案 Agent：根据结构化需求，定位需要修改的文件，生成技术方案
 */
export function createPlanAgent() {
    return {
        name: 'plan',
        description: '根据结构化需求，定位需要修改的文件，生成技术方案',
        maxRounds: 3,
        systemPrompt: (ctx) => `你是一个技术方案专家。根据结构化需求，确定需要修改哪些文件。

结构化需求：
${JSON.stringify(ctx.requirement.structuredRequirement, null, 2)}

项目上下文（模块结构、路由表、模型定义）：
${JSON.stringify(ctx.projectContext, null, 2)}

项目约束：
${ctx.projectContext.constraints ? Object.entries(ctx.projectContext.constraints).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '无'}

规则：
- **直接输出方案**：项目上下文已提供完整的文件结构和模型定义，大多数情况下直接输出方案即可，不需要读取文件
- 仅当目标文件不在项目上下文的 keyFiles 中时，才用 file-read 确认路径（最多读 1 个文件）
- **新增/变更路由、Tab、顶层页面挂载**：遵守 \`constraints\` 与 \`thehand\`；须在 \`files\` 中写全须改的真实路径（含父布局、Navbar 等）。**凡动 routes/ 下页面且涉及 Tab/子 path/Outlet/NavItem**，将 \`includeRouteEntryContext\` 设为 \`true\`（首轮即并入 main 与 readContextCandidates），或直接把须改的 \`main.jsx\` 等列入 \`files\`；仅同一路由下纯组件内部改动、不增 path/Tab 时为 \`false\`
- 修改已有组件时只改需要改的部分，不要整体重写组件
- **⚠️ 绝对不要创建已有组件的替代品**：若上下文中已存在名称相近的组件，须直接修改已有文件，勿新建仅名称略不同的重复组件，否则易成为死代码
- **新增组件/模块时，必须同时列出引用它的父级挂载点**（路由页、列表容器、布局等）：新增文件须被方案中至少一个已有文件通过 import 或项目约定的路由表挂接，否则用户看不到效果
- **删除操作（delete_page/delete_field）必须列出所有受影响文件**：不仅是直接操作的文件，还要包括 import 它的路由文件、引用它的导航组件、导出它的 index 文件等
- 删除页面时，至少需要列出：导航组件（删链接）、路由文件（删 import + route 定义）、页面组件文件（删除）
- 需要删除的文件，changeDescription 标注为"删除文件"`,
        tools: ['file-read'],
        outputTool: PLAN_OUTPUT_TOOL,
    };
}
//# sourceMappingURL=plan-agent.js.map