import { queryAll, queryOne, execute, executeBatch } from './db.js';
import { randomUUID } from 'crypto';
function rowToRequirement(row) {
    let structuredRequirement = null;
    let plan = null;
    if (row.structured_requirement) {
        try {
            structuredRequirement = JSON.parse(row.structured_requirement);
        }
        catch {
            structuredRequirement = null;
        }
    }
    if (row.plan) {
        try {
            plan = JSON.parse(row.plan);
        }
        catch {
            plan = null;
        }
    }
    return {
        id: row.id,
        status: row.status,
        pmInput: row.pm_input,
        structuredRequirement,
        plan,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
function rowToConversation(row) {
    return {
        id: row.id,
        requirementId: row.requirement_id,
        role: row.role,
        content: row.content,
        round: row.round,
        createdAt: new Date(row.created_at),
    };
}
function rowToLesson(row) {
    return {
        id: row.id,
        projectId: row.project_id,
        requirementId: row.requirement_id ?? null,
        phase: row.phase,
        filePath: row.file_path ?? null,
        errorSummary: row.error_summary,
        errorDetail: row.error_detail ?? null,
        fixHint: row.fix_hint ?? null,
        resolved: row.resolved === 1,
        createdAt: new Date(row.created_at),
    };
}
/**
 * 将 Orchestrator 的 RequirementMemory 接到 SQLite
 */
export class DbRequirementMemory {
    async getRequirement(id) {
        const row = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
        return row ? rowToRequirement(row) : null;
    }
    async saveRequirement(requirement) {
        const existing = queryOne('SELECT id FROM requirements WHERE id = ?', [requirement.id]);
        const structured = requirement.structuredRequirement
            ? JSON.stringify(requirement.structuredRequirement)
            : null;
        const plan = requirement.plan ? JSON.stringify(requirement.plan) : null;
        if (existing) {
            execute(`UPDATE requirements SET status = ?, structured_requirement = ?, plan = ?, updated_at = datetime('now') WHERE id = ?`, [requirement.status, structured, plan, requirement.id]);
        }
        else {
            execute(`INSERT INTO requirements (id, status, pm_input, structured_requirement, plan) VALUES (?, ?, ?, ?, ?)`, [requirement.id, requirement.status, requirement.pmInput, structured, plan]);
        }
    }
    async addConversation(conversation) {
        execute(`INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, ?, ?, ?)`, [
            conversation.id || randomUUID(),
            conversation.requirementId,
            conversation.role,
            conversation.content,
            conversation.round ?? 1,
        ]);
    }
    async getRecentConversations(requirementId, limit = 3) {
        const rows = queryAll(`SELECT * FROM conversations WHERE requirement_id = ? ORDER BY created_at DESC LIMIT ?`, [requirementId, limit]);
        return rows.map(rowToConversation).reverse();
    }
    async saveLesson(lesson) {
        execute(`INSERT INTO lessons (id, project_id, requirement_id, phase, file_path, error_summary, error_detail, fix_hint, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            lesson.id || randomUUID(),
            lesson.projectId,
            lesson.requirementId ?? null,
            lesson.phase,
            lesson.filePath,
            lesson.errorSummary,
            lesson.errorDetail,
            lesson.fixHint,
            lesson.resolved ? 1 : 0,
        ]);
    }
    async getLessons(projectId, phase, limit = 5) {
        const rows = phase
            ? queryAll(`SELECT * FROM lessons WHERE project_id = ? AND phase = ? AND resolved = 0 ORDER BY created_at DESC LIMIT ?`, [projectId, phase, limit])
            : queryAll(`SELECT * FROM lessons WHERE project_id = ? AND resolved = 0 ORDER BY created_at DESC LIMIT ?`, [projectId, limit]);
        return rows.map(rowToLesson);
    }
    async markLessonResolved(id) {
        execute(`UPDATE lessons SET resolved = 1 WHERE id = ?`, [id]);
    }
    async saveChanges(requirementId, files) {
        executeBatch(files.map(file => ({
            sql: `INSERT INTO change_history (id, requirement_id, file_path, action) VALUES (?, ?, ?, ?)`,
            params: [randomUUID(), requirementId, file.path, file.action],
        })));
    }
    async getChanges(requirementId) {
        const rows = queryAll(`SELECT * FROM change_history WHERE requirement_id = ? ORDER BY created_at ASC`, [requirementId]);
        return rows.map((row) => ({
            id: row.id,
            requirementId: row.requirement_id,
            filePath: row.file_path,
            action: row.action,
            createdAt: new Date(row.created_at),
        }));
    }
    async findChangesByEntity(keyword) {
        // 第一步：通过关键词找到相关的需求 ID（搜索需求描述）
        const matchedReqIds = queryAll(`SELECT DISTINCT r.id FROM requirements r
       WHERE r.pm_input LIKE '%' || ? || '%'
       ORDER BY r.created_at DESC
       LIMIT 10`, [keyword]).map((r) => r.id);
        if (matchedReqIds.length === 0)
            return [];
        // 第二步：用需求 ID 获取这些需求的所有变更文件（ID 追溯，不依赖路径匹配）
        const placeholders = matchedReqIds.map(() => '?').join(',');
        const rows = queryAll(`SELECT * FROM change_history WHERE requirement_id IN (${placeholders}) ORDER BY created_at ASC`, matchedReqIds);
        const grouped = new Map();
        for (const row of rows) {
            const reqId = row.requirement_id;
            if (!grouped.has(reqId))
                grouped.set(reqId, []);
            grouped.get(reqId).push({
                id: row.id,
                requirementId: reqId,
                filePath: row.file_path,
                action: row.action,
                createdAt: new Date(row.created_at),
            });
        }
        return Array.from(grouped.entries()).map(([requirementId, files]) => ({ requirementId, files }));
    }
    async getContext(requirementId, projectContext) {
        const requirement = await this.getRequirement(requirementId);
        const recentConversations = await this.getRecentConversations(requirementId, 10);
        const lessons = await this.getLessons(projectContext.id, undefined, 5);
        return {
            structuredRequirement: requirement?.structuredRequirement ?? null,
            recentConversations,
            projectContext,
            lessons,
        };
    }
    async compactIfNeeded(_requirementId) {
        // no-op for DB-backed memory
    }
}
export function loadRequirementFromDb(id) {
    const row = queryOne('SELECT * FROM requirements WHERE id = ?', [id]);
    return row ? rowToRequirement(row) : null;
}
//# sourceMappingURL=db-requirement-memory.js.map