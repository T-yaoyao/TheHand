/**
 * 编码+测试阶段
 * Architect 分析 → 分批编码 → 文件校验 → 测试 → Diff 生成
 *
 * 支持三种输出模式：
 * 1. 全量重写（默认）- AI 输出完整文件
 * 2. __APPEND__ 追加 - CSS 等大文件只追加新内容
 * 3. __PATCH__ 手术式编辑 - diff-safety 失败后自动切换，AI 只输出要改的行
 */
import { readFile, writeFile, mkdir, rm, unlink, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { runCodingBatch, extractInterfaceSummary } from '../../agents/coding-agent.js';
import { buildBatches, extractFileInterfaces, runArchitect } from '../../agents/architect-agent.js';
import { DiffSafetyChecker } from '../../utils/diff-safety-checker.js';
import { extractAndReadErrorFiles } from '../helpers.js';
import { createLogger } from '../../utils/logger.js';
import { MAX_RETRIES, } from '../../config.js';
const log = createLogger('phase:coding');
// ── Patch 模式的 FC 工具定义 ──
const PATCH_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'submit_patch',
            description: '提交手术式补丁。只输出需要修改的具体行，系统会在原文件上精确应用。',
            parameters: {
                type: 'object',
                properties: {
                    file: { type: 'string', description: '文件路径' },
                    operations: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ['insert_after', 'replace_lines', 'append'], description: '操作类型' },
                                line: { type: 'number', description: 'insert_after/replace_lines 的目标行号（从1开始）' },
                                endLine: { type: 'number', description: 'replace_lines 的结束行号' },
                                content: { type: 'string', description: '要插入/替换的内容' },
                            },
                            required: ['type', 'content'],
                        },
                    },
                },
                required: ['file', 'operations'],
            },
        },
    },
];
export class CodingPhase {
    name = 'coding';
    async *run(ctx) {
        const { requirement, projectId, requirementMemory, skillRegistry, llmClient, promptManager, projectContext, testRunner, repoManager, sandboxManager, sandbox, executor, } = ctx;
        yield { type: 'status-change', status: 'coding', agent: 'coding' };
        const skill = requirement.structuredRequirement
            ? skillRegistry.match(requirement.structuredRequirement)
            : null;
        const codeErrors = [];
        const commands = projectContext.commands ?? { lint: 'echo lint skipped', test: 'echo test skipped', build: 'echo build skipped' };
        const pastLessons = await requirementMemory.getLessons(projectId, 'coding', 5);
        let codeOutputs = [];
        let previousOutputs = [];
        let finalFileValidationSummary = null;
        for (let codeAttempt = 1; codeAttempt <= MAX_RETRIES; codeAttempt++) {
            yield { type: 'executing', phase: `coding (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 30 };
            let codingHint = '';
            if (pastLessons.length > 0) {
                const lessonsText = pastLessons.map(l => `- [${l.phase}/${l.filePath ?? 'general'}] ${l.errorSummary}`).join('\n');
                codingHint = '\n\n' + await promptManager.loadAndRender('shared/lessons', { lessons: lessonsText });
            }
            // ── 如果上轮因 diff-safety 失败，切换到 patch 模式 ──
            const lastError = codeErrors[codeErrors.length - 1] ?? '';
            const usePatchMode = lastError.includes('标签被替换') || lastError.includes('非计划变更');
            codeOutputs = [];
            let architectOutput = null;
            const lastTestError = codeErrors.length > 0 ? codeErrors[codeErrors.length - 1] : undefined;
            let errorHintCombined = [
                codingHint || '',
                lastTestError ? `\n\n## 上轮错误反馈\n${lastTestError}` : '',
                codeAttempt > 1 && previousOutputs.length > 0
                    ? '\n\n## 上轮生成的代码（仅供参考）\n' + previousOutputs.map(f => `- ${f.path}: ${f.summary}`).join('\n')
                    : '',
            ].filter(Boolean).join('');
            if (skill) {
                yield { type: 'executing', phase: `skill: ${skill.name}`, progress: 35 };
                const skillOutputs = await skill.execute(requirement.structuredRequirement, projectContext);
                codeOutputs = skillOutputs.map(o => ({ path: o.path, content: o.content, summary: o.summary }));
            }
            else {
                const planFiles = requirement.plan ?? [];
                // Architect 分析
                yield { type: 'executing', phase: `architect analyzing ${planFiles.length} files...`, progress: 32 };
                try {
                    if (requirement.structuredRequirement) {
                        architectOutput = await runArchitect(ctx.agentRunner, promptManager, planFiles, sandbox.path, projectContext, requirement.structuredRequirement);
                    }
                }
                catch (archErr) {
                    log.warn('LLM 分析异常，降级到正则分批', archErr.message);
                    yield { type: 'executing', phase: `architect 异常: ${archErr.message?.slice(0, 100) ?? 'unknown'}`, progress: 33, warnings: ['LLM 依赖分析异常，将降级到正则分批'] };
                }
                let batches, fileInterfaces;
                if (architectOutput) {
                    batches = architectOutput.batches;
                    fileInterfaces = await extractFileInterfaces(sandbox.path, planFiles, projectContext.ormPatterns?.modelField);
                    yield { type: 'executing', phase: `architect: ${batches.length} batches, ${architectOutput.crossFileRefs.length} cross-refs`, progress: 34 };
                }
                else {
                    log.info('降级到正则分批');
                    const fallback = await buildBatches(sandbox.path, planFiles);
                    batches = fallback.batches;
                    fileInterfaces = fallback.fileInterfaces;
                    yield { type: 'executing', phase: `architect 失败，降级到正则分批: ${batches.length} batches`, progress: 34, warnings: ['LLM 依赖分析未生效，使用正则分批'] };
                }
                log.info(`${batches.length} batches: ${batches.map((b) => `[${b.files.join(', ')}]`).join(' → ')}`);
                if (usePatchMode) {
                    // ── Patch 模式：对每个文件做手术式编辑 ──
                    log.info('切换到 patch 模式：AI 只输出要改的行');
                    yield { type: 'executing', phase: 'patch mode: 手术式编辑', progress: 35 };
                    for (const planFile of planFiles) {
                        const fullPath = join(sandbox.path, planFile.path);
                        let originalContent = '';
                        try {
                            originalContent = await readFile(fullPath, 'utf-8');
                        }
                        catch { }
                        if (planFile.path.endsWith('.css') || planFile.path.endsWith('.scss')) {
                            // CSS 继续用 append 模式
                            const batchOutputs = await this.runCodingBatchSafe(llmClient, promptManager, { files: [planFile.path], reason: 'CSS' }, planFiles, fileInterfaces, new Map(), sandbox.path, projectContext, errorHintCombined || undefined, architectOutput?.files, architectOutput?.crossFileRefs, architectOutput?.globalContext);
                            codeOutputs.push(...batchOutputs);
                        }
                        else {
                            // 非 CSS 文件：patch 模式
                            const patchResult = await this.runPatchMode(llmClient, promptManager, planFile, originalContent, sandbox.path, projectContext, errorHintCombined || undefined, architectOutput?.files?.find(f => f.path === planFile.path)?.detailedChange);
                            if (patchResult) {
                                codeOutputs.push(patchResult);
                            }
                        }
                    }
                }
                else {
                    // ── 正常模式：全量重写 ──
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
                            const batchOutputs = await this.runCodingBatchSafe(llmClient, promptManager, batch, planFiles, fileInterfaces, generatedSummaries, sandbox.path, projectContext, errorHintCombined || undefined, architectOutput?.files, architectOutput?.crossFileRefs, architectOutput?.globalContext);
                            codeOutputs.push(...batchOutputs);
                            for (const output of batchOutputs) {
                                generatedSummaries.set(output.path, extractInterfaceSummary(output));
                            }
                        }
                        catch (batchErr) {
                            log.error(`batch ${bi + 1} failed`, batchErr.message);
                            yield {
                                type: 'executing',
                                phase: `batch ${bi + 1} failed: ${batchErr.message}`,
                                progress: 35 + Math.floor(bi * 30 / batches.length),
                            };
                            batchFailed = true;
                        }
                    }
                    if (batchFailed && codeOutputs.length === 0) {
                        codeErrors.push(`第${codeAttempt}轮: 所有 batch 均失败`);
                        continue;
                    }
                }
            }
            // ── 文件校验 ──
            yield { type: 'executing', phase: 'validating-files', progress: 50 };
            const planFilesFull = requirement.plan ?? [];
            const fileMap = new Map();
            for (const output of codeOutputs) {
                if (output.path)
                    fileMap.set(output.path, output);
            }
            const fullyGenerated = [];
            const fallbackOriginal = [];
            const criticalMissing = [];
            for (const planFile of planFilesFull) {
                if (fileMap.has(planFile.path)) {
                    fullyGenerated.push(planFile.path);
                    continue;
                }
                if (isCriticalFile(planFile.changeDescription)) {
                    criticalMissing.push(planFile.path);
                }
                else if (isSafeToFallback(planFile.path, planFile.changeDescription)) {
                    try {
                        const originalContent = await readFile(join(sandbox.path, planFile.path), 'utf-8');
                        fileMap.set(planFile.path, { path: planFile.path, content: originalContent, summary: `[WARNING] LLM 未返回该文件变更，保留原始内容` });
                        fallbackOriginal.push(planFile.path);
                    }
                    catch {
                        fileMap.set(planFile.path, { path: planFile.path, content: '', summary: planFile.changeDescription });
                        fallbackOriginal.push(planFile.path + ' (empty)');
                    }
                }
                else {
                    criticalMissing.push(planFile.path);
                }
            }
            const fileValidationSummary = {
                totalPlanFiles: planFilesFull.length,
                fullyGenerated,
                fallbackOriginal,
                noChangeDetected: [],
                criticalMissing,
            };
            finalFileValidationSummary = fileValidationSummary;
            yield { type: 'file-validation', summary: fileValidationSummary };
            if (criticalMissing.length > 0) {
                const err = `关键文件生成失败: ${criticalMissing.join(', ')}`;
                codeErrors.push(`第${codeAttempt}轮: ${err}`);
                yield { type: 'executing', phase: `critical-missing: ${criticalMissing.length} 个关键文件未返回`, progress: 52, warnings: criticalMissing };
                if (codeAttempt === MAX_RETRIES) {
                    yield { type: 'failed', requirement, error: `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`, userMessage: `关键代码文件生成失败：${criticalMissing.join(', ')}。` };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    return;
                }
                continue;
            }
            if (fallbackOriginal.length > 0) {
                yield { type: 'executing', phase: `warning: ${fallbackOriginal.length} 个文件保留原始内容`, progress: 55, warnings: fallbackOriginal };
            }
            // 孤立组件检测（仅警告，不阻断）
            // 注：此检测误报率高（route 文件、配置文件也会被误判为组件），暂时只记录不阻断
            const orphanResult = await this.checkOrphanComponents(planFilesFull, fileMap, sandbox.path);
            if (orphanResult.orphanFiles.length > 0) {
                log.warn(`孤立组件检测（仅警告）: ${orphanResult.orphanFiles.join(', ')}`);
                yield { type: 'executing', phase: `warning: ${orphanResult.orphanFiles.length} 个文件可能未被引用（仅警告）`, progress: 56, warnings: orphanResult.hints };
            }
            // 最终结果校验
            const validOutputs = Array.from(fileMap.values());
            if (validOutputs.length === 0) {
                codeErrors.push(`第${codeAttempt}轮: 编码阶段未生成有效文件`);
                if (codeAttempt === MAX_RETRIES) {
                    yield { type: 'failed', requirement, error: `编码失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`, userMessage: '代码生成失败。' };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    return;
                }
                continue;
            }
            // 清理残留 .orig 文件
            await this.cleanOrigFiles(sandbox.path);
            // 写入前备份 + 写入文件
            yield { type: 'executing', phase: 'writing-files', progress: 60 };
            for (const file of validOutputs) {
                const fullPath = join(sandbox.path, file.path);
                const origBackupPath = fullPath + '.orig';
                try {
                    const exists = await readFile(fullPath, 'utf-8');
                    await writeFile(origBackupPath, exists, 'utf-8');
                }
                catch {
                    await mkdir(dirname(origBackupPath), { recursive: true });
                    await writeFile(origBackupPath, '', 'utf-8');
                }
            }
            for (const file of validOutputs) {
                const fullPath = join(sandbox.path, file.path);
                if (file.content.trim() === '__DELETE__') {
                    try {
                        await rm(fullPath, { force: true });
                    }
                    catch { }
                }
                else if (file.content.startsWith('__APPEND__\n')) {
                    const appendContent = file.content.slice('__APPEND__\n'.length);
                    try {
                        const existing = await readFile(fullPath, 'utf-8');
                        await writeFile(fullPath, existing + '\n' + appendContent, 'utf-8');
                    }
                    catch {
                        await mkdir(dirname(fullPath), { recursive: true });
                        await writeFile(fullPath, appendContent, 'utf-8');
                    }
                }
                else {
                    await mkdir(dirname(fullPath), { recursive: true });
                    await writeFile(fullPath, file.content, 'utf-8');
                }
            }
            // Diff 空变更检测
            yield { type: 'executing', phase: 'diff-validation', progress: 62 };
            for (const file of validOutputs) {
                const origBackupPath = join(sandbox.path, file.path + '.orig');
                try {
                    const originalContent = await readFile(origBackupPath, 'utf-8');
                    const newContent = await readFile(join(sandbox.path, file.path), 'utf-8');
                    if (originalContent === newContent) {
                        fileValidationSummary.noChangeDetected.push(file.path);
                    }
                }
                catch { }
            }
            if (fileValidationSummary.noChangeDetected.length > 0) {
                if (fileValidationSummary.noChangeDetected.length === validOutputs.length) {
                    codeErrors.push(`第${codeAttempt}轮: 所有文件未产生变更`);
                    if (codeAttempt === MAX_RETRIES) {
                        yield { type: 'failed', requirement, error: `编码失败`, userMessage: '所有文件内容未变化。' };
                        requirement.status = 'failed';
                        await requirementMemory.saveRequirement(requirement);
                        return;
                    }
                    continue;
                }
            }
            previousOutputs = codeOutputs;
            // ── 硬阻断：结构性变更检测（标签替换、className 删除、export 删除、截断）──
            yield { type: 'executing', phase: 'diff-safety-check', progress: 65 };
            const diffChecker = new DiffSafetyChecker(sandbox.path, projectContext.semanticTags);
            const safetyIssues = [];
            for (const file of validOutputs) {
                if (file.content.startsWith('__APPEND__\n'))
                    continue; // CSS 追加模式跳过
                const origBackupPath = join(sandbox.path, file.path + '.orig');
                try {
                    const originalContent = await readFile(origBackupPath, 'utf-8');
                    const newContent = await readFile(join(sandbox.path, file.path), 'utf-8');
                    const result = await diffChecker.checkFile(file.path, originalContent, newContent);
                    if (!result.safe) {
                        safetyIssues.push(...result.details);
                    }
                }
                catch { }
            }
            if (safetyIssues.length > 0) {
                const issueText = safetyIssues.join('\n');
                codeErrors.push(`第${codeAttempt}轮: 检测到无关改动:\n${issueText}`);
                log.warn(`diff-safety-check 检测到 ${safetyIssues.length} 个问题`, issueText);
                yield {
                    type: 'executing',
                    phase: `diff-safety: ${safetyIssues.length} 个无关改动，回滚重试`,
                    progress: 65,
                    warnings: safetyIssues,
                };
                // 将具体问题反馈给下一轮 Coding Agent（从模板渲染）
                const diffSafetyFeedback = await promptManager.loadAndRender('shared/diff-safety-error', {
                    issues: issueText,
                });
                errorHintCombined = [
                    errorHintCombined || '',
                    '\n\n' + diffSafetyFeedback,
                ].filter(Boolean).join('');
                if (executor) {
                    await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => { });
                }
                if (codeAttempt === MAX_RETRIES) {
                    yield { type: 'failed', requirement, error: `编码失败 (${MAX_RETRIES}轮): 无关改动未消除:\n${codeErrors.join('\n')}`, userMessage: 'AI 生成的代码包含非预期修改，请尝试简化需求描述。' };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    return;
                }
                continue;
            }
            // ── 测试阶段 ──
            yield { type: 'status-change', status: 'testing', agent: 'test' };
            yield { type: 'executing', phase: `testing (attempt ${codeAttempt}/${MAX_RETRIES})`, progress: 70 };
            let testResult;
            try {
                testResult = await testRunner.run({ lint: commands.lint, test: commands.test, build: commands.build });
            }
            catch (testExecErr) {
                const errMsg = testExecErr?.message ?? String(testExecErr);
                const isDockerError = errMsg.includes('No such container') || errMsg.includes('daemon');
                codeErrors.push(`第${codeAttempt}轮测试执行异常: ${errMsg}`);
                log.error(`测试执行异常`, errMsg);
                yield { type: 'executing', phase: `test exec error: ${errMsg.slice(0, 100)}`, progress: 70, warnings: isDockerError ? ['Docker 容器异常，将重试'] : undefined };
                if (codeAttempt === MAX_RETRIES) {
                    yield { type: 'failed', requirement, error: `测试执行失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`, userMessage: '测试环境异常，请重试。' };
                    requirement.status = 'failed';
                    await requirementMemory.saveRequirement(requirement);
                    return;
                }
                continue;
            }
            yield { type: 'test-result', passed: testResult.passed, details: JSON.stringify(testResult, null, 2) };
            if (testResult.passed) {
                for (const lesson of pastLessons) {
                    await requirementMemory.markLessonResolved(lesson.id);
                }
                if (executor) {
                    try {
                        await executor('find . -name "*.orig" -delete', { timeout: 10_000 });
                    }
                    catch { }
                }
                break;
            }
            // 测试失败 → 构建增强错误上下文
            const errorOutput = testResult.steps.filter(s => !s.passed).map(s => `${s.name}: ${s.output}`).join('\n---\n');
            const errorFileContents = await extractAndReadErrorFiles(errorOutput, sandbox.path);
            let enhancedError = `第${codeAttempt}轮测试失败:\n${errorOutput.slice(0, 2000)}`;
            if (errorFileContents.length > 0) {
                enhancedError += '\n\n## 错误涉及的源码文件\n' + errorFileContents.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
            }
            codeErrors.push(enhancedError);
            if (executor) {
                await executor('git checkout . && git clean -fd', { timeout: 30_000 }).catch(() => { });
            }
            if (codeAttempt === MAX_RETRIES) {
                yield { type: 'failed', requirement, error: `编码+测试失败 (${MAX_RETRIES}轮):\n${codeErrors.join('\n')}`, userMessage: `代码测试未通过（已重试 ${MAX_RETRIES} 次）。` };
                requirement.status = 'failed';
                await requirementMemory.saveRequirement(requirement);
                return;
            }
        }
        // ── 测试通过 → Diff 准备 ──
        const validOutputs = codeOutputs.filter(f => f.path && f.content);
        if (typeof requirementMemory.saveChanges === 'function') {
            await requirementMemory.saveChanges(requirement.id, validOutputs.map(f => ({
                path: f.path,
                action: f.content.trim() === '__DELETE__' ? 'deleted' : 'created',
            })));
        }
        yield { type: 'executing', phase: 'diff-check', progress: 85 };
        const changedFiles = await repoManager.getChangedFiles();
        const expectedFiles = validOutputs.map(f => f.path);
        const diffResult = await repoManager.diffCheck(expectedFiles);
        if (diffResult.hasUnexpectedChanges) {
            yield { type: 'executing', phase: `unexpected changes: ${diffResult.unexpectedFiles?.join(', ')}`, progress: 85 };
        }
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
            diffCheck: diffResult,
            fileValidationSummary: finalFileValidationSummary ?? undefined,
        };
    }
    /**
     * 手术式 Patch 模式
     * 当全量重写反复触发 diff-safety 时，改用此模式
     * AI 只输出要插入/替换的具体行，系统做精确手术
     */
    async runPatchMode(llmClient, promptManager, planFile, originalContent, sandboxPath, projectContext, errorHint, detailedChange) {
        const systemPrompt = await promptManager.load('coding/patch-system');
        const lines = originalContent.split('\n');
        const numberedContent = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
        const userMessage = `## 文件: ${planFile.path}

## 改动要求
${detailedChange ?? planFile.changeDescription}

## 原文件内容（带行号）
\`\`\`
${numberedContent}
\`\`\`
${errorHint ? `\n${errorHint}` : ''}`;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ];
        const response = await llmClient.chat(messages, {
            tools: PATCH_TOOLS,
            agent: 'coding-patch',
            maxTokens: 4096,
        });
        let patchOps = [];
        if (response.toolCalls && response.toolCalls.length > 0) {
            const tc = response.toolCalls[0];
            if (tc.name === 'submit_patch' && tc.arguments?.operations) {
                patchOps = tc.arguments.operations;
            }
        }
        if (patchOps.length === 0) {
            log.warn(`patch 模式未返回有效操作: ${planFile.path}`);
            return null;
        }
        // 应用 patch 操作
        let resultLines = [...lines];
        let offset = 0; // 行号偏移（插入/删除导致的偏移）
        for (const op of patchOps) {
            if (op.type === 'append') {
                resultLines.push(...op.content.split('\n'));
            }
            else if (op.type === 'insert_after') {
                const insertPos = (op.line ?? resultLines.length) + offset;
                const newLines = op.content.split('\n');
                resultLines.splice(insertPos, 0, ...newLines);
                offset += newLines.length;
            }
            else if (op.type === 'replace_lines') {
                const start = (op.line ?? 1) + offset - 1;
                const end = (op.endLine ?? op.line ?? resultLines.length) + offset - 1;
                const newLines = op.content.split('\n');
                resultLines.splice(start, end - start + 1, ...newLines);
                offset += newLines.length - (end - start + 1);
            }
        }
        return {
            path: planFile.path,
            content: resultLines.join('\n'),
            summary: `[patch mode] ${planFile.changeDescription}`,
        };
    }
    /** 安全调用 runCodingBatch，捕获异常 */
    async runCodingBatchSafe(...args) {
        return runCodingBatch(...args);
    }
    async checkOrphanComponents(planFilesFull, fileMap, sandboxPath) {
        const COMPONENT_EXTS = /\.(jsx?|tsx|vue)$/;
        const STYLE_ASSET_EXTS = /\.(css|scss|less|svg|png|jpg|json)$/;
        const BARREL_EXTS = /\/index\.(jsx?|tsx|js|ts)$/;
        const generatedComponentFiles = planFilesFull.filter(f => {
            if (STYLE_ASSET_EXTS.test(f.path))
                return false;
            if (!COMPONENT_EXTS.test(f.path))
                return false;
            if (BARREL_EXTS.test(f.path))
                return false;
            return fileMap.has(f.path);
        });
        if (generatedComponentFiles.length === 0)
            return { orphanFiles: [], hints: [], error: '' };
        const projectFiles = new Map();
        try {
            const scanDir = async (dir) => {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build')
                        continue;
                    const fullPath = join(dir, e.name);
                    if (e.isDirectory()) {
                        await scanDir(fullPath);
                    }
                    else if (COMPONENT_EXTS.test(e.name) || /\.(js|ts)$/.test(e.name)) {
                        try {
                            const content = await readFile(fullPath, 'utf-8');
                            const relPath = fullPath.replace(sandboxPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
                            projectFiles.set(relPath, content);
                        }
                        catch { }
                    }
                }
            };
            await scanDir(join(sandboxPath, 'frontend/src'));
        }
        catch { }
        const orphanFiles = [];
        const orphanHints = [];
        for (const nf of generatedComponentFiles) {
            const baseName = nf.path.split('/').pop()?.replace(/\.(jsx?|tsx|vue)$/, '') ?? '';
            if (!baseName)
                continue;
            const importedByPlan = Array.from(fileMap.values()).some(other => {
                if (other.path === nf.path)
                    return false;
                if (BARREL_EXTS.test(other.path) || STYLE_ASSET_EXTS.test(other.path))
                    return false;
                return new RegExp(`from\\s+['"][^'"]*${baseName}['"]`).test(other.content) || other.content.includes(`import('${nf.path}')`);
            });
            if (importedByPlan)
                continue;
            const importedByExisting = Array.from(projectFiles.entries()).some(([path, content]) => {
                if (path === nf.path)
                    return false;
                if (BARREL_EXTS.test(path) || STYLE_ASSET_EXTS.test(path))
                    return false;
                return new RegExp(`from\\s+['"][^'"]*${baseName}['"]`).test(content) || content.includes(`import('${nf.path}')`);
            });
            if (importedByExisting)
                continue;
            orphanFiles.push(nf.path);
            orphanHints.push(`${nf.path} 未被任何文件 import，必须修改父组件来 import 并使用它`);
        }
        return { orphanFiles, hints: orphanHints, error: orphanFiles.length > 0 ? `组件孤立: ${orphanHints.join('\n')}` : '' };
    }
    async cleanOrigFiles(sandboxPath) {
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
            const oldOrigFiles = await walkDir(sandboxPath);
            for (const f of oldOrigFiles) {
                await unlink(f).catch(() => { });
            }
        }
        catch { }
    }
}
function isCriticalFile(changeDesc) {
    const CRITICAL_KEYWORDS = ['新增', 'add', 'Add', 'ADD', '修改', 'update', 'Update', 'UPDATE', '重构', 'refactor', 'Refactor', '删除', 'delete', 'Delete', 'DELETE', '实现', 'implement', 'Implement'];
    return CRITICAL_KEYWORDS.some(k => changeDesc.toLowerCase().includes(k.toLowerCase()));
}
function isSafeToFallback(filePath, changeDesc) {
    if (/\.md$|\.txt$|\.json$|\.yaml$|\.yml$/.test(filePath))
        return true;
    return ['参考', '查看', '阅读', 'refer', 'read', '了解', '分析', 'analyze'].some(k => changeDesc.toLowerCase().includes(k));
}
//# sourceMappingURL=coding-phase.js.map