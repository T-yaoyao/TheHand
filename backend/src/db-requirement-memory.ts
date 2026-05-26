import type { Requirement, Conversation, MemoryContext, ProjectContext } from '@thehand/core'
import { queryAll, queryOne, execute } from './db.js'
import { randomUUID } from 'crypto'

function rowToRequirement(row: Record<string, unknown>): Requirement {
  return {
    id: row.id as string,
    status: row.status as Requirement['status'],
    pmInput: row.pm_input as string,
    structuredRequirement: row.structured_requirement
      ? JSON.parse(row.structured_requirement as string)
      : null,
    plan: row.plan ? JSON.parse(row.plan as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    requirementId: row.requirement_id as string,
    role: row.role as Conversation['role'],
    content: row.content as string,
    round: row.round as number,
    createdAt: new Date(row.created_at as string),
  }
}

/**
 * 将 Orchestrator 的 RequirementMemory 接到 SQLite
 */
export class DbRequirementMemory {
  async getRequirement(id: string): Promise<Requirement | null> {
    const row = queryOne('SELECT * FROM requirements WHERE id = ?', [id])
    return row ? rowToRequirement(row) : null
  }

  async saveRequirement(requirement: Requirement): Promise<void> {
    const existing = queryOne('SELECT id FROM requirements WHERE id = ?', [requirement.id])
    const structured = requirement.structuredRequirement
      ? JSON.stringify(requirement.structuredRequirement)
      : null
    const plan = requirement.plan ? JSON.stringify(requirement.plan) : null

    if (existing) {
      execute(
        `UPDATE requirements SET status = ?, structured_requirement = ?, plan = ?, updated_at = datetime('now') WHERE id = ?`,
        [requirement.status, structured, plan, requirement.id],
      )
    } else {
      execute(
        `INSERT INTO requirements (id, status, pm_input, structured_requirement, plan) VALUES (?, ?, ?, ?, ?)`,
        [requirement.id, requirement.status, requirement.pmInput, structured, plan],
      )
    }
  }

  async addConversation(conversation: Conversation): Promise<void> {
    execute(
      `INSERT INTO conversations (id, requirement_id, role, content, round) VALUES (?, ?, ?, ?, ?)`,
      [
        conversation.id || randomUUID(),
        conversation.requirementId,
        conversation.role,
        conversation.content,
        conversation.round ?? 1,
      ],
    )
  }

  async getRecentConversations(requirementId: string, limit = 3): Promise<Conversation[]> {
    const rows = queryAll(
      `SELECT * FROM conversations WHERE requirement_id = ? ORDER BY created_at DESC LIMIT ?`,
      [requirementId, limit],
    )
    return rows.map(rowToConversation).reverse()
  }

  async getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext> {
    const requirement = await this.getRequirement(requirementId)
    const recentConversations = await this.getRecentConversations(requirementId, 10)
    return {
      structuredRequirement: requirement?.structuredRequirement ?? null,
      recentConversations,
      projectContext,
    }
  }

  async compactIfNeeded(_requirementId: string): Promise<void> {
    // no-op for DB-backed memory
  }
}

export function loadRequirementFromDb(id: string): Requirement | null {
  const row = queryOne('SELECT * FROM requirements WHERE id = ?', [id])
  return row ? rowToRequirement(row) : null
}
