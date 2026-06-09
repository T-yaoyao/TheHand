import { Router } from 'express';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { resolveSandboxRepoAbs } from '@thehand/core';
import { queryAll, queryOne, execute, executeBatch } from '../db.js';
import { isOrchestratorRunning, runOrchestratorForRequirement } from '../orchestrator-runner.js';
import { log } from '../logger.js';
import { pushBranchAndCreatePrToMain } from '../pr-submit.js';
function getSourceRepoRoot() {
    return resolveSandboxRepoAbs();
}
export const requirementsRouter = Router();
const VALID_STATUSES = ['idle', 'clarifying', 'clarified', 'waiting-for-pm', 'needs-confirmation', 'planning', 'plan-ready', 'plan-approved', 'plan-rejected', 'coding', 'testing', 'diff-ready', 'done', 'failed', 'reverted'];
/**
 * POST /api/requirements — 创建需求
 */
requirementsRouter.post('/', (req, res) => {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
        res.status(400).json({ error: '请提供需求描述' });
        return;
    }
    try {
        const id = randomUUID();
        execute(`INSERT INTO requirements (id, status, pm_input) VALUES (?, 'idle', ?)`, [id, input.trim()]);
        const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
        res.status(201).json(requirement);
    }
    catch (e) {
        res.status(500).json({ error: `创建需求失败: ${e.message}` });
    }
});
/**
 * GET /api/requirements — 获取所有需求
 */
requirementsRouter.get('/', (_req, res) => {
    const requirements = queryAll('SELECT * FROM requirements ORDER BY created_at DESC');
    res.json(requirements);
});
/**
 * GET /api/requirements/:id — 获取单个需求
 */
requirementsRouter.get('/:id', (req, res) => {
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [req.params.id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    res.json(requirement);
});
/**
 * PATCH /api/requirements/:id — 更新需求
 */
requirementsRouter.patch('/:id', (req, res) => {
    const { status, structuredRequirement, plan } = req.body;
    const id = req.params.id;
    const existing = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!existing) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    const updates = [];
    const params = [];
    if (status) {
        if (!VALID_STATUSES.includes(status)) {
            res.status(400).json({ error: `无效状态: ${status}，允许的值: ${VALID_STATUSES.join(', ')}` });
            return;
        }
        updates.push('status = ?');
        params.push(status);
    }
    if (structuredRequirement !== undefined) {
        updates.push('structured_requirement = ?');
        params.push(structuredRequirement === null ? null : (typeof structuredRequirement === 'string' ? structuredRequirement : JSON.stringify(structuredRequirement)));
    }
    if (plan !== undefined) {
        updates.push('plan = ?');
        params.push(plan === null ? null : (typeof plan === 'string' ? plan : JSON.stringify(plan)));
    }
    if (updates.length === 0) {
        res.status(400).json({ error: '没有需要更新的字段' });
        return;
    }
    updates.push("updated_at = datetime('now')");
    params.push(id);
    execute(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, params);
    const updated = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    res.json(updated);
});
/**
 * POST /api/requirements/:id/conversations — 添加对话
 */
requirementsRouter.post('/:id/conversations', (req, res) => {
    const { role, content, round } = req.body;
    const requirementId = req.params.id;
    if (!role || !content) {
        res.status(400).json({ error: '请提供 role 和 content' });
        return;
    }
    // 校验 requirement 是否存在
    const requirementExists = queryOne('SELECT id FROM requirements WHERE id = ?', [requirementId]);
    if (!requirementExists) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    const id = randomUUID();
    execute(`INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, ?, ?, ?)`, [id, requirementId, role, content.trim(), round ?? 1]);
    // PM 回复后，如果需求处于 clarifying 状态，自动重新触发流水线
    if (role === 'pm') {
        const requirement = queryOne('SELECT status FROM requirements WHERE id = ?', [requirementId]);
        if ((requirement?.status === 'waiting-for-pm' || requirement?.status === 'clarifying') && !isOrchestratorRunning(requirementId)) {
            log.info(`[api] PM 回复，自动重新触发 orchestrator id=${requirementId.slice(0, 8)}…`);
            runOrchestratorForRequirement(requirementId).catch((e) => {
                log.error('[orchestrator] 自动重触发异常:', e);
            });
        }
    }
    res.status(201).json({ id, requirement_id: requirementId, role, content, round: round ?? 1 });
});
/**
 * GET /api/requirements/:id/conversations — 获取对话
 */
