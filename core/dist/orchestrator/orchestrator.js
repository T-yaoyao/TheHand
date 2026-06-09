import { runClarification } from '../agents/clarification-agent.js';
import { createPlanAgent } from '../agents/plan-agent.js';
import { createBoundaryTestAgent } from '../agents/test-agent.js';
import { runCodingBatch, extractInterfaceSummary, extractAvailableDependencies, validateImports } from '../agents/coding-agent.js';
import { buildBatches, extractFileInterfaces, runArchitect } from '../agents/architect-agent.js';
import { join, dirname } from 'path';
import { TestRunner } from '../git-ops/test-runner.js';
import { RepoManager } from '../git-ops/repo-manager.js';
import { RiskAssessor } from '../utils/risk-assessor.js';
import { NaturalSummaryGenerator } from '../utils/natural-summary-generator.js';
import { DiffSafetyChecker } from '../utils/diff-safety-checker.js';
import { globalTracer } from '../utils/tracer.js';
import { detectCodingRegression, formatRegressionRetryHint } from '../utils/coding-regression-guard.js';
import { validateRequirement, validationErrorsToQuestions } from '../utils/requirement-validator.js';
import { loadSandboxSourceContents, sandboxIndexImportsComponent, skipOrphanImportIntegrationCheck, sourceFileImportsTargetModule } from '../utils/component-sandbox-import.js';
import { isRouteTableModulePath, pickApplicationEntryForRouteTable, collectRouteIntegrationContextPaths } from '../utils/route-wiring-entry.js';
import { findOutletNavRouteViolations } from '../utils/outlet-nav-route-guard.js';
import { findUnresolvedRelativeImportsInFileMap } from '../utils/relative-import-resolve-guard.js';
import { enrichPlanWithIntegrationEntryFiles } from '../utils/plan-integration-enrich.js';
import { sanitizePhantomRouteTablesAgainstEntryTopology } from '../utils/routing-entry-topology.js';
import { inferRouteEntryContextFromRequirementAndPlan } from '../utils/plan-route-context-infer.js';
import { extractAndReadErrorFiles } from '../utils/error-file-extractor.js';
import { Logger } from '../utils/logger.js';
import { TokenBudgetManager } from '../utils/token-budget.js';
/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 支持多阶段暂停：plan-ready → 用户审批 → coding → diff-ready → 用户确认 → commit
 */
