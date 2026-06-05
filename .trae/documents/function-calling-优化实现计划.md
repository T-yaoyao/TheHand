# Function Calling 全链路优化实现计划

## Summary
将项目中所有"LLM 输出自由文本 → 多层正则 fallback 解析 JSON"的模式，统一改为"LLM 调用预定义函数 → 直接取 arguments"，大幅降低解析代码复杂度，提升输出稳定性。

## Current State Analysis
- Clarification Agent：使用 simpleChat() + 3 层正则兜底解析，代码 163 行
- Coding Agent：使用 simpleChat() + 手写括号深度计数状态机，代码最复杂
- Skill Registry：使用 simpleChat() + 4 层 fallback 解析
- Plan/Test Agent：已通过 AgentRunner 使用 chat() + tools，但最终输出仍从 response.content 正则解析
- LLMClient：已完整支持 function calling，返回结构化 toolCalls 字段

## Proposed Changes

### 改动 1：Clarification Agent (P0)
**文件**：`core/src/agents/clarification-agent.ts`
- 定义 CLARIFICATION_TOOLS 两个 tool schema：submit_requirement 和 ask_for_clarification
- runClarification() 改用 llmClient.chat() 替代 simpleChat()，传入 tools
- 解析逻辑优先从 response.toolCalls[0].arguments 直接取结果
- 保留旧的 parseClarificationResponse 作为 fallback，极端情况兜底

### 改动 2：Coding Agent (P0)
**文件**：`core/src/agents/coding-agent.ts`
- 定义 CODING_TOOLS 一个 tool schema：submit_files
- runCoding() 改用 llmClient.chat() 替代 simpleChat()，传入 tools
- 解析逻辑优先从 response.toolCalls[0].arguments.files 直接拿到 CodeFileOutput[]
- 保留 parseCodingBatchResponse 作为 fallback
- 标记 parseCodingFileResponse 为 deprecated

### 改动 3：Skill Registry (P1)
**文件**：`core/src/skill-registry/skill-registry.ts`
- 复用 CODING_TOOLS 中的 submit_files schema
- buildExecutor() 内部改用 llmClient.chat() 替代 simpleChat()
- 解析逻辑优先从 response.toolCalls[0].arguments.files 直接取结果
- 保留 parseSkillOutput 作为 fallback

### 改动 4：AgentRunner + Plan/Test Agent (P1)
**文件**：`core/src/types.ts`, `core/src/agents/agent-runner.ts`
- AgentDefinition 接口新增 outputTool?: ToolDefinition 字段
- AgentRunner.run() 循环中增加判断：如果 tc.name === agent.outputTool.function.name，直接返回 tc.arguments 作为 finalOutput
- Plan Agent 定义 PLAN_OUTPUT_TOOL schema，设置 outputTool
- Test Agent 定义 TEST_OUTPUT_TOOL schema，设置 outputTool
- AgentRunner.parseOutput() 降级为纯 fallback

### 改动 5：CLI 整合 (P2)
**文件**：`cli.mjs`
- 删除自定义 llmChat() 函数，改用 LLMClient
- 导入所有预定义 tool schemas，传入 chat() 调用
- 解析逻辑统一走 response.toolCalls
- 编码阶段从逐文件调用改为批量调用

## Assumptions & Decisions
- 所有改动都保留旧解析逻辑作为 fallback，100% 向后兼容
- 不删除任何现有代码，只新增优先路径
- 改动优先级按 P0 → P1 → P2 顺序执行
- 每步改动后都运行 npm run build 验证编译通过

## Verification Steps
1. npm run build:all — TypeScript 全量编译通过
2. 每个改动完成后验证 toolCalls 解析路径正常工作
3. 模拟 LLM 不调用 tool 的情况，确认旧 fallback 逻辑正常兜底
4. 对比改动前后日志，确认 tool_calls 解析成功率显著提升
