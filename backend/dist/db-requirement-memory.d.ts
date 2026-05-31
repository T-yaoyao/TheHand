import type { Requirement, Conversation, Lesson, ChangeRecord, MemoryContext, ProjectContext } from '@thehand/core';
/**
 * 将 Orchestrator 的 RequirementMemory 接到 SQLite
 */
export declare class DbRequirementMemory {
    getRequirement(id: string): Promise<Requirement | null>;
    saveRequirement(requirement: Requirement): Promise<void>;
    addConversation(conversation: Conversation): Promise<void>;
    getRecentConversations(requirementId: string, limit?: number): Promise<Conversation[]>;
    saveLesson(lesson: Lesson): Promise<void>;
    getLessons(projectId: string, phase?: string, limit?: number): Promise<Lesson[]>;
    markLessonResolved(id: string): Promise<void>;
    saveChanges(requirementId: string, files: {
        path: string;
        action: 'created' | 'modified' | 'deleted';
    }[]): Promise<void>;
    getChanges(requirementId: string): Promise<ChangeRecord[]>;
    findChangesByEntity(keyword: string): Promise<{
        requirementId: string;
        files: ChangeRecord[];
    }[]>;
    getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext>;
    compactIfNeeded(_requirementId: string): Promise<void>;
}
export declare function loadRequirementFromDb(id: string): Requirement | null;
//# sourceMappingURL=db-requirement-memory.d.ts.map