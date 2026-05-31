import { runClarification } from '../agents/clarification-agent.js';
import { createPlanAgent } from '../agents/plan-agent.js';
import { runCoding } from '../agents/coding-agent.js';
import { TestRunner } from '../git-ops/test-runner.js';
import { RepoManager } from '../git-ops/repo-manager.js';
/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 支持多阶段暂停：plan-ready → 用户审批 → coding → diff-ready → 用户确认 → commit
 */
export class Orchestrator {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * 主循环：根据需求状态调度对应 Agent
     * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
     *
     * 状态流转：
     *   idle/clarifying → 澄清 → 方案 → plan-ready（暂停，等审批）
     *   plan-approved → 编码 → 测试 → diff-ready（暂停，等确认）
     *   diff-ready → commit → apply → done
     */
    async *run(requirement, projectId = 'conduit') {
        const { agentRunner, llmClient, promptManager, skillRegistry, sandboxManager, projectMemory, requirementMemory } = this.deps;
        // 1. 创建沙箱
        yield { type: 'executing', phase: 'sandbox-create', progress: 0 };
        const sandbox = await sandboxManager.create(requirement.id);
        yield { type: 'executing', phase: 'sandbox-ready', progress: 5 };
        // 初始化执行器（Docker 沙箱时命令在容器内执行）
        const executor = 'getExecutor' in sandboxManager
            ? sandboxManager.getExecutor(sandbox)
            : undefined;
        const testRunner = new TestRunner(sandbox.path, executor);
        const repoManager = new RepoManager(sandbox.path, executor);
        // 加载项目上下文
        const projectContext = await projectMemory.load(projectId);
        try {
            // ── 状态检测：根据当前阶段跳转到对应入口 ──
            if (requirement.status === 'diff-ready') {
                // 跳转到提交阶段（用户已确认 diff）
                yield* this.phaseCommit(requirement, requirementMemory, repoManager, sandboxManager, sandbox);
                return;
            }
            if (requirement.status === 'plan-approved' && requirement.plan) {
                // 跳转到编码阶段（用户已确认方案）
                yield* this.phaseCoding(requirement, projectId, requirementMemory, skillRegistry, llmClient, promptManager, projectContext, testRunner, repoManager, sandboxManager, sandbox, executor);
                return;
            }
            // ── 完整流水线：澄清 → 方案 → 编码 → 暂停等确认 ──
            // 2. 澄清阶段
            yield { type: 'status-change', status: 'clarifying', agent: 'clarification' };
            const recentConvs = await requirementMemory.getRecentConversations(requirement.id, 50);
            const pmReplies = recentConvs.filter(c => c.role === 'pm');
            const currentRound = 1 + pmReplies.length;
            let pmInput = requirement.pmInput;
            if (requirement.status === 'clarifying' && pmReplies.length > 0) {
                pmInput = pmReplies.map(c => c.content).join('\n');
            }
            const previousQuestions = recentConvs
                .filter(c => c.role === 'system')
                .map(c => c.content);
            const clarificationResult = await runClarification(llmClient, promptManager, pmInput, projectContext, requirement.structuredRequirement, currentRound, previousQuestions, pmReplies.map(c => c.content));
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
                yield {
                    type: 'waiting-for-pm',
                    requirement: { ...requirement, status: 'clarifying' },
                    questions,
                };
                requirement.status = 'clarifying';
                requirement.structuredRequirement = clarificationResult.requirement;
                await requirementMemory.saveRequirement(requirement);
                return;
            }
            requirement.structuredRequirement = clarificationResult.requirement;
            requirement.status = 'clarified';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'status-change', status: 'clarified', agent: 'clarification' };
            // 3. 方案阶段（自愈重试，最多 3 轮）
            yield { type: 'status-change', status: 'planning', agent: 'plan' };
            // 如果是删除操作，查询相关变更历史
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
                        deleteHistoryHint = `\n\n## 该需求涉及的历史变更文件（必须全部处理）\n以下是之前创建/修改时涉及的所有文件，删除操作必须覆盖这些文件：\n${Array.from(allFiles).map(f => `- ${f}`).join('\n')}`;
                    }
                }
            }
            const MAX_RETRIES = 3;
            let plan = [];
            const planErrors = [];
            for (let planAttempt = 1; planAttempt <= MAX_RETRIES; planAttempt++) {
                yield { type: 'executing', phase: `planning (attempt ${planAttempt}/${MAX_RETRIES})`, progress: 20 };
                let planInput = planErrors.length > 0
                    ? requirement.pmInput + '\n\n## 上轮方案生成失败\n' + planErrors[planErrors.length - 1] + '\n请修正后重新生成方案。'
                    : requirement.pmInput;
                if (deleteHistoryHint) {
                    planInput += deleteHistoryHint;
                }
                const planContext = {
                    requirement: { ...requirement, pmInput: planInput },
                    projectContext,
                    memory: await requirementMemory.getContext(requirement.id, projectContext),
                };
                const planResult = await agentRunner.run(createPlanAgent(), planContext);
                if (planResult.status === 'success' && planResult.output) {
                    const parsed = this.parsePlan(planResult.output);
                    if (parsed.length > 0) {
                        plan = parsed;
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
            // 方案就绪 → 暂停，等用户审批
            requirement.plan = plan;
            requirement.status = 'plan-approved';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'plan-ready', plan, requirement };
            return;
        }
        catch (e) {
            if (requirement.status !== 'done' && requirement.status !== 'failed') {
                yield { type: 'failed', requirement, error: e.message };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
            }
        }
        finally {
            try {
                await sandbox.cleanup();
            }
            catch { }
        }
    }
    /**
     * 编码+测试阶段（支持从 plan-approved 状态直接进入）
     */
    async *phaseCoding(requirement, projectId, requirementMemory, skillRegistry, llmClient, promptManager, projectContext, testRunner, repoManager, sandboxManager, sandbox, executor) {
        yield { type: 'status-change', status: 'coding', agent: 'coding' };
        const skill = requirement.structuredRequirement
            ? skillRegistry.match(requirement.structuredRequirement)
            : null;
        const MAX_RETRIES = 3;
        const codeErrors = [];
        const { writeFile, mkdir, rm } = await import('fs/promises');
        const { dirname, join } = await import('path');
        const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' };
        const pastLessons = await requirementMemory.getLessons(projectId, 'coding', 5);
        let codeOutputs = [];
        for (let codeAttempt = 1; codeAttempt <= MAX_RETRIES; codeAttempt++) {
            yield { type: 'executing', phase: `coding (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 30 };
            let codingHint = '';
            if (codeErrors.length > 0) {
                codingHint = '\n\n## 上轮编码/测试失败\n' + codeErrors[codeErrors.length - 1] + '\n请修正以上错误后重新生成代码。';
            }
            if (pastLessons.length > 0) {
                codingHint += '\n\n## 历史失败教训（请避免重复以下错误）\n' +
                    pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n');
            }
            codeOutputs = [];
            if (skill) {
                yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 35 };
                const skillOutputs = await skill.execute(requirement.structuredRequirement, projectContext);
                codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }));
            }
            else {
                const planFiles = requirement.plan ?? [];
                yield { type: 'executing', phase: `coding-agent (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 35 };
                codeOutputs = await runCoding(llmClient, promptManager, planFiles, sandbox.path, projectContext, codingHint || undefined);
            }
            // 写入文件到沙箱
            yield { type: 'executing', phase: 'writing-files', progress: 60 };
            const validOutputs = codeOutputs.filter(f => f.path && f.content);
            if (validOutputs.length === 0) {
                const err = '编码阶段未生成有效文件';
                codeErrors.push(`第${codeAttempt}轮: ${err}`);
                if (codeAttempt === MAX_RETRIES) {
                    const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                    yield { type: 'failed', requirement, error: detailedError, userMessage: '代码生成失败，AI 未能生成有效的代码文件。请检查需求描述是否清晰，或联系开发者排查。' };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    await requirementMemory.saveLesson({
                        id: crypto.randomUUID(),
                        projectId,
                        requirementId: requirement.id,
                        phase: 'coding',
                        filePath: null,
                        errorSummary: err,
                        errorDetail: detailedError,
                        fixHint: null,
                        resolved: false,
                        createdAt: new Date(),
                    });
                    return;
                }
                continue;
            }
            for (const file of validOutputs) {
                const fullPath = join(sandbox.path, file.path);
                if (file.content.trim().includes('__DELETE__')) {
                    try {
                        await rm(fullPath, { force: true });
                        yield { type: 'executing', phase: `deleted: ${file.path}`, progress: 60 };
                    }
                    catch {
                        yield { type: 'executing', phase: `delete skipped: ${file.path} (not found)`, progress: 60 };
                    }
                }
                else {
                    await mkdir(dirname(fullPath), { recursive: true });
                    await writeFile(fullPath, file.content, 'utf-8');
                    yield { type: 'executing', phase: `wrote: ${file.path}`, progress: 60 };
                }
            }
            // 测试阶段
            yield { type: 'status-change', status: 'testing', agent: 'test' };
            yield { type: 'executing', phase: `testing (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 70 };
            const testResult = await testRunner.run({
                lint: commands.lint,
                test: commands.test,
                build: commands.build,
            });
            yield {
                type: 'test-result',
                passed: testResult.passed,
                details: JSON.stringify(testResult, null, 2),
            };
            if (testResult.passed) {
                for (const lesson of pastLessons) {
                    await requirementMemory.markLessonResolved(lesson.id);
                }
                break;
            }
            const testErrors = testResult.steps
                .filter(s => !s.passed)
                .map(s => `${s.name}: ${s.output.slice(0, 500)}`)
                .join('\n---\n');
            codeErrors.push(`第${codeAttempt}轮测试失败:\n${testErrors}`);
            if (executor) {
                await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => { });
            }
            yield { type: 'executing', phase: `test failed (attempt ${codeAttempt}/${MAX_RETRIES}), retrying coding...`, progress: 65 };
            if (codeAttempt === MAX_RETRIES) {
                const detailedError = `编码+测试失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                yield { type: 'failed', requirement, error: detailedError, userMessage: `代码测试未通过（已重试 ${MAX_RETRIES} 次）。生成的代码存在 lint 或构建错误，请查看下方调试日志了解详情。` };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                await requirementMemory.saveLesson({
                    id: crypto.randomUUID(),
                    projectId,
                    requirementId: requirement.id,
                    phase: 'testing',
                    filePath: null,
                    errorSummary: `测试失败: ${testResult.steps.filter(s => !s.passed).map(s => s.name).join(', ')}`,
                    errorDetail: detailedError,
                    fixHint: null,
                    resolved: false,
                    createdAt: new Date(),
                });
                return;
            }
        }
        // 编码成功 → 保存变更历史
        const validOutputs = codeOutputs.filter(f => f.path && f.content);
        if (typeof requirementMemory.saveChanges === 'function') {
            await requirementMemory.saveChanges(requirement.id, validOutputs.map(f => ({
                path: f.path,
                action: f.content.trim().includes('__DELETE__') ? 'deleted' : 'created',
            })));
        }
        // Diff 检查
        yield { type: 'executing', phase: 'diff-check', progress: 80 };
        const changedFiles = await repoManager.getChangedFiles();
        const expectedFiles = validOutputs.map(f => f.path);
        const diffResult = await repoManager.diffCheck(expectedFiles);
        if (diffResult.hasUnexpectedChanges) {
            yield {
                type: 'executing',
                phase: `unexpected changes: ${diffResult.unexpectedFiles?.join(', ')}`,
                progress: 85,
            };
        }
        // 获取 diff 内容，暂停等用户确认
        let diffContent = '';
        if (executor) {
            try {
                const { stdout } = await executor('git diff', { timeout: 30_000 });
                diffContent = stdout;
            }
            catch { }
        }
        requirement.status = 'diff-ready';
        await requirementMemory.saveRequirement(requirement);
        yield {
            type: 'diff-ready',
            requirement,
            diff: diffContent,
            files: validOutputs.map(f => ({ path: f.path, summary: f.summary })),
        };
        return;
    }
    /**
     * 提交+应用阶段（支持从 diff-ready 状态直接进入）
     */
    async *phaseCommit(requirement, requirementMemory, repoManager, sandboxManager, sandbox) {
        yield { type: 'executing', phase: 'committing', progress: 90 };
        const rawCommitMsg = `feat: ${requirement.structuredRequirement?.description ?? requirement.pmInput} [req:${requirement.id.slice(0, 8)}]`;
        const commitMsg = rawCommitMsg.replace(/[`$"]/g, "'").slice(0, 200);
        try {
            await repoManager.commit(commitMsg);
            yield { type: 'executing', phase: 'committed to sandbox', progress: 95 };
        }
        catch (e) {
            yield { type: 'executing', phase: `commit failed: ${e.message}`, progress: 95 };
            requirement.status = 'failed';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `沙箱 commit 失败: ${e.message}`, userMessage: '代码提交失败，可能是沙箱环境的 Git 配置问题。请联系开发者排查。' };
            return;
        }
        // 应用到源仓库
        yield { type: 'executing', phase: 'applying-to-source', progress: 97 };
        const changedFiles = await repoManager.getChangedFiles();
        try {
            await sandboxManager.applyToSource(sandbox, changedFiles, commitMsg);
            yield { type: 'executing', phase: 'applied to source', progress: 98 };
        }
        catch (e) {
            yield { type: 'executing', phase: `apply failed: ${e.message}`, progress: 98 };
            requirement.status = 'failed';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `应用到源仓库失败: ${e.message}`, userMessage: '代码变更未能应用到源仓库。沙箱中的代码仍然保留，请联系开发者排查。' };
            return;
        }
        // 完成
        requirement.status = 'done';
        await requirementMemory.saveRequirement(requirement);
        yield { type: 'completed', requirement };
    }
    /**
     * 处理 PM 回复（追问后的继续流程）
     */
    async *continueWithPMReply(requirement, pmReply, projectId = 'conduit') {
        await this.deps.requirementMemory.addConversation({
            id: crypto.randomUUID(),
            requirementId: requirement.id,
            role: 'pm',
            content: pmReply,
            round: requirement.structuredRequirement?._round ?? 1,
            createdAt: new Date(),
        });
        requirement.pmInput = pmReply;
        yield* this.run(requirement, projectId);
    }
    parsePlan(output) {
        if (Array.isArray(output))
            return output;
        if (output.files && Array.isArray(output.files))
            return output.files;
        if (output.plan && Array.isArray(output.plan))
            return output.plan;
        return [];
    }
    isTerminal(status) {
        return status === 'done' || status === 'failed';
    }
    selectAgent(status) {
        const mapping = {
            clarifying: 'clarification',
            clarified: 'plan',
            'plan-approved': 'coding',
            coding: 'testing',
            testing: 'test',
        };
        return mapping[status] ?? 'unknown';
    }
}
//# sourceMappingURL=orchestrator.js.map