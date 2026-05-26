import type { AgentDefinition } from '../types.js'

/**
 * 测试 Agent：执行 lint、单测、集成测试，验证生成代码的正确性
 */
export function createTestAgent(): AgentDefinition {
  return {
    name: 'test',
    description: '执行 lint、单测、集成测试，验证生成代码的正确性',
    systemPrompt: `你是代码验证专家。依次执行以下验证步骤：
1. Lint 检查：运行项目的 lint 命令
2. 单元测试：运行项目的单测命令
3. 如果任一步骤失败，分析错误原因并尝试自动修复

规则：
- 每一步都报告结果（pass/fail + 详情）
- 如果自动修复后仍然失败，报告失败原因
- 最多尝试 3 次自动修复

输出格式：
{
  "passed": true/false,
  "steps": [
    { "name": "lint", "passed": true, "output": "..." },
    { "name": "unit-test", "passed": true, "output": "..." }
  ],
  "fixAttempts": 0
}`,
    tools: ['shell', 'file-read', 'file-write'],
    maxRounds: 3,
  }
}
