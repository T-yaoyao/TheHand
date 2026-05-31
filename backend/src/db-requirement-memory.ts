import type { Requirement, Conversation, Lesson, ChangeRecord, MemoryContext, ProjectContext } from '@thehand/core'
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

function rowToLesson(row: Record<string, unknown>): Lesson {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    phase: row.phase as string,
    filePath: (row.file_path as string) ?? null,
    errorSummary: row.error_summary as string,
    errorDetail: (row.error_detail as string) ?? null,
    fixHint: (row.fix_hint as string) ?? null,
    resolved: (row.resolved as number) === 1,
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

  async saveLesson(lesson: Lesson): Promise<void> {
    execute(
      `INSERT INTO lessons (id, project_id, phase, file_path, error_summary, error_detail, fix_hint, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lesson.id || randomUUID(),
        lesson.projectId,
        lesson.phase,
        lesson.filePath,
        lesson.errorSummary,
        lesson.errorDetail,
        lesson.fixHint,
        lesson.resolved ? 1 : 0,
      ],
    )
  }

  async getLessons(projectId: string, phase?: string, limit = 5): Promise<Lesson[]> {
    const rows = phase
      ? queryAll(
          `SELECT * FROM lessons WHERE project_id = ? AND phase = ? AND resolved = 0 ORDER BY created_at DESC LIMIT ?`,
          [projectId, phase, limit],
        )
      : queryAll(
          `SELECT * FROM lessons WHERE project_id = ? AND resolved = 0 ORDER BY created_at DESC LIMIT ?`,
          [projectId, limit],
        )
    return rows.map(rowToLesson)
  }

  async markLessonResolved(id: string): Promise<void> {
    execute(`UPDATE lessons SET resolved = 1 WHERE id = ?`, [id])
  }

  async saveChanges(requirementId: string, files: { path: string; action: 'created' | 'modified' | 'deleted' }[]): Promise<void> {
    for (const file of files) {
      execute(
        `INSERT INTO change_history (id, requirement_id, file_path, action) VALUES (?, ?, ?, ?)`,
        [randomUUID(), requirementId, file.path, file.action],
      )
    }
  }

  async getChanges(requirementId: string): Promise<ChangeRecord[]> {
    const rows = queryAll(
      `SELECT * FROM change_history WHERE requirement_id = ? ORDER BY created_at ASC`,
      [requirementId],
    )
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      requirementId: row.requirement_id as string,
      filePath: row.file_path as string,
      action: row.action as ChangeRecord['action'],
      createdAt: new Date(row.created_at as string),
    }))
  }

  async findChangesByEntity(keyword: string): Promise<{ requirementId: string; files: ChangeRecord[] }[]> {
    // 第一步：通过关键词找到相关的需求 ID（搜索需求描述）
    const matchedReqIds = queryAll(
      `SELECT DISTINCT r.id FROM requirements r
       WHERE r.pm_input LIKE '%' || ? || '%'
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [keyword],
    ).map((r: Record<string, unknown>) => r.id as string)

    if (matchedReqIds.length === 0) return []

    // 第二步：用需求 ID 获取这些需求的所有变更文件（ID 追溯，不依赖路径匹配）
    const placeholders = matchedReqIds.map(() => '?').join(',')
    const rows = queryAll(
      `SELECT * FROM change_history WHERE requirement_id IN (${placeholders}) ORDER BY created_at ASC`,
      matchedReqIds,
    )

    const grouped = new Map<string, ChangeRecord[]>()
    for (const row of rows) {
      const reqId = row.requirement_id as string
      if (!grouped.has(reqId)) grouped.set(reqId, [])
      grouped.get(reqId)!.push({
        id: row.id as string,
        requirementId: reqId,
        filePath: row.file_path as string,
        action: row.action as ChangeRecord['action'],
        createdAt: new Date(row.created_at as string),
      })
    }
    return Array.from(grouped.entries()).map(([requirementId, files]) => ({ requirementId, files }))
  }

  async getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext> {
    const requirement = await this.getRequirement(requirementId)
    const recentConversations = await this.getRecentConversations(requirementId, 10)
    const lessons = await this.getLessons(projectContext.id, undefined, 5)
    return {
      structuredRequirement: requirement?.structuredRequirement ?? null,
      recentConversations,
      projectContext,
      lessons,
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
