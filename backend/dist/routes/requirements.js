import { Router } from 'express';
import { randomUUID } from 'crypto';
import { queryAll, queryOne, execute } from '../db.js';
export const requirementsRouter = Router();
/**
 * POST /api/requirements — 创建需求
 */
requirementsRouter.post('/', (req, res) => {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
        res.status(400).json({ error: '请提供需求描述' });
        return;
    }
    const id = randomUUID();
    execute(`INSERT INTO requirements (id, status, pm_input) VALUES (?, 'idle', ?)`, [id, input.trim()]);
    const requirement = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    res.status(201).json(requirement);
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
        updates.push('status = ?');
        params.push(status);
    }
    if (structuredRequirement) {
        updates.push('structured_requirement = ?');
        params.push(JSON.stringify(structuredRequirement));
    }
    if (plan) {
        updates.push('plan = ?');
        params.push(JSON.stringify(plan));
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
    const id = randomUUID();
    execute(`INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, ?, ?, ?)`, [id, requirementId, role, content.trim(), round ?? 1]);
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
    execute('DELETE FROM conversations WHERE requirement_id = ?', [id]);
    execute('DELETE FROM executions WHERE requirement_id = ?', [id]);
    execute('DELETE FROM requirements WHERE id = ?', [id]);
    res.json({ ok: true });
});
//# sourceMappingURL=requirements.js.map