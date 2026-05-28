import { runClarification } from '../agents/clarification-agent.js';
import { createPlanAgent } from '../agents/plan-agent.js';
import { runCoding } from '../agents/coding-agent.js';
import { TestRunner } from '../git-ops/test-runner.js';
import { RepoManager } from '../git-ops/repo-manager.js';
/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 对标 Claude Code 的 query() AsyncGenerator
 */
export class Orchestrator {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * 主循环：根据需求状态调度对应 Agent
     * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
     */
    async *run(requirement, projectId = 'conduit') {
        const { agentRunner, llmClient, promptManager, skillRegistry, sandboxManager, projectMemory, requirementMemory } = this.deps;
        // 1. 创建沙箱
        yield { type: 'executing', phase: 'sandbox-create', progress: 0 };
        const sandbox = await sandboxManager.create(requirement.id);
        yield { type: 'executing', phase: 'sandbox-ready', progress: 5 };
        // 初始化测试运行器和仓库管理器（Docker 沙箱时命令在容器内执行）
        const executor = 'getExecutor' in sandboxManager
            ? sandboxManager.getExecutor(sandbox)
            : undefined;
        const testRunner = new TestRunner(sandbox.path, executor);
        const repoManager = new RepoManager(sandbox.path, executor);
        // 2. 加载项目上下文
        const projectContext = await projectMemory.load(projectId);
        try {
            // 3. 澄清阶段
            yield { type: 'status-change', status: 'clarifying', agent: 'clarification' };
            const clarificationResult = await runClarification(llmClient, promptManager, requirement.pmInput, projectContext, requirement.structuredRequirement);
            if (clarificationResult.needsMoreInfo) {
                yield {
                    type: 'waiting-for-pm',
                    requirement: { ...requirement, status: 'clarifying' },
                    questions: clarificationResult.questions ?? [],
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
            // 4. 方案阶段
            yield { type: 'status-change', status: 'planning', agent: 'plan' };
            const planContext = {
                requirement,
                projectContext,
                memory: await requirementMemory.getContext(requirement.id, projectContext),
                sandboxPath: sandbox.path,
            };
            const planResult = await agentRunner.run(createPlanAgent(), planContext);
            if (planResult.status === 'failed' || !planResult.output) {
                yield { type: 'failed', requirement, error: '方案 Agent 执行失败' };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                return;
            }
            const plan = this.parsePlan(planResult.output);
            requirement.plan = plan;
            requirement.status = 'plan-approved';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'plan-ready', plan, requirement };
            // 5. 编码阶段
            yield { type: 'status-change', status: 'coding', agent: 'coding' };
            const skill = requirement.structuredRequirement
                ? skillRegistry.match(requirement.structuredRequirement)
                : null;
            let codeOutputs = [];
            if (skill) {
                yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 30 };
                const skillOutputs = await skill.execute(requirement.structuredRequirement, projectContext);
                codeOutputs = skillOutputs.map(o => ({
                    path: o.path,
                    content: o.content,
                    summary: o.summary,
                }));
            }
            else {
                const planFiles = requirement.plan ?? [];
                if (planFiles.length === 0) {
                    yield { type: 'failed', requirement, error: '方案为空，无法编码' };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    return;
                }
                yield { type: 'executing', phase: 'coding-agent', progress: 30 };
                codeOutputs = await runCoding(llmClient, promptManager, planFiles, sandbox.path);
            }
            // 写入文件到沙箱
            yield { type: 'executing', phase: 'writing-files', progress: 60 };
            const { writeFile, mkdir } = await import('fs/promises');
            const { dirname, join } = await import('path');
            const validOutputs = codeOutputs.filter(f => f.path && f.content);
            if (validOutputs.length === 0) {
                yield { type: 'failed', requirement, error: '编码阶段未生成有效文件' };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                return;
            }
            for (const file of validOutputs) {
                const fullPath = join(sandbox.path, file.path);
                await mkdir(dirname(fullPath), { recursive: true });
                await writeFile(fullPath, file.content, 'utf-8');
                yield { type: 'executing', phase: `wrote: ${file.path}`, progress: 60 };
            }
            // 6. 测试阶段 — 直接执行 lint/test，不依赖 LLM
            yield { type: 'status-change', status: 'testing', agent: 'test' };
            yield { type: 'executing', phase: 'running-tests', progress: 70 };
            const commands = projectContext.commands ?? { lint: 'npm run lint', test: 'npm test' };
            const testResult = await testRunner.run({
                lint: commands.lint,
                test: commands.test,
            });
            yield {
                type: 'test-result',
                passed: testResult.passed,
                details: JSON.stringify(testResult, null, 2),
            };
            // 测试失败 → 不提交、不应用，报告失败
            if (!testResult.passed) {
                yield {
                    type: 'failed',
                    requirement,
                    error: `测试未通过，代码未提交。详情: ${testResult.steps.map(s => `${s.name}: ${s.passed ? 'PASS' : 'FAIL'}`).join(', ')}`,
                };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                return;
            }
            // 7. Diff 检查
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
            // 8. 提交代码到沙箱 git
            yield { type: 'executing', phase: 'committing', progress: 90 };
            const commitMsg = `feat: ${requirement.structuredRequirement?.description ?? requirement.pmInput}`;
            try {
                await repoManager.commit(commitMsg);
                yield { type: 'executing', phase: 'committed to sandbox', progress: 95 };
            }
            catch (e) {
                yield { type: 'executing', phase: `commit failed: ${e.message}`, progress: 95 };
            }
            // 9. 将沙箱变更应用回源仓库（含 git commit）
            yield { type: 'executing', phase: 'applying-to-source', progress: 97 };
            const filesToApply = validOutputs.map(f => f.path);
            try {
                await sandboxManager.applyToSource(sandbox, filesToApply, commitMsg);
                yield { type: 'executing', phase: 'applied to source', progress: 98 };
            }
            catch (e) {
                yield { type: 'executing', phase: `apply failed: ${e.message}`, progress: 98 };
            }
            // 10. 完成
            requirement.status = 'done';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'completed', requirement, sandboxPath: sandbox.path };
        }
        catch (e) {
            yield { type: 'failed', requirement, error: e.message };
            requirement.status = 'failed';
            await requirementMemory.saveRequirement(requirement);
        }
        finally {
            // 11. 清理沙箱
            try {
                await sandbox.cleanup();
            }
            catch { }
        }
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
    /**
     * 将沙箱中的变更应用到源仓库（只有测试通过才调用）
     */
    async applyChanges(requirement, files) {
        const sandboxId = requirement.id;
        // 需要从 sandboxManager 获取活跃的 sandbox
        // 这里简化处理，直接通过 SandboxManager.applyToSource
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
    parseCodeOutput(output) {
        if (Array.isArray(output))
            return output;
        if (output.files && Array.isArray(output.files))
            return output.files;
        return [output];
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