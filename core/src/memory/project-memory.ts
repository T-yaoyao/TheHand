import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ProjectContext } from '../types.js'

/**
 * 项目记忆：加载和缓存项目上下文
 * 对标 Claude Code 的 Agent Memory (project scope)
 */
export class ProjectMemory {
  private cache: Map<string, ProjectContext> = new Map()

  constructor(private projectsDir: string = 'projects') {}

  /**
   * 加载项目上下文（带缓存）
   */
  async load(projectId: string): Promise<ProjectContext> {
    if (this.cache.has(projectId)) {
      return this.cache.get(projectId)!
    }

    const projectDir = join(this.projectsDir, projectId)

    const [projectConfig, models, routes] = await Promise.all([
      this.readJSON(join(projectDir, 'project.json')),
      this.readJSON(join(projectDir, 'context', 'models.json')),
      this.readJSON(join(projectDir, 'context', 'routes.json')),
    ])

    const context: ProjectContext = {
      id: projectId,
      name: projectConfig.name,
      techStack: projectConfig.techStack,
      structure: projectConfig.structure,
      commands: projectConfig.commands,
      models: models ?? {},
      routes: routes ?? {},
      constraints: projectConfig.constraints ?? {},
      keyFiles: projectConfig.keyFiles,
      thehand: projectConfig.thehand,
    }

    this.cache.set(projectId, context)
    return context
  }

  clearCache(projectId?: string): void {
    if (projectId) {
      this.cache.delete(projectId)
    } else {
      this.cache.clear()
    }
  }

  private async readJSON(path: string): Promise<any> {
    try {
      const content = await readFile(path, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }
}
