/**
 * 测试 Agent Function Calling 输出工具定义
 */
export const TEST_OUTPUT_TOOL = {
    type: 'function',
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
};
/**
 * 测试 Agent：执行 lint、单测、集成测试，验证生成代码的正确性
 *
 * @deprecated 当前测试逻辑由 TestRunner 直接执行，此定义保留供未来 Agent-based 测试使用。
 * 如果未来需要让 LLM 分析测试结果并自动修复，可以通过 AgentRunner 调用此定义。
 */
export function createTestAgent() {
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
    };
}
/**
 * 边界测试生成 Agent：分析变更代码，生成补充测试用例
 *
 * 优化点（v2）：
 * - 注入沙箱环境先验知识，避免用 find/head 等命令试错
 * - maxRounds 设为 3，减少无效循环与 token 消耗
 * - 明确测试命令模板，避免路径试错
 * - 限制工具调用次数提示，鼓励高效执行
 */
export function createBoundaryTestAgent(sandboxInfo) {
    const testCmd = sandboxInfo?.testCommand ?? 'npm test -- --runInBand';
    const framework = sandboxInfo?.testFramework ?? 'vitest';
    const changedFilesList = sandboxInfo?.changedFiles?.join(', ') ?? '（见 PM 输入）';
    return {
        name: 'boundary-test',
        description: '分析变更代码，生成边界条件测试用例',
        systemPrompt: `你是测试专家。分析本次修改的代码，识别未覆盖的边界条件，生成补充测试用例。

## 沙箱环境（重要！）

- 项目结构：前端在 \`frontend/\` 子目录，后端在 \`backend/\` 子目录
- 测试框架：${framework}（已预装，无需安装）
- 测试命令：\`cd frontend && ${testCmd}\`（前端），\`cd backend && ${testCmd}\`（后端）
- 不要使用 \`head\`、\`which\`、\`locate\` 等命令（沙箱可能不存在）
- 查找文件请用 file-read 直接读取已知路径，不要用 shell find 搜索
- 修改的文件：${changedFilesList}

## 工作流程（请严格按顺序，控制在 3 轮内完成）

1. 用 file-read 逐个读取本次修改的文件（不要搜索文件，路径已在上方列出）
2. 分析每个函数的输入类型、边界条件、错误路径
3. 用 file-read 读取 1 个已有 .test.js 文件了解测试框架的 import 模式（如已知路径）
4. 生成测试文件，用 file-write 写入磁盘（与被测文件同目录，.test.js/.test.jsx 后缀）
5. 用 shell 运行测试：\`cd frontend && ${testCmd}\`
6. 如果测试失败，分析原因并修复测试代码（最多修复 2 次）
7. 通过 submit_test_result 提交结果

## 测试生成规则

- 使用项目的测试框架和已有的 mock 模式
- 对 Sequelize 模型方法使用 mock（vi.fn()），不依赖真实数据库
- 覆盖场景：null/undefined 输入、空数组、类型不匹配
- 不要修改已有的测试文件，只新增
- 每个被测文件最多生成 1 个测试文件

## 输出

通过 submit_test_result 提交结果。如果生成了测试文件并全部通过，passed 为 true。`,
        tools: ['shell', 'file-read', 'file-write'],
        maxRounds: 3,
        outputTool: TEST_OUTPUT_TOOL,
    };
}
//# sourceMappingURL=test-agent.js.map