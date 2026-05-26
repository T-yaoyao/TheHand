import { queryAll, queryOne, execute } from './db.js';
import { randomUUID } from 'crypto';
function rowToRequirement(row) {
    return {
        id: row.id,
        status: row.status,
        pmInput: row.pm_input,
        structuredRequirement: row.structured_requirement
            ? JSON.parse(row.structured_requirement)
            : null,
        plan: row.plan ? JSON.parse(row.plan) : null,
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
    async getContext(requirementId, projectContext) {
        const requirement = await this.getRequirement(requirementId);
        const recentConversations = await this.getRecentConversations(requirementId, 10);
        return {
            structuredRequirement: requirement?.structuredRequirement ?? null,
            recentConversations,
            projectContext,
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