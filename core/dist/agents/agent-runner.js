/**
 * Agent 执行器
 * 对标 Claude Code 的 runAgent()，包装 query() 循环
 */
export class AgentRunner {
    llmClient;
    toolPool;
    sandboxPath;
    constructor(llmClient, toolPool, sandboxPath = '') {
        this.llmClient = llmClient;
        this.toolPool = toolPool;
        this.sandboxPath = sandboxPath;
    }
    /**
     * 执行指定 Agent：循环调用 LLM → 提取 tool_use → 执行工具 → 循环
     *
     * 支持两种模式：
     * 1. 无工具 Agent（如 clarification）：直接调 LLM，返回 content
     * 2. 有工具 Agent（如 plan/coding/test）：tool-use 循环
     */
    async run(agent, context) {
        const startTime = Date.now();
        const tools = this.filterToolsForAgent(agent);
        const systemPrompt = this.resolveSystemPrompt(agent, context);
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: this.buildUserMessage(context) },
        ];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let rounds = 0;
        const maxRounds = agent.maxRounds ?? 10;
        let finalOutput = null;
        // 构建 tool definitions（如果有工具）
        const toolDefs = [];
        if (tools.length > 0) {
            toolDefs.push(...tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: this.zodToJsonSchema(t.inputSchema),
                },
            })));
        }
        // 合并 outputTool 到 tools 列表
        if (agent.outputTool) {
            toolDefs.push(agent.outputTool);
        }
        const finalToolDefs = toolDefs.length > 0 ? toolDefs : undefined;
        while (rounds < maxRounds) {
            rounds++;
            const chatOptions = {
                tools: finalToolDefs,
                agent: agent.name,
            };
            // 与 coding 一致：强制以 outputTool 交卷，减少正文 JSON 解析失败。
            // - 仅注册 outputTool（无 file-read 等）时：每轮都强制（architect）。
            // - 另有执行类工具时：只在最后一轮强制，避免挡掉中间的 file-read/shell。
            if (agent.outputTool &&
                finalToolDefs &&
                finalToolDefs.length > 0 &&
                process.env.THEHAND_DISABLE_FORCE_TOOL_CHOICE !== '1') {
                const onlyOutputTool = finalToolDefs.length === 1 && finalToolDefs[0].function.name === agent.outputTool.function.name;
                if (onlyOutputTool || rounds === maxRounds) {
                    chatOptions.requireFunctionCallName = agent.outputTool.function.name;
                }
            }
            const response = await this.llmClient.chat(messages, chatOptions);
            totalInputTokens += response.usage.inputTokens;
            totalOutputTokens += response.usage.outputTokens;
            console.log(`[agent:${agent.name}] round=${rounds} hasToolCalls=${!!response.toolCalls} contentLen=${response.content?.length ?? 0}`);
            // 如果有 tool_calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                // 优先检查是否是 outputTool 调用，如果是直接返回结果
                if (agent.outputTool) {
                    const outputTc = response.toolCalls.find(tc => tc.name === agent.outputTool.function.name);
                    if (outputTc) {
                        console.log(`[agent:${agent.name}] 使用 outputTool function calling 直接返回结果`);
                        finalOutput = outputTc.arguments;
                        break;
                    }
                }
                // 将 assistant 消息加入历史
                messages.push({
                    role: 'assistant',
                    content: response.content || '',
                });
                // 执行每个 tool call，将结果加入消息
                for (const tc of response.toolCalls) {
                    const tool = tools.find(t => t.name === tc.name);
                    const argsPreview = typeof tc.arguments === 'string'
                        ? tc.arguments.slice(0, 200)
                        : JSON.stringify(tc.arguments ?? {}).slice(0, 200);
                    console.log(`[agent:${agent.name}] round=${rounds} tool=${tc.name} args=${argsPreview}`);
                    let toolResult;
                    if (tool) {
                        try {
                            const parsed = tool.inputSchema.safeParse(tc.arguments);
                            if (!parsed.success) {
                                toolResult = `参数校验失败: ${parsed.error?.message ?? '未知错误'}。请使用正确的参数格式重试。`;
                            }
                            else {
                                const result = await tool.call(parsed.data, {
                                    sandboxPath: this.sandboxPath,
                                    backupStore: {
                                        save: async () => { },
                                        restore: async () => null,
                                    },
                                });
                                toolResult = result.content;
                            }
                        }
                        catch (e) {
                            toolResult = `Tool error: ${e.message}`;
                        }
                    }
                    else {
                        toolResult = `Unknown tool: ${tc.name}`;
                    }
                    console.log(`[agent:${agent.name}] tool=${tc.name} resultLen=${toolResult.length}`);
                    messages.push({
                        role: 'user',
                        content: `Tool result for ${tc.name}:\n${toolResult}`,
                    });
                }
                continue;
            }
            // 没有 tool_calls，解析 content 中的 JSON 作为输出（纯 fallback 路径）
            console.log(`[agent:${agent.name}] function calling 未命中，使用 parseOutput fallback`);
            finalOutput = this.parseOutput(response.content);
            break;
        }
        if (finalOutput === null) {
            console.log(`[agent:${agent.name}] FAILED: 循环耗尽 (${rounds}/${maxRounds} 轮), tokens=${totalInputTokens}/${totalOutputTokens}`);
        }
        return {
            agentName: agent.name,
            status: finalOutput !== null ? 'success' : 'failed',
            output: finalOutput,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            latencyMs: Date.now() - startTime,
        };
    }
    /**
     * 过滤当前 Agent 可用的工具
     */
    filterToolsForAgent(agent) {
        return this.toolPool.filter(t => agent.tools.includes(t.name));
    }
    resolveSystemPrompt(agent, context) {
        return typeof agent.systemPrompt === 'function'
            ? agent.systemPrompt(context)
            : agent.systemPrompt;
    }
    /**
     * 构建用户消息：包含需求和项目上下文
     */
    buildUserMessage(context) {
        const parts = [];
        if (context.requirement.structuredRequirement) {
            parts.push(`结构化需求：\n${JSON.stringify(context.requirement.structuredRequirement, null, 2)}`);
        }
        if (context.requirement.plan) {
            parts.push(`技术方案：\n${JSON.stringify(context.requirement.plan, null, 2)}`);
        }
        if (context.requirement.pmInput) {
            parts.push(`PM 原始输入：${context.requirement.pmInput}`);
        }
        if (context.projectContext) {
            parts.push(`项目上下文：\n${JSON.stringify(context.projectContext, null, 2)}`);
        }
        return parts.join('\n\n');
    }
    /**
     * 解析 LLM 输出为 JSON 对象
     */
    parseOutput(content) {
        if (!content)
            return null;
        // 尝试直接解析
        try {
            return JSON.parse(content);
        }
        catch { }
        // 提取 JSON 块
        const match = content.match(/```(?:json)?\n([\s\S]*?)```/);
        if (match) {
            try {
                return JSON.parse(match[1]);
            }
            catch { }
        }
        // 提取花括号包裹的 JSON（非贪婪匹配）
        const braceMatch = content.match(/\{[\s\S]*?\}/);
        if (braceMatch) {
            try {
                return JSON.parse(braceMatch[0]);
            }
            catch { }
        }
        // 返回原始文本
        return content;
    }
    /**
     * 将 Zod schema 转换为 JSON Schema（简化版）
     */
    zodToJsonSchema(schema) {
        if (!schema?._def)
            return { type: 'object' };
        const def = schema._def;
        // 解包 Optional/Nullable 包装器
        if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') {
            return this.zodToJsonSchema(def.innerType);
        }
        if (def.typeName === 'ZodObject') {
            const properties = {};
            const required = [];
            const shape = def.shape();
            for (const [key, value] of Object.entries(shape)) {
                properties[key] = this.zodToJsonSchema(value);
                if (!value.isOptional()) {
                    required.push(key);
                }
            }
            return {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            };
        }
        if (def.typeName === 'ZodString')
            return { type: 'string' };
        if (def.typeName === 'ZodNumber')
            return { type: 'number' };
        if (def.typeName === 'ZodBoolean')
            return { type: 'boolean' };
        return { type: 'string' };
    }
}
//# sourceMappingURL=agent-runner.js.map