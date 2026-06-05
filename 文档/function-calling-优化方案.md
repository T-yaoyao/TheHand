# 全链路 Function Calling 优化方案

## 背景

项目中所有 LLM 调用点都期望 LLM 返回严格的 JSON 结构，但实际依赖正则 + 多层 fallback 解析自由文本。全链路审计发现 **8 个 LLM 调用点**，其中 3 个强候选 + 2 个中候选 + 2 个待整合。

核心问题：**LLM 返回格式不稳定 → 解析代码膨胀 → 兜底策略粗糙**。

## 优化策略

将所有"LLM 输出自由文本 → 正则解析 JSON"的模式，统一改为"LLM 调用预定义函数 → 直接取 arguments"。

---

## 改动 1：Clarification Agent（需求澄清）

**文件**：`core/src/agents/clarification-agent.ts` + `prompts/clarification/v1.md`

**现状**：`simpleChat()` → `parseClarificationResponse()` 正则解析（JSON.parse → brace regex → keyword regex 兜底）

**改动**：

1. 定义两个 tool schema：

```typescript
const CLARIFICATION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'submit_requirement',
      description: '当需求信息足够完整时，提交结构化需求。调用后澄清阶段结束。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['add_display','add_page','add_field','modify_api','add_feature','delete_page','delete_field'] },
          entity: { type: 'string', description: '目标实体' },
          fields: { type: 'array', items: { type: 'object', properties: { name:{type:'string'}, type:{type:'string'}, description:{type:'string'} }, required:['name','type','description'] } },
          scope: { type: 'string', enum: ['frontend','backend','fullstack'] },
          description: { type: 'string' },
        },
        required: ['type', 'entity', 'scope', 'description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ask_for_clarification',
      description: '当需求信息不完整时，向 PM 追问。每轮最多 2-3 个问题。',
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array', items: { type: 'string' } },
        },
        required: ['questions'],
      },
    },
  },
]
```

2. `runClarification()` 改用 `llmClient.chat()` 替代 `simpleChat()`，传入 `CLARIFICATION_TOOLS`

3. 解析逻辑简化为：`response.toolCalls[0].name === 'submit_requirement'` → 取 arguments；`'ask_for_clarification'` → 取 arguments.questions

4. 保留旧的 `parseClarificationResponse` 作为 fallback（LLM 偶尔不调 tool 的极端情况）

5. prompt 精简：删除"输出格式"章节，只保留类型定义 + 核心规则

**收益**：消除 `currentOrDefault()` 的 3 类型正则兜底，类型枚举由 schema `enum` 硬约束

---

## 改动 2：Coding Agent（代码生成）

**文件**：`core/src/agents/coding-agent.ts`

**现状**：`simpleChat()` → `parseCodingBatchResponse()` — 全项目最复杂的解析器，包含：
- JSON.parse
- code-block regex 全局匹配
- **手写括号深度计数状态机**（~60 行，追踪 depth/inString/escape）
- 30% 完整性校验
- `extractFiles()` 多格式归一化

**改动**：

1. 定义 tool schema：

```typescript
const CODING_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'submit_files',
      description: '提交所有需要修改的文件。一次性输出全部文件，不要分批。',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '相对于项目根目录的文件路径' },
                content: { type: 'string', description: '文件完整源码，删除的文件填 __DELETE__' },
                summary: { type: 'string', description: '一句话描述本次改动' },
              },
              required: ['path', 'content', 'summary'],
            },
          },
        },
        required: ['files'],
      },
    },
  },
]
```

2. `runCoding()` 改用 `llmClient.chat()` 替代 `simpleChat()`，传入 `CODING_TOOLS`

3. 解析逻辑：`response.toolCalls[0].arguments.files` 直接拿到 `CodeFileOutput[]`

4. 保留 `parseCodingBatchResponse` 作为 fallback

5. `parseCodingFileResponse`（单文件解析）标记为 deprecated，后续删除

**收益**：删除 ~60 行括号深度状态机 + 30% 完整性校验等防御性代码

---

## 改动 3：Skill Registry（Skill 执行器）

**文件**：`core/src/skill-registry/skill-registry.ts`

**现状**：`simpleChat()` → `parseSkillOutput()` — 4 层 fallback（JSON.parse → code-block regex → bracket regex → code fallback → raw text）

