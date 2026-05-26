/**
 * 方案 Agent：根据结构化需求，定位需要修改的文件，生成技术方案
 */
export function createPlanAgent() {
    return {
        name: 'plan',
        description: '根据结构化需求，定位需要修改的文件，生成技术方案',
        systemPrompt: (ctx) => `你是一个技术方案专家。根据结构化需求，确定需要修改哪些文件。

结构化需求：
${JSON.stringify(ctx.requirement.structuredRequirement, null, 2)}

项目上下文（模块结构、路由表、模型定义）：
${JSON.stringify(ctx.projectContext, null, 2)}

规则：
- 只能使用项目上下文中 keyFiles 列出的文件路径，不要编造不存在的路径
- 如果需要修改的文件不在 keyFiles 列表中，先用 file-read 工具确认文件存在

输出格式：
{
  "files": [
    {
      "path": "backend/models/Article.js",
      "changeDescription": "新增 readTime 字段，类型 INTEGER",
      "priority": 1
    }
  ],
  "summary": "共需修改 N 个文件"
}`,
        tools: ['file-read', 'shell'],
    };
}
//# sourceMappingURL=plan-agent.js.map