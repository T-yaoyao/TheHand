import type { ProjectContext } from '../types.js';
/**
 * 项目记忆：加载和缓存项目上下文
 * 对标 Claude Code 的 Agent Memory (project scope)
 */
export declare class ProjectMemory {
    private projectsDir;
    private cache;
    constructor(projectsDir?: string);
    /**
     * 加载项目上下文（带缓存）
     */
    load(projectId: string): Promise<ProjectContext>;
    clearCache(projectId?: string): void;
    private readJSON;
}
//# sourceMappingURL=project-memory.d.ts.map