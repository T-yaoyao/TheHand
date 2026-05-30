import type {
  Requirement,
  Conversation,
  Lesson,
  MemoryContext,
  ProjectContext,
} from '../types.js'

/**
 * 需求记忆：管理结构化需求 JSON 和对话历史
 * 对标 Claude Code 的 Session Memory
 */
export class RequirementMemory {
  private requirements: Map<string, Requirement> = new Map()
  private conversations: Map<string, Conversation[]> = new Map()
  private lessons: Map<string, Lesson[]> = new Map()

  async getRequirement(id: string): Promise<Requirement | null> {
    return this.requirements.get(id) ?? null
  }

  async saveRequirement(requirement: Requirement): Promise<void> {
    this.requirements.set(requirement.id, requirement)
  }

  async addConversation(conversation: Conversation): Promise<void> {
    const list = this.conversations.get(conversation.requirementId) ?? []
    list.push(conversation)
    this.conversations.set(conversation.requirementId, list)
  }

  async getRecentConversations(requirementId: string, limit: number = 3): Promise<Conversation[]> {
    const all = this.conversations.get(requirementId) ?? []
    return all.slice(-limit)
  }

  async saveLesson(lesson: Lesson): Promise<void> {
    const list = this.lessons.get(lesson.projectId) ?? []
    list.push(lesson)
    this.lessons.set(lesson.projectId, list)
  }

  async getLessons(projectId: string, phase?: string, limit: number = 5): Promise<Lesson[]> {
    const all = this.lessons.get(projectId) ?? []
    const filtered = phase ? all.filter(l => l.phase === phase && !l.resolved) : all.filter(l => !l.resolved)
    return filtered.slice(-limit)
  }

  async markLessonResolved(id: string): Promise<void> {
    for (const list of this.lessons.values()) {
      const lesson = list.find(l => l.id === id)
      if (lesson) {
        lesson.resolved = true
        break
      }
    }
  }

  /**
   * 获取给 LLM 的上下文
   * 不传全量对话历史，只传结构化需求 + 最近几轮
   */
  async getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext> {
    const requirement = this.requirements.get(requirementId)
    const recentConversations = await this.getRecentConversations(requirementId)
    const lessons = await this.getLessons(projectContext.id)

    return {
      structuredRequirement: requirement?.structuredRequirement ?? null,
      recentConversations,
      projectContext,
      lessons,
    }
  }

  /**
   * 上下文压缩（对标 Claude Code compaction）
   * 当对话过长时，用结构化需求 JSON 作为摘要
   */
  async compactIfNeeded(requirementId: string): Promise<void> {
    const conversations = this.conversations.get(requirementId) ?? []
    // 简单策略：只保留最近 10 轮
    if (conversations.length > 10) {
      this.conversations.set(requirementId, conversations.slice(-10))
    }
  }
}
