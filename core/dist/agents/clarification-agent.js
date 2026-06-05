/**
 * 澄清 Agent Function Calling 工具定义
 */
export const CLARIFICATION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'submit_requirement',
            description: '当需求信息足够完整时，提交结构化需求。调用后澄清阶段结束。',
            parameters: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        enum: ['add_display', 'add_page', 'add_field', 'modify_api', 'add_feature', 'delete_page', 'delete_field'],
                        description: '需求类型',
                    },
                    entity: {
                        type: 'string',
                        description: '目标实体',
                    },
                    fields: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: '字段名' },
                                type: { type: 'string', description: '字段类型' },
                                description: { type: 'string', description: '字段说明' },
                            },
                            required: ['name', 'type', 'description'],
                        },
                    },
                    scope: {
                        type: 'string',
                        enum: ['frontend', 'backend', 'fullstack'],
                        description: '影响范围',
                    },
                    description: {
                        type: 'string',
                        description: '需求详细描述',
                    },
                },
                required: ['type', 'entity', 'scope', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ask_for_clarification',
            description: '当需求信息不完整时，向 PM 追问。每轮最多 2-3 个问题。',
            parameters: {
                type: 'object',
                properties: {
                    questions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '追问问题列表',
                    },
                },
                required: ['questions'],
            },
        },
    },
];
/**
 * 澄清 Agent：识别模糊需求中的歧义，主动追问，输出结构化需求 JSON
 * 对标 PRD 中的状态机：idle → clarifying → clarified/failed
 */
export function createClarificationAgent() {
    return {
        name: 'clarification',
        description: '识别 PM 模糊需求中的歧义，主动追问，输出结构化需求 JSON',
        systemPrompt: '', // 由 PromptManager 动态加载
        tools: [],
        maxRounds: 3,
    };
}
/**
 * 澄清 Agent 的实际执行逻辑
 * Function Calling 优先路径，保留旧解析作为 fallback
 */
export async function runClarification(llmClient, promptManager, pmInput, projectContext, currentRequirement, round = 1, previousQuestions = [], pmReplies = []) {
    // 加载 prompt 模板
    const systemPrompt = await promptManager.load('clarification');
    // 构建用户消息：当前结构化需求 + PM 新输入
    let userMessage = pmInput;
    if (currentRequirement) {
        userMessage = `当前结构化需求：\n${JSON.stringify(currentRequirement, null, 2)}\n\nPM 新回复：${pmInput}`;
    }
    // 注入之前的澄清对话历史，让 LLM 知道之前问了什么、PM 怎么答的
    if (previousQuestions.length > 0) {
        const historyLines = ['\n\n## 之前的澄清对话'];
        const maxPairs = Math.min(previousQuestions.length, pmReplies.length);
        for (let i = 0; i < maxPairs; i++) {
            historyLines.push(`追问 ${i + 1}: ${previousQuestions[i]}`);
            historyLines.push(`PM 回复 ${i + 1}: ${pmReplies[i]}`);
        }
        for (let i = maxPairs; i < previousQuestions.length; i++) {
            historyLines.push(`追问 ${i + 1}: ${previousQuestions[i]}`);
            historyLines.push(`PM 回复 ${i + 1}: （未回复）`);
        }
        userMessage += historyLines.join('\n');
    }
    // 注入项目模型定义，让 LLM 知道有哪些实体和字段
    if (projectContext?.models) {
        userMessage += `\n\n项目模型定义：\n${JSON.stringify(projectContext.models, null, 2)}`;
    }
    // 第 3 轮 = 最后一轮：强制输出结构化需求，不再追问
    if (round >= 3) {
        userMessage += `\n\n## 注意：这是第 ${round} 轮澄清（最后一轮）。你必须调用 submit_requirement 提交结构化需求，不能再追问。如果信息不完整，用合理默认值填充。`;
    }
    // ── Function Calling 优先路径 ──
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = await llmClient.chat(messages, {
        tools: CLARIFICATION_TOOLS,
        agent: 'clarification',
    });
    // 优先从 toolCalls 直接取结果
    if (response.toolCalls && response.toolCalls.length > 0) {
        const tc = response.toolCalls[0];
        if (tc.name === 'submit_requirement' && tc.arguments) {
            console.log('[clarification] 使用 function calling: submit_requirement');
            const req = tc.arguments;
            return {
                requirement: req,
                needsMoreInfo: false,
                questions: null,
                round,
            };
        }
        if (tc.name === 'ask_for_clarification' && tc.arguments?.questions) {
            console.log('[clarification] 使用 function calling: ask_for_clarification');
            return {
                requirement: currentRequirement ?? currentOrDefault(''),
                needsMoreInfo: true,
                questions: tc.arguments.questions,
                round,
            };
        }
    }
    // ── Fallback：旧的解析逻辑兜底（LLM 偶尔不调 tool 的极端情况） ──
    console.log('[clarification] function calling 未命中，使用 fallback 解析');
    return parseClarificationResponse(response.content, round, currentRequirement);
}
/**
 * 解析 LLM 返回的澄清结果（fallback 路径）
 */
function parseClarificationResponse(response, round, currentRequirement) {
    // 尝试直接解析
    let json = null;
    try {
        json = JSON.parse(response);
    }
    catch {
        // 尝试从文本中提取 JSON
        const match = response.match(/\{[\s\S]*?\}/);
        if (match) {
            try {
                json = JSON.parse(match[0]);
            }
            catch { }
        }
    }
    // 如果解析成功且包含必要字段
    if (json && json.type && json.entity && json.scope && json.description) {
        return {
            requirement: json,
            needsMoreInfo: false,
            questions: null,
            round,
        };
    }
    // 第 3 轮兜底：强制输出结构化需求，不再追问
    if (round >= 3) {
        return {
            requirement: {
                ...currentOrDefault(response),
                isDefaulted: true,
            },
            needsMoreInfo: false,
            questions: null,
            round,
        };
    }
    // 如果 LLM 返回的是追问问题（不是 JSON）
    return {
        requirement: currentRequirement ?? currentOrDefault(response),
        needsMoreInfo: true,
        questions: extractQuestions(response),
        round,
    };
}
/**
 * 提取 LLM 返回的追问问题
 */
function extractQuestions(text) {
    // 匹配带编号的问题：1. xxx 或 ① xxx
    const numbered = text.match(/\d+[\.\)]\s*(.+)/g);
    if (numbered)
        return numbered.map(q => q.replace(/^\d+[\.\)]\s*/, ''));
    // 匹配问号结尾的句子
    const questions = text.match(/[^。！\n]+[？?]/g);
    if (questions)
        return questions.map(q => q.trim());
    return [text.trim()];
}
/**
 * 默认/降级的结构化需求
 */
function currentOrDefault(text) {
    let type = 'unknown';
    if (/删除|remove|delete/i.test(text))
        type = 'delete_field';
    else if (/加|新增|添加|add/i.test(text))
        type = 'add_field';
    else if (/改|修改|update|modify/i.test(text))
        type = 'modify_api';
    return {
        type,
        entity: 'unknown',
        scope: 'fullstack',
        description: text.slice(0, 200),
        isDefaulted: true,
    };
}
//# sourceMappingURL=clarification-agent.js.map