requirementsRouter.get('/:id/conversations', (req, res) => {
    const conversations = queryAll('SELECT * FROM conversations WHERE requirement_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(conversations);
});
/**
 * DELETE /api/requirements/:id — 删除需求
 */
requirementsRouter.delete('/:id', (req, res) => {
    const id = req.params.id;
    // 正在运行的需求不能删除，否则 orchestrator 会把数据写回来
    if (isOrchestratorRunning(id)) {
        res.status(409).json({ error: '需求正在运行中，请等待完成或先停止流水线后再删除' });
        return;
    }
    try {
        executeBatch([
            { sql: 'DELETE FROM conversations WHERE requirement_id = ?', params: [id] },
            { sql: 'DELETE FROM executions WHERE requirement_id = ?', params: [id] },
            { sql: 'DELETE FROM change_history WHERE requirement_id = ?', params: [id] },
            { sql: 'DELETE FROM lessons WHERE requirement_id = ?', params: [id] },
            { sql: 'DELETE FROM requirements WHERE id = ?', params: [id] },
        ]);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: `删除失败: ${e.message}` });
    }
});
/**
 * POST /api/requirements/:id/revert — 撤回需求的代码变更
 */
requirementsRouter.post('/:id/revert', async (req, res) => {
    const id = req.params.id;
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'done') {
        res.status(400).json({ error: '只有已完成的需求可以撤回' });
        return;
    }
    try {
        // 通过 commit message 中的 [req:ID] 标记查找对应 commit
        // 使用 execFileSync 绕过 shell，避免 Windows cmd.exe 对 [ ] 的转义问题
        const reqMarker = `[req:${id.slice(0, 8)}]`;
        log.info(`[api] 搜索 commit marker: "${reqMarker}" in ${getSourceRepoRoot()}`);
        let logOutput;
        try {
            logOutput = execFileSync('git', [
                'log', '--oneline', '-20', '--fixed-strings', `--grep=${reqMarker}`,
            ], { cwd: getSourceRepoRoot(), timeout: 15_000 }).toString();
        }
        catch (gitErr) {
            // git log 在无匹配时返回 exit code 1，stdout 为空
            logOutput = gitErr.stdout?.toString() ?? '';
        }
        log.info(`[api] git log 结果: "${logOutput.trim().slice(0, 200)}"`);
        const commits = logOutput.trim().split('\n').filter(Boolean);
        if (commits.length === 0) {
            res.status(400).json({ error: '未找到可撤回的 git commit' });
            return;
        }
        // revert 最新的 commit
        const commitHash = commits[0].split(' ')[0];
        execFileSync('git', ['revert', '--no-edit', commitHash], { cwd: getSourceRepoRoot(), timeout: 30_000 });
        // 更新需求状态
        execute(`UPDATE requirements SET status = 'reverted', updated_at = datetime('now') WHERE id = ?`, [id]);
        log.info(`[api] 需求撤回 id=${id.slice(0, 8)}… commit=${commitHash}`);
        res.json({ ok: true, revertedCommit: commitHash });
    }
    catch (e) {
        log.error(`[api] 需求撤回失败 id=${id.slice(0, 8)}…`, e.message);
        res.status(500).json({ error: `撤回失败: ${e.message}` });
    }
});
/**
 * POST /api/requirements/:id/approve-plan — 确认方案，触发编码阶段
 */
requirementsRouter.post('/:id/approve-plan', async (req, res) => {
    const id = req.params.id;
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'plan-ready') {
        res.status(400).json({ error: `当前状态 ${requirement.status} 不可确认方案` });
        return;
    }
    log.info(`[api] 确认方案 id=${id.slice(0, 8)}…`);
    execute(`UPDATE requirements SET status = 'plan-approved', updated_at = datetime('now') WHERE id = ? AND status = 'plan-ready'`, [id]);
    const after = queryOne('SELECT status FROM requirements WHERE id = ?', [id]);
    if (after?.status !== 'plan-approved') {
        res.status(409).json({ error: '方案状态已变更或已被确认，请刷新页面' });
        return;
    }
    // 编排可能持续数分钟：勿阻塞 HTTP，前端依赖 SSE 更新进度
    void runOrchestratorForRequirement(id).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('[api] 确认方案后台编排失败:', msg);
    });
    res.json({ ok: true });
});
/**
 * POST /api/requirements/:id/reject-plan — 驳回方案
 */
