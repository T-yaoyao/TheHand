import type { AgentDefinition } from '../types.js'
import type { ToolDefinition } from '../llm/llm-client.js'

/**
 * 测试 Agent Function Calling 输出工具定义
 */
export const TEST_OUTPUT_TOOL: ToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'submit_test_result',
    description: '提交测试结果。',
    parameters: {
      type: 'object',
      properties: {
        passed: { type: 'boolean', description: '整体是否通过' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '步骤名称' },
              passed: { type: 'boolean', description: '是否通过' },
              output: { type: 'string', description: '输出详情' },
            },
            required: ['name', 'passed', 'output'],
          },
        },
        fixAttempts: { type: 'number', description: '自动修复尝试次数' },
      },
      required: ['passed', 'steps'],
    },
  },
}

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
- 最多尝试 3 次自动修复`,
    tools: ['shell', 'file-read', 'file-write'],
    maxRounds: 3,
    outputTool: TEST_OUTPUT_TOOL,
  }
}

/**
 * 边界测试生成 Agent：分析变更代码，生成补充测试用例
 */
export function createBoundaryTestAgent(): AgentDefinition {
  return {
    name: 'boundary-test',
    description: '分析变更代码，生成边界条件测试用例',
    systemPrompt: `你是测试专家。分析本次修改的代码，识别未覆盖的边界条件，生成补充测试用例。

## 工作流程

1. 用 file-read 读取本次修改的文件
2. 分析每个函数的输入类型、边界条件、错误路径
3. 检测项目已有的测试框架（查看已有 .test.js 文件的 import 模式）
4. 生成测试文件，用 file-write 写入磁盘
5. 用 shell 运行测试（npm test -- --runInBand 或项目配置的测试命令）
6. 如果测试失败，分析原因并修复测试代码（最多 2 次）

## 测试生成规则

- 使用项目的测试框架（vitest/jest/mocha）和已有的 mock 模式
- 对 Sequelize 模型方法使用 mock（vi.fn()），不依赖真实数据库
- 覆盖场景：null/undefined 输入、空数组、类型不匹配、权限不足、关联未加载
- 测试文件路径遵循项目约定（与被测文件同目录，.test.js 后缀）
- 不要修改已有的测试文件，只新增
- 如果项目已有该函数的测试，只补充缺失的边界用例

## 输出

通过 submit_test_result 提交结果。如果生成了测试文件并全部通过，passed 为 true。`,
    tools: ['shell', 'file-read', 'file-write'],
    maxRounds: 30,
    outputTool: TEST_OUTPUT_TOOL,
  }
}
