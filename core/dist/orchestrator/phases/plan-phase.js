/**
 * 方案阶段
 * 根据结构化需求生成技术方案（FilePlan[]），含风险评估和自然语言摘要
 */
import { createPlanAgent } from '../../agents/plan-agent.js';
import { RiskAssessor } from '../../utils/risk-assessor.js';
import { NaturalSummaryGenerator } from '../../utils/natural-summary-generator.js';
import { resolvePlanToExistingFiles, scanExistingComponents } from '../helpers.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('phase:plan');
export class PlanPhase {
    name = 'plan';
    async *run(ctx) {
        const { requirement, projectId, requirementMemory, agentRunner, promptManager, projectContext, sandbox } = ctx;
        yield { type: 'status-change', status: 'planning', agent: 'plan' };
        // 删除操作：查询变更历史
        let deleteHistoryHint = '';
        const reqType = requirement.structuredRequirement?.type;
        if (reqType === 'delete_page' || reqType === 'delete_field') {
            const keywords = requirement.pmInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
            if (keywords.length > 0 && typeof requirementMemory.findChangesByEntity === 'function') {
                const allFiles = new Set();
                for (const keyword of keywords.slice(0, 3)) {
                    const history = await requirementMemory.findChangesByEntity(keyword);
                    for (const h of history) {
                        for (const f of h.files)
                            allFiles.add(f.filePath);
                    }
                }
                if (allFiles.size > 0) {
                    deleteHistoryHint = Array.from(allFiles).map(f => `- ${f}`).join('\n');
                }
            }
        }
        // 扫描现有组件，防止创建重复组件
        // 从 projectContext.structure 读取组件/路由目录
        const componentDirs = projectContext?.structure
            ? [projectContext.structure.components, projectContext.structure.routes].filter(Boolean)
            : undefined;
        const existingComponentList = await scanExistingComponents(sandbox.path, componentDirs);
        // 方案生成（最多 3 轮重试）
        const MAX_RETRIES = 3;
        let plan = [];
        const planErrors = [];
        for (let planAttempt = 1; planAttempt <= MAX_RETRIES; planAttempt++) {
            yield { type: 'executing', phase: `planning (attempt ${planAttempt}/${MAX_RETRIES})`, progress: 20 };
            let planInput = requirement.pmInput;
            if (planErrors.length > 0) {
                planInput += '\n\n' + await promptManager.loadAndRender('shared/error-feedback', {
                    errorDetail: planErrors[planErrors.length - 1],
                });
            }
            if (deleteHistoryHint) {
                planInput += '\n\n' + await promptManager.loadAndRender('shared/delete-history', {
                    fileList: deleteHistoryHint,
                });
            }
            if (existingComponentList) {
                planInput += '\n\n' + await promptManager.loadAndRender('shared/existing-components', {
                    componentList: existingComponentList,
                });
            }
            const planContext = {
                requirement: { ...requirement, pmInput: planInput },
                projectContext,
                memory: await requirementMemory.getContext(requirement.id, projectContext),
                promptManager,
            };
            const planResult = await agentRunner.run(createPlanAgent(), planContext);
            if (planResult.status === 'success' && planResult.output) {
                const parsed = parsePlan(planResult.output);
                if (parsed.length > 0) {
                    plan = await resolvePlanToExistingFiles(parsed, sandbox.path);
                    break;
                }
            }
            const errorDetail = planResult.status === 'failed'
                ? `LLM 循环耗尽 (${planResult.inputTokens}/${planResult.outputTokens} tokens)`
                : `输出解析失败或为空 (type=${typeof planResult.output})`;
            planErrors.push(`第${planAttempt}轮: ${errorDetail}`);
            yield { type: 'executing', phase: `plan retry ${planAttempt}/${MAX_RETRIES}: ${errorDetail}`, progress: 20 };
            if (planAttempt === MAX_RETRIES) {
                const detailedError = `方案生成失败 (${MAX_RETRIES}轮):\n${planErrors.join('\n')}`;
                yield { type: 'failed', requirement, error: detailedError, userMessage: '方案生成失败，AI 无法为此需求生成有效方案。请尝试重新描述需求，或简化需求范围后重试。' };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                await requirementMemory.saveLesson({
                    id: crypto.randomUUID(),
                    projectId,
                    requirementId: requirement.id,
                    phase: 'planning',
                    filePath: null,
                    errorSummary: `方案生成失败: ${errorDetail}`,
                    errorDetail: detailedError,
                    fixHint: null,
                    resolved: false,
                    createdAt: new Date(),
                });
                return;
            }
        }
        // 风险评估 + 大白话摘要（全容错）
        let assessment = null;
        let naturalSummary = null;
        try {
            yield { type: 'executing', phase: 'risk-assessment', progress: 25 };
            const riskAssessor = new RiskAssessor();
            assessment = requirement.structuredRequirement
                ? riskAssessor.assess(requirement.structuredRequirement, plan, projectContext)
                : null;
            if (requirement.structuredRequirement) {
                const summaryGenerator = new NaturalSummaryGenerator();
                naturalSummary = summaryGenerator.generate(requirement.structuredRequirement, plan);
            }
            if (assessment) {
                requirement.confidenceScore = assessment.score;
                requirement.riskLevel = assessment.riskLevel;
                requirement.autoApprove = riskAssessor.canAutoApprove(assessment);
                yield { type: 'risk-assessed', requirement, assessment };
            }
            if (naturalSummary) {
                requirement.naturalLanguageSummary = JSON.stringify(naturalSummary);
            }
        }
        catch (enhanceErr) {
            log.warn('风险评估/摘要生成跳过', enhanceErr);
        }
        // 方案就绪 → 暂停等用户审批
        requirement.plan = plan;
        requirement.status = 'plan-ready';
        await requirementMemory.saveRequirement(requirement);
        yield { type: 'plan-ready', plan, requirement, riskAssessment: assessment ?? undefined, naturalSummary: naturalSummary ?? undefined };
    }
}
function parsePlan(output) {
    if (Array.isArray(output))
        return output;
    if (output.files && Array.isArray(output.files))
        return output.files;
    if (output.plan && Array.isArray(output.plan))
        return output.plan;
    return [];
}
//# sourceMappingURL=plan-phase.js.map