export class Orchestrator {
    deps;
    sandboxShouldCleanup = true;
    logger;
    tokenBudget;
    constructor(deps) {
        this.deps = deps;
        this.logger = Logger.for('orchestrator');
        this.tokenBudget = new TokenBudgetManager();
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
        this.sandboxShouldCleanup = true;
        // ── 深度集成：全链路追踪初始化（全容错保护，绝不卡流程） ──
        try {
            if (!requirement.traceId) {
                requirement.traceId = globalTracer.startTrace();
                yield { type: 'executing', phase: `trace-id: ${requirement.traceId.slice(0, 16)}…`, progress: 0 };
            }
        }
        catch (enhanceErr) {
            // 追踪初始化失败绝不影响原有主流程，静默跳过
            console.warn('[enhancements] 全链路追踪跳过:', enhanceErr);
        }
        // 1. 创建沙箱（resume 时复用已有沙箱，所有状态都复用，绝不重复创建）
        let sandbox;
        const existingSandbox = sandboxManager.getExisting?.(requirement.id);
        if (existingSandbox) {
            sandbox = existingSandbox;
            yield { type: 'executing', phase: 'sandbox-reused', progress: 5 };
        }
        else {
            yield { type: 'executing', phase: 'sandbox-create', progress: 0 };
            sandbox = await sandboxManager.create(requirement.id);
            yield { type: 'executing', phase: 'sandbox-ready', progress: 5 };
        }
        // 初始化执行器（Docker 沙箱时命令在容器内执行）
        const executor = 'getExecutor' in sandboxManager
            ? sandboxManager.getExecutor(sandbox)
            : undefined;
        const testRunner = new TestRunner(sandbox.path, executor);
        const repoManager = new RepoManager(sandbox.path, executor);
        // 确保依赖已安装（复用沙箱时可能缺失）
        if (executor && existingSandbox) {
            try {
                const check = await executor('test -f node_modules/.bin/vite && echo ok || echo missing', { timeout: 5_000 });
                if (check.stdout.trim() === 'missing') {
                    yield { type: 'executing', phase: 'installing dependencies', progress: 8 };
                    await executor('npm install', { timeout: 180_000 });
                }
            }
            catch { }
        }
        // 加载项目上下文
        const projectContext = await projectMemory.load(projectId);
        try {
            // ── 状态检测：根据当前阶段跳转到对应入口 ──
            if (requirement.status === 'diff-ready') {
                // 跳转到提交阶段（用户已确认 diff）
                yield* this.phaseCommit(requirement, requirementMemory, repoManager, sandboxManager, sandbox);
                return;
            }
            if (requirement.status === 'plan-ready' && requirement.plan) {
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
            if ((requirement.status === 'clarifying' || requirement.status === 'waiting-for-pm' || requirement.status === 'needs-confirmation') &&
                pmReplies.length > 0) {
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
                // 必须在 yield 之前保存到 DB，因为 for-await break 会触发 generator.return() 跳过 yield 之后的代码
                // 使用 waiting-for-pm 与「澄清进行中 clarifying」区分：前者才表示已有追问、等待 PM 回复
                requirement.status = 'waiting-for-pm';
                // NOTE: transition() 已集成到 phase handlers，此处保留兼容路径
                requirement.structuredRequirement = clarificationResult.requirement;
                await requirementMemory.saveRequirement(requirement);
                this.sandboxShouldCleanup = false; // 暂停点，保留沙箱供后续 resume
                yield {
                    type: 'waiting-for-pm',
                    requirement: { ...requirement, status: 'waiting-for-pm' },
                    questions,
                };
                return;
            }
            requirement.structuredRequirement = clarificationResult.requirement;
            // 隐患2修复：如果是第3轮兜底生成的默认需求，进入needs-confirmation状态等待PM确认
            if (requirement.structuredRequirement?.isDefaulted) {
                requirement.status = 'needs-confirmation';
                await requirementMemory.saveRequirement(requirement);
                this.sandboxShouldCleanup = false;
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
            // ── 校验结构化需求的完整性 ──
            const validEntities = projectContext?.models ? Object.keys(projectContext.models) : [];
            const validation = validateRequirement(requirement.structuredRequirement, validEntities);
            if (!validation.valid) {
                const questions = validationErrorsToQuestions(validation.errors);
                console.log(`[orchestrator] 需求校验未通过: ${questions.join('; ')}`);
                // 可自动修复 → 追问 PM
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
                    this.sandboxShouldCleanup = false;
                    yield {
                        type: 'waiting-for-pm',
                        requirement: { ...requirement, status: 'clarifying' },
                        questions,
                    };
                    return;
                }
                // 不可自动修复或已到轮次上限 → needs-confirmation
                requirement.status = 'needs-confirmation';
                await requirementMemory.saveRequirement(requirement);
                this.sandboxShouldCleanup = false;
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
            requirement.status = 'clarified';
            // NOTE: transition() 已集成到 phase handlers，此处保留兼容路径
            await requirementMemory.saveRequirement(requirement);
            // 澄清完成，保存提示消息给用户
            await requirementMemory.addConversation({
                id: crypto.randomUUID(),
                requirementId: requirement.id,
                role: 'system',
                content: '✅ 澄清完成，开始生成方案…',
                round: currentRound,
                createdAt: new Date(),
            });
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
            // 扫描项目组件目录，注入到 plan agent 输入中，避免创建已有组件的替代品
            let existingComponentsHint = '';
            try {
                const { readdir } = await import('fs/promises');
                const scanDir = async (dir, prefix = '') => {
                    const results = [];
                    try {
                        const entries = await readdir(dir, { withFileTypes: true });
                        for (const e of entries) {
                            if (e.name.startsWith('.') || e.name === 'node_modules')
                                continue;
                            const relPath = prefix ? `${prefix}/${e.name}` : e.name;
                            if (e.isDirectory()) {
                                results.push(...await scanDir(`${dir}/${e.name}`, relPath));
                            }
                            else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
                                results.push(relPath);
                            }
                        }
                    }
                    catch { }
                    return results;
                };
                const componentFiles = await scanDir(join(sandbox.path, 'frontend/src/components'));
                const routeFiles = await scanDir(join(sandbox.path, 'frontend/src/routes'));
                if (componentFiles.length > 0 || routeFiles.length > 0) {
                    existingComponentsHint = '\n\n## 现有前端组件文件（必须修改已有组件，不要创建同名替代品）';
                    if (componentFiles.length > 0) {
                        existingComponentsHint += '\n### 组件 components/\n' + componentFiles.map(f => `- ${f}`).join('\n');
                    }
                    if (routeFiles.length > 0) {
                        existingComponentsHint += '\n### 路由页面 routes/\n' + routeFiles.map(f => `- ${f}`).join('\n');
                    }
                }
            }
            catch { }
            for (let planAttempt = 1; planAttempt <= MAX_RETRIES; planAttempt++) {
                yield { type: 'executing', phase: `planning (attempt ${planAttempt}/${MAX_RETRIES})`, progress: 20 };
                let planInput = planErrors.length > 0
                    ? requirement.pmInput + '\n\n## 上轮方案生成失败\n' + planErrors[planErrors.length - 1] + '\n请修正后重新生成方案。'
                    : requirement.pmInput;
                if (deleteHistoryHint) {
                    planInput += deleteHistoryHint;
                }
                planInput += existingComponentsHint;
                const planContext = {
                    requirement: { ...requirement, pmInput: planInput },
                    projectContext,
                    memory: await requirementMemory.getContext(requirement.id, projectContext),
                };
                const planResult = await agentRunner.run(createPlanAgent(), planContext);
                if (planResult.status === 'success' && planResult.output) {
                    const parsed = this.parsePlan(planResult.output);
                    let includeRouteEntryContext = parsed.includeRouteEntryContext;
                    const parsedFiles = parsed.files;
                    if (parsedFiles.length > 0) {
                        if (!includeRouteEntryContext &&
                            inferRouteEntryContextFromRequirementAndPlan(requirement.structuredRequirement, parsedFiles, requirement.pmInput)) {
                            includeRouteEntryContext = true;
                            console.log('[planning] 嵌套路由/Tab 语义推断：启用 includeRouteEntryContext，首轮并入入口与 readContextCandidates');
                        }
                        plan = await this.resolvePlanToExistingFiles(parsedFiles, sandbox.path);
                        plan = sanitizePhantomRouteTablesAgainstEntryTopology(plan, sandbox.path, projectContext);
                        plan = enrichPlanWithIntegrationEntryFiles(plan, sandbox.path, projectContext, includeRouteEntryContext);
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
            // ── 深度集成：自动风险评估 + 大白话摘要生成（全容错保护，绝不卡流程） ──
            let assessment = null;
            let naturalSummary = null;
            try {
                yield { type: 'executing', phase: 'risk-assessment', progress: 25 };
                const riskAssessor = new RiskAssessor();
                assessment = requirement.structuredRequirement
                    ? riskAssessor.assess(requirement.structuredRequirement, plan)
                    : null;
                if (requirement.structuredRequirement) {
                    const summaryGenerator = new NaturalSummaryGenerator();
                    naturalSummary = summaryGenerator.generate(requirement.structuredRequirement, plan);
                }
                // 保存评估结果到需求对象
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
                // 增强功能失败绝不影响原有主流程，静默跳过
                console.warn('[enhancements] 风险评估/摘要生成跳过:', enhanceErr);
            }
            // 方案就绪 → 暂停，等用户审批
            requirement.plan = plan;
            requirement.status = 'plan-ready';
            // NOTE: transition() 已集成到 phase handlers，此处保留兼容路径
            await requirementMemory.saveRequirement(requirement);
            this.sandboxShouldCleanup = false; // 暂停点，保留沙箱供后续 resume
            yield { type: 'plan-ready', plan, requirement, riskAssessment: assessment ?? undefined, naturalSummary: naturalSummary ?? undefined };
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
            if (this.sandboxShouldCleanup) {
                try {
                    await sandbox.cleanup();
                }
                catch { }
            }
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
        /** 上轮「整文件退化」检测失败时注入到下一轮 coding 的说明（prompt 内已含原版，此处强调策略） */
        let codingRegressionHint = '';
        const codeErrors = [];
        const { writeFile, mkdir, rm } = await import('fs/promises');
        const commands = projectContext.commands?.lint ? projectContext.commands : { lint: 'npm run lint', test: 'npm test', build: 'npm run build' };
        const pastLessons = await requirementMemory.getLessons(projectId, 'coding', 5);
        let codeOutputs = [];
        let previousOutputs = [];
        let finalFileValidationSummary = null;
        // 重试时追踪失败文件，用于精简上下文
        const failedFiles = new Set();
        /** 静态校验失败时须纳入后续轮次 plan 的路径（否则报错在 main.jsx 但方案只有子页，重试永远无法改到入口文件） */
        const staticGuardInjectPaths = new Set();
        const mergePlanWithInjections = (base) => {
            const norm = (p) => p.replace(/\\/g, '/');
            const byPath = new Map();
            for (const f of base) {
                const key = norm(f.path);
                byPath.set(key, { ...f, path: key });
            }
            const injectDesc = '【TheHand 编排器】须修正上一轮静态校验指出的问题（如无法解析的相对 import、或 Tab 与路由表不一致）；请对照沙箱磁盘**真实路径**做最小改动，勿臆造目录（例如 Conduit 须 `import App from "./App"` 而非 `./components/App`）。';
            for (const p of staticGuardInjectPaths) {
                if (byPath.has(p))
                    continue;
                byPath.set(p, { path: p, changeDescription: injectDesc, priority: 999_000 });
            }
            return [...byPath.values()].sort((a, b) => a.priority - b.priority);
        };
        for (let codeAttempt = 1; codeAttempt <= MAX_RETRIES; codeAttempt++) {
            yield { type: 'executing', phase: `coding (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 30 };
            let codingHint = '';
            if (pastLessons.length > 0) {
                codingHint = '\n\n## 历史失败教训（请避免重复以下错误）\n' +
                    pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n');
            }
            codeOutputs = [];
            let architectOutput = null;
            if (skill) {
                yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 35 };
                const skillOutputs = await skill.execute(requirement.structuredRequirement, projectContext);
                codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }));
            }
            else {
                let planFiles = mergePlanWithInjections(requirement.plan ?? []);
                const lastTestError = codeErrors.length > 0 ? codeErrors[codeErrors.length - 1] : undefined;
                // ── 重试时精简上下文：只重传失败文件，注入沙箱文件列表 ──
                let sandboxFileListHint = '';
                if (codeAttempt > 1 && failedFiles.size > 0) {
                    // 只重传失败的文件，已通过的文件从 plan 中移除
                    const passedFiles = planFiles.filter(f => !failedFiles.has(f.path));
                    planFiles = planFiles.filter(f => failedFiles.has(f.path));
                    if (planFiles.length === 0) {
                        // 所有文件都通过了校验，但测试失败了 → 重传全部
                        planFiles = mergePlanWithInjections(requirement.plan ?? []);
                    }
                    else {
                        console.log(`[coding] 重试精简: ${passedFiles.length} 个文件已通过，只重传 ${planFiles.length} 个失败文件: ${planFiles.map(f => f.path).join(', ')}`);
                    }
                    // 注入沙箱文件列表，防止 Agent 幻觉不存在的路径
                    try {
                        const { readdir } = await import('fs/promises');
                        const scanAllFiles = async (dir, prefix = '') => {
                            const results = [];
                            try {
                                const entries = await readdir(dir, { withFileTypes: true });
                                for (const e of entries) {
                                    if (e.name.startsWith('.') || e.name === 'node_modules')
                                        continue;
                                    const rel = prefix ? `${prefix}/${e.name}` : e.name;
                                    if (e.isDirectory()) {
                                        results.push(...await scanAllFiles(join(dir, e.name), rel));
                                    }
                                    else if (/\.(jsx?|tsx|ts|json)$/.test(e.name)) {
                                        results.push(rel);
                                    }
                                }
                            }
                            catch { }
                            return results;
                        };
                        const fileList = (await scanAllFiles(sandbox.path)).sort().join('\n').slice(0, 3000);
                        sandboxFileListHint = `\n\n## ⚠️ 沙箱中实际存在的文件（import 路径必须指向这些文件）\n\`\`\`\n${fileList}\`\`\``;
                    }
                    catch { }
                    // 注入可用依赖列表
                    const { extractAvailableDependencies } = await import('../agents/coding-agent.js');
                    const availableDeps = await extractAvailableDependencies(sandbox.path);
                    if (availableDeps.size > 0) {
                        sandboxFileListHint += `\n\n## ⚠️ 可用依赖（只允许 import 以下包）\n${[...availableDeps].sort().join(', ')}`;
                    }
                }
                const errorHintCombined = [
                    codingHint || '',
                    codingRegressionHint,
                    lastTestError ? `\n\n## 上轮测试失败\n${lastTestError}\n请分析错误根因并修正代码。` : '',
                    codeAttempt > 1 && previousOutputs.length > 0
                        ? '\n\n## 上轮生成的代码（仅供参考）\n' + previousOutputs.map(f => `- ${f.path}: ${f.summary}`).join('\n')
                        : '',
                    sandboxFileListHint,
                ].filter(Boolean).join('');
                if (false) {
                    // 小 plan 直出路径已废弃：始终走 architect 以确保新文件被集成
                    // （architect 的 ensureNewFilesIntegrated() 能自动检测并补全父文件引用）
                }
                {
                    // 始终走 LLM Architect 分析依赖 + 分批生成
                    yield { type: 'executing', phase: `architect analyzing ${planFiles.length} files...`, progress: 32 };
                    // 尝试 LLM Architect 分析，失败则重试一次，仍失败则降级到正则分批
                    for (let archAttempt = 1; archAttempt <= 2; archAttempt++) {
                        try {
                            if (requirement.structuredRequirement) {
                                architectOutput = await runArchitect(this.deps.agentRunner, promptManager, planFiles, sandbox.path, projectContext, requirement.structuredRequirement);
                            }
                            if (architectOutput)
                                break; // 成功，跳出重试循环
                        }
                        catch (archErr) {
                            console.warn(`[architect] 第 ${archAttempt} 次分析异常:`, archErr.message);
                            yield { type: 'executing', phase: `architect 异常 (${archAttempt}/2): ${archErr.message?.slice(0, 100) ?? 'unknown'}`, progress: 33, warnings: ['LLM 依赖分析异常'] };
                        }
                        if (archAttempt < 2) {
                            console.log('[architect] 重试 Architect 分析...');
                            yield { type: 'executing', phase: 'architect 重试中...', progress: 33 };
                        }
                    }
                    let batches, fileInterfaces;
                    if (architectOutput) {
                        // LLM 分析成功：使用 architect 的分批方案
                        batches = architectOutput.batches;
                        fileInterfaces = await extractFileInterfaces(sandbox.path, planFiles);
                        yield { type: 'executing', phase: `architect: ${batches.length} batches, ${architectOutput.crossFileRefs.length} cross-refs`, progress: 34 };
                    }
                    else {
                        // 降级：正则分批（限制每批 ≤ 3 个文件）
                        console.log('[batching] 降级到正则分批');
                        const fallback = await buildBatches(sandbox.path, planFiles);
                        batches = fallback.batches;
                        fileInterfaces = fallback.fileInterfaces;
                        // 拆分过大的 batch
                        const MAX_BATCH_SIZE = 3;
                        const normalized = [];
                        for (const batch of batches) {
                            if (batch.files.length <= MAX_BATCH_SIZE) {
                                normalized.push(batch);
                            }
                            else {
                                for (let i = 0; i < batch.files.length; i += MAX_BATCH_SIZE) {
                                    normalized.push({ files: batch.files.slice(i, i + MAX_BATCH_SIZE), reason: `${batch.reason}（拆分）` });
                                }
                            }
                        }
                        batches = normalized;
                        yield { type: 'executing', phase: `architect 失败，降级到正则分批: ${batches.length} batches`, progress: 34, warnings: ['LLM 依赖分析未生效，使用正则分批'] };
                    }
                    console.log(`[batching] ${batches.length} batches: ${batches.map(b => `[${b.files.join(', ')}]`).join(' → ')}`);
                    // 分批 Coding
                    const generatedSummaries = new Map();
                    let batchFailed = false;
                    for (let bi = 0; bi < batches.length; bi++) {
                        const batch = batches[bi];
                        yield {
                            type: 'executing',
                            phase: `coding batch ${bi + 1}/${batches.length}: ${batch.files.join(', ')}`,
                            progress: 35 + Math.floor(bi * 30 / batches.length),
                        };
                        try {
                            const batchOutputs = await runCodingBatch(llmClient, promptManager, batch, planFiles, fileInterfaces, generatedSummaries, sandbox.path, projectContext, errorHintCombined || undefined, 
                            // 传递 architect 增强数据
                            architectOutput?.files, architectOutput?.crossFileRefs, architectOutput?.globalContext);
                            codeOutputs.push(...batchOutputs);
                            // 提取本批次的接口摘要供后续批次使用
                            for (const output of batchOutputs) {
                                generatedSummaries.set(output.path, extractInterfaceSummary(output));
                            }
                        }
                        catch (batchErr) {
                            console.error(`[coding-batch] batch ${bi + 1} failed: ${batchErr.message}`);
                            yield {
                                type: 'executing',
                                phase: `batch ${bi + 1} failed: ${batchErr.message}`,
                                progress: 35 + Math.floor(bi * 30 / batches.length),
                            };
                            batchFailed = true;
                            // 继续执行后续 batch，不中断
                        }
                    }
                    // 所有 batch 都失败了，整个 coding attempt 失败
                    if (batchFailed && codeOutputs.length === 0) {
                        codeErrors.push(`第${codeAttempt}轮: 所有 batch 均失败`);
                        continue;
                    }
                }
            }
            // ──────────────────────────────────────────────────────────────
            // 依赖合法性校验：检测生成代码是否使用了未安装的第三方库
            // ──────────────────────────────────────────────────────────────
            {
                const availableDeps = await extractAvailableDependencies(sandbox.path);
                const violations = validateImports(codeOutputs, availableDeps);
                if (violations.length > 0) {
                    const violationMsg = violations.map(v => `${v.file}: import '${v.imp}'`).join('\n');
                    const errorMsg = `使用了未安装的依赖库：\n${violationMsg}\n\n` +
                        `请移除这些 import，用已安装的库或原生 JavaScript/CSS 替代。`;
                    codeErrors.push(`第${codeAttempt}轮: ${errorMsg}`);
                    // 追踪失败文件
                    for (const v of violations) {
                        failedFiles.add(v.file);
                    }
                    yield {
                        type: 'executing',
                        phase: `dependency violation: ${violations.map(v => v.imp).join(', ')}`,
                        progress: 50,
                        warnings: [errorMsg],
                    };
                    // 回滚本轮改动，进入下轮重试
                    if (executor) {
                        await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => { });
                    }
                    continue;
                }
            }
            // ──────────────────────────────────────────────────────────────
            // 分级告警兜底机制 v1.0
            // 从"静默兜底"升级为"三级分级处理"，彻底杜绝静默失败
            // ──────────────────────────────────────────────────────────────
            yield { type: 'executing', phase: 'validating-files', progress: 50 };
            const planFilesFull = mergePlanWithInjections(requirement.plan ?? []);
            // 重试模式下，只验证失败文件，不验证已通过的文件
            const planFilesToValidate = codeAttempt > 1 && failedFiles.size > 0
                ? planFilesFull.filter(f => failedFiles.has(f.path))
                : planFilesFull;
            const { readFile } = await import('fs/promises');
            // ── 辅助判定函数 ──
            function isCriticalFile(changeDesc) {
                const CRITICAL_KEYWORDS = [
                    '新增', 'add', 'Add', 'ADD',
                    '修改', 'update', 'Update', 'UPDATE',
                    '重构', 'refactor', 'Refactor',
                    '删除', 'delete', 'Delete', 'DELETE',
                    '实现', 'implement', 'Implement',
                ];
                const lower = changeDesc.toLowerCase();
                return CRITICAL_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
            }
            function isSafeToFallback(filePath, changeDesc) {
                const SAFE_EXT_PATTERNS = [/\.md$/, /\.txt$/, /\.json$/, /\.yaml$/, /\.yml$/];
                if (SAFE_EXT_PATTERNS.some(p => p.test(filePath)))
                    return true;
                const SUSPICIOUS_KEYWORDS = ['参考', '查看', '阅读', 'refer', 'read', '了解', '分析', 'analyze'];
                const lowerDesc = changeDesc.toLowerCase();
                return SUSPICIOUS_KEYWORDS.some(k => lowerDesc.includes(k.toLowerCase()));
            }
            // ── 1. 构建文件映射表 ──
            const fileMap = new Map();
            for (const output of codeOutputs) {
                if (output.path) {
                    fileMap.set(output.path, output);
                }
            }
            // ── 2. 分级校验所有 plan 文件 ──
            const fullyGenerated = [];
            const fallbackOriginal = [];
            const criticalMissing = [];
            for (const planFile of planFilesToValidate) {
                if (fileMap.has(planFile.path)) {
                    fullyGenerated.push(planFile.path);
                    continue;
                }
                console.log(`[coding] LLM 未返回文件: ${planFile.path}, desc: ${planFile.changeDescription.slice(0, 60)}`);
                if (isCriticalFile(planFile.changeDescription)) {
                    // Level 2: 关键文件缺失 → 绝对不兜底，标记为严重错误
                    criticalMissing.push(planFile.path);
                }
                else if (isSafeToFallback(planFile.path, planFile.changeDescription)) {
                    // Level 1: 安全文件 → 用原始内容兜底，记录告警
                    try {
                        const originalContent = await readFile(join(sandbox.path, planFile.path), 'utf-8');
                        fileMap.set(planFile.path, {
                            path: planFile.path,
                            content: originalContent,
                            summary: `[WARNING] LLM 未返回该文件变更，保留原始内容`,
                        });
                        fallbackOriginal.push(planFile.path);
                    }
                    catch {
                        // 兜底失败，创建空文件占位
                        fileMap.set(planFile.path, {
                            path: planFile.path,
                            content: '',
                            summary: planFile.changeDescription,
                        });
                        fallbackOriginal.push(planFile.path + ' (empty)');
                    }
                }
                else {
                    // 可疑文件 → 保守策略：直接归为 criticalMissing，本轮失败重试
                    criticalMissing.push(planFile.path);
                }
            }
            // ── 3. 生成文件校验摘要事件 ──
            const fileValidationSummary = {
                totalPlanFiles: planFilesToValidate.length,
                fullyGenerated,
                fallbackOriginal,
                noChangeDetected: [],
                criticalMissing,
            };
            finalFileValidationSummary = fileValidationSummary;
            yield { type: 'file-validation', summary: fileValidationSummary };
            // ── 4. 关键文件缺失 → 本轮直接失败，进入重试 ──
            if (criticalMissing.length > 0) {
                const err = `关键文件生成失败，LLM 未返回核心变更文件: ${criticalMissing.join(', ')}`;
                codeErrors.push(`第${codeAttempt}轮: ${err}`);
                yield {
                    type: 'executing',
                    phase: `critical-missing: ${criticalMissing.length} 个关键文件未返回`,
                    progress: 52,
                    warnings: criticalMissing,
                };
                if (codeAttempt === MAX_RETRIES) {
                    const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                    yield { type: 'failed', requirement, error: detailedError, userMessage: `关键代码文件生成失败，AI 遗漏了核心变更文件：${criticalMissing.join(', ')}。请尝试重新描述需求，或简化需求范围后重试。` };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    await requirementMemory.saveLesson({
                        id: crypto.randomUUID(),
                        projectId,
                        requirementId: requirement.id,
                        phase: 'coding',
                        filePath: null,
                        errorSummary: `关键文件缺失: ${criticalMissing.join(', ')}`,
                        errorDetail: detailedError,
                        fixHint: null,
                        resolved: false,
                        createdAt: new Date(),
                    });
                    return;
                }
                continue;
            }
            // ── 4.5 整文件退化检测（写入前）：体量骤减 / hooks 丢失等 → 带说明重试，不依赖测试才暴露
            const SRC_FOR_REGRESSION = /\.(jsx?|tsx|vue)$/;
            if (process.env.THEHAND_DISABLE_REGRESSION_GUARD !== '1') {
                const regressions = [];
                for (const planFile of planFilesToValidate) {
                    if (!SRC_FOR_REGRESSION.test(planFile.path))
                        continue;
                    const out = fileMap.get(planFile.path);
                    if (!out?.content || out.content === '__DELETE__')
                        continue;
                    let originalOnDisk = '';
                    try {
                        originalOnDisk = await readFile(join(sandbox.path, planFile.path), 'utf-8');
                    }
                    catch {
                        continue;
                    }
                    const { suspicious, reasons } = detectCodingRegression(originalOnDisk, out.content);
                    if (suspicious && reasons.length > 0) {
                        regressions.push({ path: planFile.path, reasons });
                    }
                }
                if (regressions.length > 0) {
                    codingRegressionHint = formatRegressionRetryHint(regressions);
                    const err = `编码退化检测：疑似整文件凭记忆重写、丢失 hooks/依赖：${regressions.map(r => r.path).join(', ')}`;
                    codeErrors.push(`第${codeAttempt}轮: ${err}`);
                    yield {
                        type: 'executing',
                        phase: `regression-guard: ${regressions.length} 个文件需基于原版最小修改`,
                        progress: 53,
                        warnings: regressions.flatMap(r => r.reasons.map(reason => `${r.path}: ${reason}`)),
                    };
                    if (codeAttempt === MAX_RETRIES) {
                        const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                        yield {
                            type: 'failed',
                            requirement,
                            error: detailedError,
                            userMessage: `生成代码与磁盘原版相比疑似大段丢失（常见于「整文件重写」漏掉 useEffect/useState 等）。涉及：${regressions.map(r => r.path).join(', ')}。请重试需求描述，或设置 THEHAND_DISABLE_REGRESSION_GUARD=1 跳过此检测（不推荐）。`,
                        };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        await requirementMemory.saveLesson({
                            id: crypto.randomUUID(),
                            projectId,
                            requirementId: requirement.id,
                            phase: 'coding',
                            filePath: regressions[0]?.path ?? null,
                            errorSummary: err,
                            errorDetail: detailedError,
                            fixHint: codingRegressionHint,
                            resolved: false,
                            createdAt: new Date(),
                        });
                        return;
                    }
                    continue;
                }
            }
            codingRegressionHint = '';
            // ── 5. 有兜底文件 → 推送黄色告警事件 ──
            if (fallbackOriginal.length > 0) {
                yield {
                    type: 'executing',
                    phase: `warning: ${fallbackOriginal.length} 个文件保留原始内容`,
                    progress: 55,
                    warnings: fallbackOriginal,
                };
            }
            // ── 5.5 组件文件集成校验（阻断式，触发重试） ──
            // 职责：兜底「真·新建组件未被相对 import」；与方案 Agent 分工——plan 须把新建挂载点写进 files；
            // 此处须不误伤桶结构（index re-export + Foo/Foo.jsx）、Vite 入口 main 等（见 component-sandbox-import、skipOrphanImportIntegrationCheck）。
            // 先查本轮 fileMap 互 import；若无，再扫沙箱内源码。跳过样式/资源文件。
            const COMPONENT_EXTS = /\.(jsx?|tsx|vue)$/;
            const STYLE_ASSET_EXTS = /\.(css|scss|less|svg|png|jpg|json)$/;
            const BARREL_EXTS = /\/index\.(jsx?|tsx|js|ts)$/;
            const generatedComponentFiles = planFilesToValidate.filter(f => {
                if (STYLE_ASSET_EXTS.test(f.path))
                    return false;
                if (!COMPONENT_EXTS.test(f.path))
                    return false;
                if (BARREL_EXTS.test(f.path))
                    return false; // index.js barrel export 不参与检测
                if (skipOrphanImportIntegrationCheck(f.path, projectContext.thehand?.orphanGuard))
                    return false; // Vite/React 入口不会被 JS import
                // 后端文件（models/routes/services）由 ORM/框架动态加载，不依赖直接 import，跳过孤立检测
                const backendDir = projectContext.structure.backend?.replace(/\/$/, '') || 'backend';
                if (f.path.startsWith(backendDir + '/') || f.path === backendDir)
                    return false;
                // 只检测被生成了的文件
                return fileMap.has(f.path);
            });
            if (generatedComponentFiles.length > 0) {
                let sandboxSourceIndex;
                const orphanFiles = [];
                const orphanHints = [];
                const knownFromBatch = new Set(fileMap.keys());
                for (const nf of generatedComponentFiles) {
                    const baseName = nf.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? '';
                    if (!baseName)
                        continue;
                    // 先：本轮产出文件之间是否互相 import（相对路径解析，避免子串误匹配）
                    let isImported = Array.from(fileMap.values()).some(other => {
                        if (other.path === nf.path)
                            return false;
                        if (BARREL_EXTS.test(other.path))
                            return false; // barrel export 不算真正使用
                        if (STYLE_ASSET_EXTS.test(other.path))
                            return false;
                        return sourceFileImportsTargetModule(other.content, other.path, nf.path, knownFromBatch);
                    });
                    // 再：沙箱内已有源码（含本轮未改动的父文件）是否已 import
                    if (!isImported) {
                        if (!sandboxSourceIndex) {
                            sandboxSourceIndex = await loadSandboxSourceContents(sandbox.path, projectContext.structure);
                            // 本轮 LLM 产出尚未写入磁盘，用 fileMap 覆盖/补全索引，避免漏检「仅存在于本轮的 import」
                            for (const o of fileMap.values()) {
                                if (!o.path || o.content === '__DELETE__')
                                    continue;
                                if (!/\.(jsx?|tsx|vue|mjs|cjs)$/.test(o.path))
                                    continue;
                                sandboxSourceIndex.set(o.path.replace(/\\/g, '/'), o.content);
                            }
                        }
                        isImported = sandboxIndexImportsComponent(sandboxSourceIndex, nf.path, baseName);
                    }
                    if (!isImported) {
                        orphanFiles.push(nf.path);
                        const normPath = nf.path.replace(/\\/g, '/');
                        // 路由表 router.jsx 等应由 main/App 入口 import，勿用「routes 下页面」当父组件推断
                        if (isRouteTableModulePath(normPath)) {
                            const entry = pickApplicationEntryForRouteTable(sandbox.path, projectContext);
                            if (entry) {
                                orphanHints.push(`${nf.path} 未被相对 import。应在应用入口 ${entry} 中 import 并挂接该路由表（例如将 main 内联 <Routes> 改为使用 router 模块），勿仅在 routes 下的页面组件中 import。`);
                            }
                            else {
                                orphanHints.push(`${nf.path} 未被任何文件 import。请在应用入口（如 frontend/src/main.jsx）中 import 并挂载该路由表。`);
                            }
                        }
                        else {
                            // 智能推荐父文件：优先同目录 > 同层级前端文件 > 语义匹配
                            const nfDir = normPath.split('/').slice(0, -1).join('/');
                            const nfSegments = nfDir.split('/');
                            // 排除自身、样式文件、barrel export、后端文件
                            const candidates = planFilesFull.filter(f => {
                                if (f.path === nf.path)
                                    return false;
                                if (STYLE_ASSET_EXTS.test(f.path))
                                    return false;
                                if (BARREL_EXTS.test(f.path))
                                    return false;
                                // 排除后端文件作为前端文件的父文件
                                const fBackendDir = projectContext.structure.backend?.replace(/\/$/, '') || 'backend';
                                if (f.path.startsWith(fBackendDir + '/'))
                                    return false;
                                return true;
                            });
                            let likelyParent;
                            // 优先级 1：同目录下的组件/页面文件（如 ArticleEditorForm 引入 getDrafts）
                            const sameDirParent = candidates.find(f => {
                                const fDir = f.path.split('/').slice(0, -1).join('/');
                                return fDir === nfDir && (f.path.includes('Component') || f.path.includes('Form') || f.path.includes('Page') || f.path.includes('View') || f.path.includes('Route'));
                            });
                            if (sameDirParent) {
                                likelyParent = sameDirParent;
                            }
                            // 优先级 2：前端 routes/ 下的页面文件（按路径层级匹配）
                            if (!likelyParent) {
                                likelyParent = candidates.find(f => {
                                    return f.path.includes('/routes/') && f.path.includes('/' + nfSegments[nfSegments.length - 2] + '/');
                                });
                            }
                            // 优先级 3：任何前端组件文件（List/Section/Home/Page/View/Form）
                            if (!likelyParent) {
                                likelyParent = candidates.find(f => {
                                    return f.path.includes('List') || f.path.includes('Section') ||
                                        f.path.includes('Home') || f.path.includes('Page') ||
                                        f.path.includes('View') || f.path.includes('Form');
                                });
                            }
                            // 优先级 4：同目录下的任何文件
                            if (!likelyParent) {
                                likelyParent = candidates.find(f => {
                                    const fDir = f.path.split('/').slice(0, -1).join('/');
                                    return fDir === nfDir;
                                });
                            }
                            if (likelyParent) {
                                orphanHints.push(`${nf.path} 未被 import，必须同时修改 ${likelyParent.path} 来 import 并使用它`);
                            }
                            else {
                                orphanHints.push(`${nf.path} 未被任何文件 import，必须修改父组件来 import 并使用它`);
                            }
                        }
                    }
                }
                if (orphanFiles.length > 0) {
                    const err = `组件孤立（未被父组件 import）:\n${orphanHints.join('\n')}`;
                    codeErrors.push(`第${codeAttempt}轮: ${err}`);
                    // 追踪失败文件：孤立文件 + 推荐的父文件都需要在重试中处理
                    for (const of of orphanFiles) {
                        failedFiles.add(of);
                    }
                    yield {
                        type: 'executing',
                        phase: `orphan-files: ${orphanFiles.length} 个组件未被引用`,
                        progress: 56,
                        warnings: orphanHints,
                    };
                    if (codeAttempt === MAX_RETRIES) {
                        const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                        yield { type: 'failed', requirement, error: detailedError, userMessage: `组件未被集成到页面中：${orphanFiles.join(', ')}。请尝试重新描述需求，明确要求修改父组件来引用新组件。` };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        await requirementMemory.saveLesson({
                            id: crypto.randomUUID(),
                            projectId,
                            requirementId: requirement.id,
                            phase: 'coding',
                            filePath: null,
                            errorSummary: `孤立组件: ${orphanFiles.join(', ')}`,
                            errorDetail: detailedError,
                            fixHint: orphanHints.join('\n'),
                            resolved: false,
                            createdAt: new Date(),
                        });
                        return;
                    }
                    continue;
                }
            }
            // ── 5.6 含 <Outlet> 的布局里相对 Tab（NavItem url / NavLink to）须在路由表中有对应 path，否则运行期 404
            if (process.env.THEHAND_DISABLE_OUTLET_NAV_GUARD !== '1') {
                const outletViolations = await findOutletNavRouteViolations(sandbox.path, projectContext, planFilesFull, fileMap);
                if (outletViolations.length > 0) {
                    const hints = outletViolations.map(v => v.message);
                    const err = `嵌套路由未注册（Tab 与路由表不一致）:\n${hints.join('\n')}`;
                    codeErrors.push(`第${codeAttempt}轮: ${err}`);
                    yield {
                        type: 'executing',
                        phase: `outlet-nav-route: ${outletViolations.length} 处 Tab 缺少对应 Route`,
                        progress: 57,
                        warnings: hints,
                    };
                    if (codeAttempt === MAX_RETRIES) {
                        const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                        yield {
                            type: 'failed',
                            requirement,
                            error: detailedError,
                            userMessage: `导航与路由表不一致：${outletViolations.map(v => `「${v.segment}」@${v.layoutPath}`).join('；')}。请在路由入口（如 main.jsx）为上述路径增加嵌套 <Route path="..." />。`,
                        };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        await requirementMemory.saveLesson({
                            id: crypto.randomUUID(),
                            projectId,
                            requirementId: requirement.id,
                            phase: 'coding',
                            filePath: outletViolations[0]?.layoutPath ?? null,
                            errorSummary: `Outlet/Tab 与 Route 不一致: ${outletViolations.map(v => v.segment).join(', ')}`,
                            errorDetail: detailedError,
                            fixHint: hints.join('\n'),
                            resolved: false,
                            createdAt: new Date(),
                        });
                        return;
                    }
                    const injectPaths = collectRouteIntegrationContextPaths(sandbox.path, projectContext);
                    for (const p of injectPaths) {
                        staticGuardInjectPaths.add(p.replace(/\\/g, '/'));
                    }
                    if (injectPaths.length > 0) {
                        console.log(`[coding] outlet-nav 未通过，已将路由上下文并入下一轮 plan: ${injectPaths.join(', ')}`);
                    }
                    continue;
                }
            }
            // ── 5.7 相对 import 须在沙箱内可解析（避免 Vite Failed to resolve import 在仅跑 vitest 时漏检）
            if (process.env.THEHAND_DISABLE_RELATIVE_IMPORT_GUARD !== '1') {
                const importViolations = await findUnresolvedRelativeImportsInFileMap(sandbox.path, projectContext, planFilesFull, fileMap);
                if (importViolations.length > 0) {
                    const hints = importViolations.map(v => v.message);
                    const err = `相对 import 无法解析:\n${hints.join('\n')}`;
                    codeErrors.push(`第${codeAttempt}轮: ${err}`);
                    // 追踪失败文件，用于重试时精简上下文
                    for (const v of importViolations) {
                        if (v.fromPath)
                            failedFiles.add(v.fromPath);
                    }
                    yield {
                        type: 'executing',
                        phase: `relative-import-resolve: ${importViolations.length} 处 import 目标不存在`,
                        progress: 57.5,
                        warnings: hints,
                    };
                    if (codeAttempt === MAX_RETRIES) {
                        const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                        yield {
                            type: 'failed',
                            requirement,
                            error: detailedError,
                            userMessage: `代码中存在无法解析的相对路径 import：${importViolations.map(v => `${v.fromPath} → «${v.specifier}»`).join('；')}。请对照仓库实际目录修正 import。`,
                        };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        await requirementMemory.saveLesson({
                            id: crypto.randomUUID(),
                            projectId,
                            requirementId: requirement.id,
                            phase: 'coding',
                            filePath: importViolations[0]?.fromPath ?? null,
                            errorSummary: `无法解析的 import: ${importViolations.map(v => v.specifier).join(', ')}`,
                            errorDetail: detailedError,
                            fixHint: hints.join('\n'),
                            resolved: false,
                            createdAt: new Date(),
                        });
                        return;
                    }
                    for (const v of importViolations) {
                        staticGuardInjectPaths.add(v.fromPath.replace(/\\/g, '/'));
                    }
                    console.log(`[coding] relative-import 未通过，已并入下一轮 plan: ${[...new Set(importViolations.map(v => v.fromPath))].join(', ')}`);
                    continue;
                }
            }
            // ── 6. 最终结果校验 ──
            const validOutputs = Array.from(fileMap.values());
            console.log(`[coding] 文件校验完成: 总plan=${planFilesToValidate.length}, 正常生成=${fullyGenerated.length}, 兜底=${fallbackOriginal.length}`);
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
            // ── 隐患7修复：先清理所有残留的 .orig 文件，避免旧备份污染本轮校验 ──
            const { unlink, readdir } = await import('fs/promises');
            try {
                const walkDir = async (dir) => {
                    const results = [];
                    const entries = await readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const fullPath = join(dir, e.name);
                        if (e.isDirectory()) {
                            results.push(...(await walkDir(fullPath)));
                        }
                        else if (e.name.endsWith('.orig')) {
                            results.push(fullPath);
                        }
                    }
                    return results;
                };
                const oldOrigFiles = await walkDir(sandbox.path);
                for (const f of oldOrigFiles) {
                    await unlink(f).catch(() => { });
                }
                console.log(`[coding] 清理了 ${oldOrigFiles.length} 个残留的 .orig 文件`);
            }
            catch { }
            // ── 7. 写入前备份原始文件，用于后续 Diff 空变更检测 ──
            yield { type: 'executing', phase: 'writing-files', progress: 60 };
            for (const file of validOutputs) {
                const fullPath = join(sandbox.path, file.path);
                const origBackupPath = fullPath + '.orig';
                try {
                    const exists = await readFile(fullPath, 'utf-8');
                    await writeFile(origBackupPath, exists, 'utf-8');
                }
                catch {
                    // 原文件不存在，创建空备份
                    await mkdir(dirname(origBackupPath), { recursive: true });
                    await writeFile(origBackupPath, '', 'utf-8');
                }
            }
            // ── 8. 写入所有文件 ──
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
            // ── 9. Diff 空变更检测：检查每个计划修改的文件是否真的产生了变化 ──
            yield { type: 'executing', phase: 'diff-validation', progress: 62 };
            for (const file of validOutputs) {
                const origBackupPath = join(sandbox.path, file.path + '.orig');
                const newPath = join(sandbox.path, file.path);
                try {
                    const originalContent = await readFile(origBackupPath, 'utf-8');
                    const newContent = await readFile(newPath, 'utf-8');
                    if (originalContent === newContent) {
                        fileValidationSummary.noChangeDetected.push(file.path);
                    }
                }
                catch {
                    // 跳过无法读取的文件
                }
            }
            finalFileValidationSummary = fileValidationSummary;
            // ── 10. 有空变更文件 → 容错降级处理 ──
            if (fileValidationSummary.noChangeDetected.length > 0) {
                const noChangeFiles = fileValidationSummary.noChangeDetected;
                // 容错：如果所有文件都完全没有变更，才判定失败
                // 避免部分文件没改但其他文件改了的情况下，直接阻断流程
                if (noChangeFiles.length === validOutputs.length) {
                    const err = `所有计划修改的文件内容完全没有变化: ${noChangeFiles.join(', ')}`;
                    codeErrors.push(`第${codeAttempt}轮: ${err}`);
                    yield {
                        type: 'executing',
                        phase: `no-change-detected: 所有文件未产生变更`,
                        progress: 63,
                        warnings: noChangeFiles,
                    };
                    if (codeAttempt === MAX_RETRIES) {
                        const detailedError = `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`;
                        yield { type: 'failed', requirement, error: detailedError, userMessage: `代码生成失败，所有计划修改的文件内容完全没有变化。请尝试重新描述需求后重试。` };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        await requirementMemory.saveLesson({
                            id: crypto.randomUUID(),
                            projectId,
                            requirementId: requirement.id,
                            phase: 'coding',
                            filePath: null,
                            errorSummary: `全量空变更文件: ${noChangeFiles.join(', ')}`,
                            errorDetail: detailedError,
                            fixHint: null,
                            resolved: false,
                            createdAt: new Date(),
                        });
                        return;
                    }
                    continue;
                }
                else {
                    // 部分文件没改，其他文件改了 → 只记录警告，不阻断流程
                    yield {
                        type: 'executing',
                        phase: `warning: ${noChangeFiles.length} 个文件未产生变更`,
                        progress: 64,
                        warnings: noChangeFiles,
                    };
                }
            }
            // 关键字校验逻辑已移除：自然语言需求和代码之间不存在简单的字符串匹配关系
            // 用更可靠的两道关卡替代：分级告警审计层 + 全量空变更检测
            // 这两道关卡的可靠性远高于低质量的字符串匹配，且完全不会误判正常流程
            // 保存本轮输出，供下轮重试参考
            previousOutputs = codeOutputs;
            // 测试阶段
            yield { type: 'status-change', status: 'testing', agent: 'test' };
            yield { type: 'executing', phase: `testing (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 70 };
            // 提取本次变更的文件列表，用于限定测试范围（避免无关测试误报失败）
            const changedFilesForTest = codeOutputs
                .filter(f => f.path && f.content !== '__DELETE__')
                .map(f => f.path);
            const testResult = await testRunner.run({
                lint: commands.lint,
                test: commands.test,
                build: commands.build,
            }, 3, changedFilesForTest);
            yield {
                type: 'test-result',
                passed: testResult.passed,
                details: JSON.stringify(testResult, null, 2),
            };
            if (testResult.passed) {
                for (const lesson of pastLessons) {
                    await requirementMemory.markLessonResolved(lesson.id);
                }
                // 测试通过后清理 .orig 备份文件，避免污染 diff
                if (executor) {
                    try {
                        await executor('find . -name "*.orig" -delete', { timeout: 10_000 });
                    }
                    catch { }
                }
                // ── 边界测试生成：分析变更代码，生成补充测试用例 ──
                try {
                    const changedFilesList = codeOutputs.filter(f => f.path && f.content !== '__DELETE__').map(f => f.path);
                    // 复杂度评估：简单 UI 组件 / 单文件修改不值得运行边界测试
                    const totalLines = codeOutputs.reduce((sum, f) => sum + (f.content?.split('\n').length ?? 0), 0);
                    const isSimpleChange = (changedFilesList.length <= 1 && totalLines < 50 ||
                        changedFilesList.every(f => /\.(css|scss|less)$/.test(f)));
                    if (isSimpleChange) {
                        this.logger.info(`跳过边界测试：低复杂度变更 (files=${changedFilesList.length}, lines=${totalLines})`);
                        yield {
                            type: 'executing',
                            phase: 'boundary tests skipped (simple change)',
                            progress: 78,
                        };
                    }
                    else {
                        yield { type: 'executing', phase: 'generating boundary tests', progress: 75 };
                        const changedFiles = changedFilesList.join(', ');
                        const boundaryTestContext = `本次修改的文件：${changedFiles}\n\n` +
                            `请分析这些文件中的函数，为未覆盖的边界条件生成测试用例。\n` +
                            `项目测试命令：${commands.test}\n` +
                            `已有测试文件：查看项目中已有的 .test.js 文件了解测试框架和 mock 模式。`;
                        // 推断测试框架（从 projectContext 或 package.json 特征判断）
                        const testFramework = projectContext.thehand?.frontendFramework ? 'vitest' : 'jest';
                        const boundaryTestResult = await this.deps.agentRunner.run(createBoundaryTestAgent({
                            testCommand: commands.test,
                            testFramework,
                            changedFiles: changedFilesList,
                        }), {
                            requirement: { ...requirement, pmInput: boundaryTestContext },
                            projectContext,
                            memory: await requirementMemory.getContext(requirement.id, projectContext),
                        });
                        if (boundaryTestResult.status === 'success') {
                            yield {
                                type: 'executing',
                                phase: 'boundary tests generated, running...',
                                progress: 78,
                            };
                            // 运行完整测试套件（包含新生成的边界测试）
                            // 注意：此处不传 changedFiles，因为边界测试后应跑全量回归验证
                            const fullTestResult = await testRunner.run({
                                lint: commands.lint,
                                test: commands.test,
                                build: commands.build,
                            });
                            yield {
                                type: 'test-result',
                                passed: fullTestResult.passed,
                                details: JSON.stringify(fullTestResult, null, 2),
                            };
                            if (!fullTestResult.passed) {
                                // 边界测试发现问题，记录但不阻断（边界测试是补充性的）
                                yield {
                                    type: 'executing',
                                    phase: 'boundary tests found issues (non-blocking)',
                                    progress: 80,
                                    warnings: [`边界测试未全部通过：${fullTestResult.steps.filter(s => !s.passed).map(s => s.name).join(', ')}`],
                                };
                            }
                        }
                    } // end !isSimpleChange
                }
                catch (boundaryErr) {
                    // 边界测试生成失败不阻断主流程
                    yield {
                        type: 'executing',
                        phase: `boundary test generation skipped: ${boundaryErr.message?.slice(0, 100)}`,
                        progress: 78,
                    };
                }
                break;
            }
            // ── 构建增强版 testError：完整错误 + 错误相关文件内容 ──
            const errorOutput = testResult.steps
                .filter(s => !s.passed)
                .map(s => `${s.name}: ${s.output}`) // 不截断，保留完整错误
                .join('\n---\n');
            // ── 错误分类：环境错误直接失败，不浪费重试次数 ──
            const ENV_ERROR_PATTERNS = [
                /GLIBC_\d+\.\d+.*not found/i,
                /version.*GLIBC.*not found/i,
                /Cannot find module.*\.node['"]/, // 原生模块加载失败
                /node_sqlite3\.node/i, // sqlite3 原生模块
                /\/lib\/.*\.so.*not found/i, // 共享库缺失
                /Permission denied/i,
                /ENOSPC.*no space left/i,
                /ENOMEM.*out of memory/i,
                /docker.*not found/i,
                /Cannot find package 'sqlite3'/i,
            ];
            const isEnvError = ENV_ERROR_PATTERNS.some(p => p.test(errorOutput));
            if (isEnvError) {
                const envErrorMsg = `环境错误（非代码问题，重试无法解决）:\n${errorOutput.slice(0, 500)}`;
                yield { type: 'failed', requirement, error: envErrorMsg, userMessage: `测试环境配置错误，非代码问题。请检查 Docker 沙箱的系统库版本或项目依赖配置。` };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                return;
            }
            // 从错误中提取涉及的源码文件路径，读取其内容作为上下文
            const errorFileContents = await extractAndReadErrorFiles(errorOutput, sandbox.path);
            if (errorFileContents.length > 0) {
                yield {
                    type: 'executing',
                    phase: `reading ${errorFileContents.length} error-related files for context`,
                    progress: 64,
                };
            }
            // 将完整错误 + 文件内容一起存入 codeErrors，供下轮重试使用
            let enhancedError = `第${codeAttempt}轮测试失败:\n${errorOutput.slice(0, 2000)}`;
            if (errorFileContents.length > 0) {
                enhancedError += '\n\n## 错误涉及的源码文件（请重点检查这些文件的 import/export 是否正确）\n' +
                    errorFileContents.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
            }
            codeErrors.push(enhancedError);
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
        // ── 深度集成：增强 Diff 安全检查（全容错保护，绝不卡流程） ──
        let diffCheckResult = null;
        try {
            yield { type: 'executing', phase: 'enhanced-diff-safety-check', progress: 80 };
            const originalFiles = new Map();
            for (const file of validOutputs) {
                try {
                    const { readFile } = await import('fs/promises');
                    const originalContent = await readFile(join(sandbox.path, file.path + '.orig'), 'utf-8');
                    originalFiles.set(file.path, originalContent);
                }
                catch {
                    // .orig 文件不存在，跳过
                }
            }
            const diffSafetyChecker = new DiffSafetyChecker(sandbox.path);
            diffCheckResult = await diffSafetyChecker.check(originalFiles, requirement.plan ?? []);
        }
        catch (enhanceErr) {
            // 增强 Diff 检查失败绝不影响原有主流程，静默跳过
            console.warn('[enhancements] Diff安全检查跳过:', enhanceErr);
        }
        // 原有基础 Diff 检查
        yield { type: 'executing', phase: 'diff-check', progress: 85 };
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
        // NOTE: transition() 已集成到 phase handlers，此处保留兼容路径
        await requirementMemory.saveRequirement(requirement);
        this.sandboxShouldCleanup = false; // 暂停点，保留沙箱供后续 commit
        yield {
            type: 'diff-ready',
            requirement,
            diff: diffContent,
            files: validOutputs.map(f => ({ path: f.path, summary: f.summary })),
            diffCheck: diffCheckResult,
            fileValidationSummary: finalFileValidationSummary ?? undefined,
        };
        return;
    }
    /**
     * 提交+应用阶段（支持从 diff-ready 状态直接进入）
     */
    async *phaseCommit(requirement, requirementMemory, repoManager, sandboxManager, sandbox) {
        yield { type: 'executing', phase: 'committing', progress: 90 };
        const reqMarker = `[req:${requirement.id.slice(0, 8)}]`;
        const rawDesc = (requirement.structuredRequirement?.description ?? requirement.pmInput).replace(/[`$"]/g, "'");
        const commitMsg = `${reqMarker} feat: ${rawDesc}`.slice(0, 200);
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
        // 应用到源仓库 — 从刚提交的 commit 中获取变更文件列表
        yield { type: 'executing', phase: 'applying-to-source', progress: 97 };
        let changedFiles = [];
        try {
            const { stdout } = await repoManager.getLastCommitFiles();
            changedFiles = stdout.trim().split('\n').filter(Boolean);
        }
        catch { }
        if (changedFiles.length === 0) {
            // fallback: validOutputs from phaseCoding (if available)
            changedFiles = (requirement.plan ?? []).map((f) => f.path).filter(Boolean);
        }
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
        // NOTE: transition() 已集成到 phase handlers，此处保留兼容路径
        await requirementMemory.saveRequirement(requirement);
        yield { type: 'completed', requirement };
    }
    /**
     * 处理 PM 回复（追问后的继续流程）
     */
    async *continueWithPMReply(requirement, pmReply, projectId = 'conduit') {
        // 从对话历史推算当前轮次（与 run() 保持一致：PM 回复数 + 1）
        const recentConvs = await this.deps.requirementMemory.getRecentConversations(requirement.id, 50);
        const pmReplyCount = recentConvs.filter(c => c.role === 'pm').length;
        await this.deps.requirementMemory.addConversation({
            id: crypto.randomUUID(),
            requirementId: requirement.id,
            role: 'pm',
            content: pmReply,
            round: 1 + pmReplyCount,
            createdAt: new Date(),
        });
        requirement.pmInput = pmReply;
        yield* this.run(requirement, projectId);
    }
    parsePlan(output) {
        let files = [];
        if (Array.isArray(output)) {
            files = output;
        }
        else if (output?.files && Array.isArray(output.files)) {
            files = output.files;
        }
        else if (output?.plan && Array.isArray(output.plan)) {
            files = output.plan;
        }
        let includeRouteEntryContext = false;
        if (output && typeof output === 'object' && !Array.isArray(output) && output.includeRouteEntryContext === true) {
            includeRouteEntryContext = true;
        }
        return { files, includeRouteEntryContext };
    }
    /**
     * 将 plan 中的新文件映射到已有的相似文件
     * 解决 LLM 创建 ArticlePreview.jsx 而不是修改 ArticlesPreview.jsx 的问题
     */
    async resolvePlanToExistingFiles(plan, sandboxPath) {
        const { access } = await import('fs/promises');
        const resolved = [];
        for (const file of plan) {
            const fullPath = join(sandboxPath, file.path);
            // 检查文件是否已存在
            let exists = false;
            try {
                await access(fullPath);
                exists = true;
            }
            catch { }
            if (exists) {
                resolved.push(file);
                continue;
            }
            // 文件不存在 → 在同目录和父目录中查找名称相似的已有文件
            const dir = file.path.split('/').slice(0, -1).join('/');
            const name = file.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? '';
            if (!name) {
                resolved.push(file);
                continue;
            }
            // 扫描同目录和父目录
            const searchDirs = [dir];
            const parts = dir.split('/');
            for (let i = parts.length - 1; i >= 0; i--) {
                searchDirs.push(parts.slice(0, i).join('/'));
            }
            let bestMatch = null;
            for (const searchDir of searchDirs) {
                if (!searchDir)
                    continue;
                try {
                    const entries = await this.listFilesRecursive(join(sandboxPath, searchDir));
                    for (const entry of entries) {
                        const entryName = entry.replace(/\.(jsx?|tsx|vue)$/, '').split('/').pop() ?? '';
                        if (!entryName)
                            continue;
                        // 名称相似：大小写相同、单复数差异、包含关系
                        if (entryName.toLowerCase() === name.toLowerCase() ||
                            entryName.toLowerCase() === name.toLowerCase() + 's' ||
                            name.toLowerCase() === entryName.toLowerCase() + 's' ||
                            (entryName.length > 3 && name.length > 3 &&
                                (entryName.toLowerCase().includes(name.toLowerCase()) ||
                                    name.toLowerCase().includes(entryName.toLowerCase())))) {
                            bestMatch = `${searchDir}/${entry}`;
                            break;
                        }
                    }
                    if (bestMatch)
                        break;
                }
                catch { }
            }
            if (bestMatch) {
                // 把新文件替换为修改已有文件
                const existingPath = bestMatch.replace(/\\/g, '/');
                console.log(`[plan-resolve] ${file.path} → ${existingPath}（已有相似文件，改为修改）`);
                resolved.push({
                    path: existingPath,
                    changeDescription: `[自动修正] 原计划创建 ${file.path}，但 ${existingPath} 已存在。${file.changeDescription}`,
                    priority: file.priority,
                });
            }
            else {
                resolved.push(file);
            }
        }
        return resolved;
    }
    /**
     * 递归列出目录下的组件文件
     */
    async listFilesRecursive(dirPath, maxDepth = 3) {
        const { readdir } = await import('fs/promises');
        const results = [];
        const walk = async (dir, depth) => {
            if (depth > maxDepth)
                return;
            try {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.name.startsWith('.') || e.name === 'node_modules')
                        continue;
                    if (e.isDirectory()) {
                        await walk(`${dir}/${e.name}`, depth + 1);
                    }
                    else if (/\.(jsx?|tsx|vue)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
                        results.push(e.name);
                    }
                }
            }
            catch { }
        };
        await walk(dirPath, 0);
        return results;
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