**改动**：

1. 复用 CODING_TOOLS 中的 `submit_files` schema（Skill 输出格式和 Coding Agent 完全一致：`{path, content, summary}[]`）

2. `buildExecutor()` 内部改用 `llmClient.chat()` 替代 `simpleChat()`

3. 解析逻辑：`response.toolCalls[0].arguments.files` 直接拿到结果

4. 保留 `parseSkillOutput` 作为 fallback

**收益**：统一 Skill 和 Coding Agent 的输出解析逻辑，消除重复的 regex fallback

---

## 改动 4：Plan Agent（方案生成）和 Test Agent（测试验证）

**文件**：`core/src/agents/plan-agent.ts`、`core/src/agents/test-agent.ts`、`core/src/agents/agent-runner.ts`

**现状**：已通过 AgentRunner 使用 `chat()` + tools，但最终输出仍从 `response.content` 正则解析（`AgentRunner.parseOutput()`）

**改动**：

1. Plan Agent 定义输出 tool schema：

```typescript
const PLAN_OUTPUT_TOOL = {
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
              path: { type: 'string' },
              changeDescription: { type: 'string' },
              priority: { type: 'number' },
            },
            required: ['path', 'changeDescription', 'priority'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['files', 'summary'],
    },
  },
}
```

2. Test Agent 定义输出 tool schema：

```typescript
const TEST_OUTPUT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_test_result',
    description: '提交测试结果。',
    parameters: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              passed: { type: 'boolean' },
              output: { type: 'string' },
            },
            required: ['name', 'passed', 'output'],
          },
        },
        fixAttempts: { type: 'number' },
      },
      required: ['passed', 'steps'],
    },
  },
}
```

3. AgentRunner 改动：在 `run()` 方法中，将 agent 的输出 tool schema 合并到 tools 列表中。当 LLM 调用输出 tool 时，直接返回其 arguments 作为 `finalOutput`，不再走 `parseOutput()`

4. AgentDefinition 接口新增 `outputTool` 字段：

```typescript
interface AgentDefinition {
  // ...existing fields
  outputTool?: ToolDefinition  // 结构化输出 tool
}
```

5. AgentRunner.run() 循环中增加判断：如果 `tc.name === agent.outputTool.function.name`，直接返回 `tc.arguments` 作为 finalOutput

**收益**：Plan 和 Test 的最终输出不再走正则解析，AgentRunner 的 `parseOutput()` 降级为纯 fallback

---

## 改动 5：CLI 独立实现整合

**文件**：`cli.mjs`

**现状**：自己用 `fetch()` 重写了 LLM 调用（`llmChat()`），完全绕过 `LLMClient`。澄清/方案/编码三个阶段各有独立的正则解析逻辑。

**改动**：

1. 删除 `llmChat()` 函数，改用 `LLMClient`

2. 导入 `CLARIFICATION_TOOLS`、`CODING_TOOLS`、`PLAN_OUTPUT_TOOL`，传入 `chat()` 调用

3. 解析逻辑统一走 `response.toolCalls`

4. 编码阶段从逐文件调用改为批量调用（与 `runCoding()` 对齐）

**收益**：消除与 core 的代码重复，CLI 测试结果和实际管线行为一致

---

## 改动优先级

| 优先级 | 改动 | 理由 |
|--------|------|------|
| P0 | 改动 1：Clarification Agent | 最简单的改动，验证 function calling 模式可行 |
| P0 | 改动 2：Coding Agent | 消除最复杂的解析代码（括号深度状态机） |
| P1 | 改动 3：Skill Registry | 和 Coding Agent 共享 schema，改动量小 |
| P1 | 改动 4：Plan/Test Agent + AgentRunner | 改动涉及 AgentRunner 核心循环，需谨慎 |
| P2 | 改动 5：CLI 整合 | 低优先级，CLI 是测试工具，不影响生产链路 |

---

## 验证方式

1. `npm run build` — TypeScript 编译通过
2. 每个改动完成后用 CLI 测试完整链路：`node cli-orchestrator.mjs "给文章加个阅读时长"`
3. 重点验证 fallback：模拟 LLM 不调 tool 的情况，确认旧解析逻辑仍能兜底
4. 对比改动前后的日志：确认 tool_calls 解析成功率
