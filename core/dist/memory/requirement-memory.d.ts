import type { Requirement, Conversation, Lesson, MemoryContext, ProjectContext } from '../types.js';
/**
 * 需求记忆：管理结构化需求 JSON 和对话历史
 * 对标 Claude Code 的 Session Memory
 */
export declare class RequirementMemory {
    private requirements;
    private conversations;
    private lessons;
    getRequirement(id: string): Promise<Requirement | null>;
    saveRequirement(requirement: Requirement): Promise<void>;
    addConversation(conversation: Conversation): Promise<void>;
    getRecentConversations(requirementId: string, limit?: number): Promise<Conversation[]>;
    saveLesson(lesson: Lesson): Promise<void>;
    getLessons(projectId: string, phase?: string, limit?: number): Promise<Lesson[]>;
    markLessonResolved(id: string): Promise<void>;
    /**
     * 获取给 LLM 的上下文
     * 不传全量对话历史，只传结构化需求 + 最近几轮
     */
    getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext>;
    /**
     * 上下文压缩（对标 Claude Code compaction）
     * 当对话过长时，用结构化需求 JSON 作为摘要
     */
    compactIfNeeded(requirementId: string): Promise<void>;
}
//# sourceMappingURL=requirement-memory.d.ts.map