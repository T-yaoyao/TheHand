/**
 * 澄清阶段
 * 从 PM 原始输入中提取结构化需求，最多 3 轮追问
 */
import { runClarification } from '../../agents/clarification-agent.js';
import { validateRequirement, validationErrorsToQuestions } from '../../utils/requirement-validator.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('phase:clarify');
export class ClarifyPhase {
    name = 'clarify';
    async *run(ctx) {
        const { requirement, projectContext, requirementMemory, llmClient, promptManager } = ctx;
        yield { type: 'status-change', status: 'clarifying', agent: 'clarification' };
        const recentConvs = await requirementMemory.getRecentConversations(requirement.id, 50);
        const pmReplies = recentConvs.filter(c => c.role === 'pm');
        const currentRound = 1 + pmReplies.length;
        let pmInput = requirement.pmInput;
        if ((requirement.status === 'clarifying' || requirement.status === 'waiting-for-pm' || requirement.status === 'needs-confirmation') &&
            pmReplies.length > 0) {
            pmInput = pmReplies.map(c => c.content).join('\n');
        }
        const previousQuestions = recentConvs
            .filter(c => c.role === 'system')
            .map(c => c.content);
        const clarificationResult = await runClarification(llmClient, promptManager, pmInput, projectContext, requirement.structuredRequirement, currentRound, previousQuestions, pmReplies.map(c => c.content));
        // 需要更多信息 → 暂停等 PM 回复
        if (clarificationResult.needsMoreInfo) {
            const questions = clarificationResult.questions ?? [];
            for (const q of questions) {
                await requirementMemory.addConversation({
                    id: crypto.randomUUID(),
                    requirementId: requirement.id,
                    role: 'system',
                    content: q,
                    round: clarificationResult.round,
                    createdAt: new Date(),
                });
            }
            requirement.status = 'waiting-for-pm';
            requirement.structuredRequirement = clarificationResult.requirement;
            await requirementMemory.saveRequirement(requirement);
            yield {
                type: 'waiting-for-pm',
                requirement: { ...requirement, status: 'waiting-for-pm' },
                questions,
            };
            return;
        }
        requirement.structuredRequirement = clarificationResult.requirement;
        // 第 3 轮兜底生成的默认需求 → needs-confirmation
        if (requirement.structuredRequirement?.isDefaulted) {
            requirement.status = 'needs-confirmation';
            await requirementMemory.saveRequirement(requirement);
            await requirementMemory.addConversation({
                id: crypto.randomUUID(),
                requirementId: requirement.id,
                role: 'system',
                content: '⚠️ 信息不足，系统已用合理默认值填充结构化需求，请确认后继续。',
                round: currentRound,
                createdAt: new Date(),
            });
            yield {
                type: 'waiting-for-pm',
                requirement: { ...requirement, status: 'needs-confirmation' },
                questions: ['当前需求信息不完整，系统已自动填充默认值，请确认结构化需求是否正确，确认后继续生成方案。'],
            };
            return;
        }
        // 校验结构化需求的完整性
        const validEntities = projectContext?.models ? Object.keys(projectContext.models) : [];
        const validation = validateRequirement(requirement.structuredRequirement, validEntities);
        if (!validation.valid) {
            const questions = validationErrorsToQuestions(validation.errors);
            log.info(`需求校验未通过: ${questions.join('; ')}`);
            if (validation.autoFixable && currentRound < 3) {
                await requirementMemory.addConversation({
                    id: crypto.randomUUID(),
                    requirementId: requirement.id,
                    role: 'system',
                    content: questions.join('\n'),
                    round: currentRound + 1,
                    createdAt: new Date(),
                });
                requirement.status = 'clarifying';
                await requirementMemory.saveRequirement(requirement);
                yield {
                    type: 'waiting-for-pm',
                    requirement: { ...requirement, status: 'clarifying' },
                    questions,
                };
                return;
            }
            requirement.status = 'needs-confirmation';
            await requirementMemory.saveRequirement(requirement);
            await requirementMemory.addConversation({
                id: crypto.randomUUID(),
                requirementId: requirement.id,
                role: 'system',
                content: `⚠️ 需求校验未通过：\n${questions.join('\n')}\n请确认或补充后继续。`,
                round: currentRound,
                createdAt: new Date(),
            });
            yield {
                type: 'waiting-for-pm',
                requirement: { ...requirement, status: 'needs-confirmation' },
                questions: [...questions, '请确认或补充以上信息后继续。'],
            };
            return;
        }
        // 澄清完成
        requirement.status = 'clarified';
        await requirementMemory.saveRequirement(requirement);
        await requirementMemory.addConversation({
            id: crypto.randomUUID(),
            requirementId: requirement.id,
            role: 'system',
            content: '✅ 澄清完成，开始生成方案…',
            round: currentRound,
            createdAt: new Date(),
        });
        yield { type: 'status-change', status: 'clarified', agent: 'clarification' };
    }
}
//# sourceMappingURL=clarify-phase.js.map