requirementsRouter.post('/:id/reject-plan', (req, res) => {
    const id = req.params.id;
    const { reason } = req.body ?? {};
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'plan-ready') {
        res.status(400).json({ error: `当前状态 ${requirement.status} 不可驳回` });
        return;
    }
    execute(`UPDATE requirements SET status = 'plan-rejected', updated_at = datetime('now') WHERE id = ?`, [id]);
    if (reason) {
        execute(`INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, 'pm', ?, 0)`, [randomUUID(), id, `[驳回方案] ${reason}`]);
    }
    log.info(`[api] 驳回方案 id=${id.slice(0, 8)}…`);
    res.json({ ok: true });
});
/**
 * POST /api/requirements/:id/commit — 确认提交代码变更
 */
requirementsRouter.post('/:id/commit', async (req, res) => {
    const id = req.params.id;
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'diff-ready') {
        res.status(400).json({ error: `当前状态 ${requirement.status} 不可提交` });
        return;
    }
    log.info(`[api] 确认提交 id=${id.slice(0, 8)}…`);
    try {
        await runOrchestratorForRequirement(id);
    }
    catch (e) {
        if (e.message?.includes('正在运行中')) {
            res.status(409).json({ error: '该需求正在运行中' });
            return;
        }
        log.error('[api] 确认提交触发失败:', e.message);
        res.status(500).json({ error: `触发失败: ${e.message}` });
        return;
    }
    res.json({ ok: true });
});
/**
 * POST /api/requirements/:id/submit-pr — 提交完成后：选择是否创建指向 main 的 GitHub PR
 * Body: { "create": true | false }
 */
requirementsRouter.post('/:id/submit-pr', (req, res) => {
    const id = req.params.id;
    const create = req.body?.create === true;
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'done') {
        res.status(400).json({ error: `当前状态 ${requirement.status} 不可操作 PR（需已完成提交）` });
        return;
    }
    if (requirement.pr_url) {
        res.status(409).json({ error: '已创建过 PR', prUrl: requirement.pr_url });
        return;
    }
    if (requirement.pr_skipped === 1) {
        res.status(409).json({ error: '已选择跳过创建 PR' });
        return;
    }
    if (!create) {
        execute(`UPDATE requirements SET pr_skipped = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
        log.info(`[api] 跳过 PR id=${id.slice(0, 8)}…`);
        res.json({ ok: true, skipped: true });
        return;
    }
    const cwd = getSourceRepoRoot();
    try {
        const prUrl = pushBranchAndCreatePrToMain({
            cwd,
            requirementId: id,
            pmInput: requirement.pm_input ?? '',
        });
        execute(`UPDATE requirements SET pr_url = ?, updated_at = datetime('now') WHERE id = ?`, [prUrl, id]);
        log.info(`[api] 已创建 PR id=${id.slice(0, 8)}… url=${prUrl}`);
        res.json({ ok: true, prUrl });
    }
    catch (e) {
        const msg = e?.stderr?.toString?.() ?? e?.message ?? String(e);
        log.error(`[api] 创建 PR 失败 id=${id.slice(0, 8)}…`, msg);
        res.status(500).json({ error: `创建 PR 失败: ${msg}` });
    }
});
/**
 * POST /api/requirements/:id/rollback — 撤回沙箱中的代码变更
 */
requirementsRouter.post('/:id/rollback', (req, res) => {
    const id = req.params.id;
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    if (!requirement) {
        res.status(404).json({ error: '需求不存在' });
        return;
    }
    if (requirement.status !== 'diff-ready') {
        res.status(400).json({ error: `当前状态 ${requirement.status} 不可撤回` });
        return;
    }
    execute(`UPDATE requirements SET status = 'coding', updated_at = datetime('now') WHERE id = ?`, [id]);
    log.info(`[api] 撤回变更 id=${id.slice(0, 8)}…`);
    res.json({ ok: true });
});
//# sourceMappingURL=requirements.js.map