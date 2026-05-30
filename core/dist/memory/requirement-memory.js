/**
 * 需求记忆：管理结构化需求 JSON 和对话历史
 * 对标 Claude Code 的 Session Memory
 */
export class RequirementMemory {
    requirements = new Map();
    conversations = new Map();
    lessons = new Map();
    async getRequirement(id) {
        return this.requirements.get(id) ?? null;
    }
    async saveRequirement(requirement) {
        this.requirements.set(requirement.id, requirement);
    }
    async addConversation(conversation) {
        const list = this.conversations.get(conversation.requirementId) ?? [];
        list.push(conversation);
        this.conversations.set(conversation.requirementId, list);
    }
    async getRecentConversations(requirementId, limit = 3) {
        const all = this.conversations.get(requirementId) ?? [];
        return all.slice(-limit);
    }
    async saveLesson(lesson) {
        const list = this.lessons.get(lesson.projectId) ?? [];
        list.push(lesson);
        this.lessons.set(lesson.projectId, list);
    }
    async getLessons(projectId, phase, limit = 5) {
        const all = this.lessons.get(projectId) ?? [];
        const filtered = phase ? all.filter(l => l.phase === phase && !l.resolved) : all.filter(l => !l.resolved);
        return filtered.slice(-limit);
    }
    async markLessonResolved(id) {
        for (const list of this.lessons.values()) {
            const lesson = list.find(l => l.id === id);
            if (lesson) {
                lesson.resolved = true;
                break;
            }
        }
    }
    /**
     * 获取给 LLM 的上下文
     * 不传全量对话历史，只传结构化需求 + 最近几轮
     */
    async getContext(requirementId, projectContext) {
        const requirement = this.requirements.get(requirementId);
        const recentConversations = await this.getRecentConversations(requirementId);
        const lessons = await this.getLessons(projectContext.id);
        return {
            structuredRequirement: requirement?.structuredRequirement ?? null,
            recentConversations,
            projectContext,
            lessons,
        };
    }
    /**
     * 上下文压缩（对标 Claude Code compaction）
     * 当对话过长时，用结构化需求 JSON 作为摘要
     */
    async compactIfNeeded(requirementId) {
        const conversations = this.conversations.get(requirementId) ?? [];
        // 简单策略：只保留最近 10 轮
        if (conversations.length > 10) {
            this.conversations.set(requirementId, conversations.slice(-10));
        }
    }
}
//# sourceMappingURL=requirement-memory.js.map