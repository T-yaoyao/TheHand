import type { Requirement, Conversation, MemoryContext, ProjectContext } from '@thehand/core';
/**
 * 将 Orchestrator 的 RequirementMemory 接到 SQLite
 */
export declare class DbRequirementMemory {
    getRequirement(id: string): Promise<Requirement | null>;
    saveRequirement(requirement: Requirement): Promise<void>;
    addConversation(conversation: Conversation): Promise<void>;
    getRecentConversations(requirementId: string, limit?: number): Promise<Conversation[]>;
    getContext(requirementId: string, projectContext: ProjectContext): Promise<MemoryContext>;
    compactIfNeeded(_requirementId: string): Promise<void>;
}
export declare function loadRequirementFromDb(id: string): Requirement | null;
//# sourceMappingURL=db-requirement-memory.d.ts.map