import { readFile } from 'fs/promises';
import { join } from 'path';
/**
 * 项目记忆：加载和缓存项目上下文
 * 对标 Claude Code 的 Agent Memory (project scope)
 */
export class ProjectMemory {
    projectsDir;
    cache = new Map();
    constructor(projectsDir = 'projects') {
        this.projectsDir = projectsDir;
    }
    /**
     * 加载项目上下文（带缓存）
     */
    async load(projectId) {
        if (this.cache.has(projectId)) {
            return this.cache.get(projectId);
        }
        const projectDir = join(this.projectsDir, projectId);
        const [projectConfig, models, routes] = await Promise.all([
            this.readJSON(join(projectDir, 'project.json')),
            this.readJSON(join(projectDir, 'context', 'models.json')),
            this.readJSON(join(projectDir, 'context', 'routes.json')),
        ]);
        const context = {
            id: projectId,
            name: projectConfig.name,
            techStack: projectConfig.techStack,
            structure: projectConfig.structure,
            commands: projectConfig.commands,
            models: models ?? {},
            routes: routes ?? {},
            constraints: projectConfig.constraints ?? {},
        };
        this.cache.set(projectId, context);
        return context;
    }
    clearCache(projectId) {
        if (projectId) {
            this.cache.delete(projectId);
        }
        else {
            this.cache.clear();
        }
    }
    async readJSON(path) {
        try {
            const content = await readFile(path, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=project-memory.js.map