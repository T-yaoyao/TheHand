import type { StructuredRequirement, FilePlan, NaturalLanguageSummary } from '../types.js'

/**
 * 自然语言变更摘要生成器
 * 将技术方案翻译成 PM 能完全理解的大白话
 */
export class NaturalSummaryGenerator {
  generate(requirement: StructuredRequirement, plan: FilePlan[]): NaturalLanguageSummary {
    const title = this.generateTitle(requirement)
    const description = this.generateDescription(requirement)
    const changes = this.generateChangesList(requirement, plan)
    const impact = this.generateImpact(requirement)

    return {
      title,
      description,
      changes,
      impact,
    }
  }

  private generateTitle(req: StructuredRequirement): string {
    const typeMap: Record<string, string> = {
      add_field: '新增字段',
      add_page: '新增页面',
      modify_api: '修改接口',
      delete_page: '删除页面',
      delete_field: '删除字段',
      modify_text: '修改文案',
      add_tag: '添加标签功能',
      add_style: '调整样式',
    }

    const typeText = typeMap[req.type] || req.type
    return `在「${req.entity}」模块${typeText}`
  }

  private generateDescription(req: StructuredRequirement): string {
    const parts: string[] = []

    if (req.type === 'add_field' && req.fields) {
      const fieldNames = req.fields.map(f => `${f.name}(${f.type})`).join('、')
      parts.push(`将为「${req.entity}」新增以下字段：${fieldNames}`)
    } else {
      parts.push(req.description)
    }

    const scopeMap: Record<string, string> = {
      frontend: '本次变更仅影响前端页面展示',
      backend: '本次变更仅影响后端接口逻辑',
      fullstack: '本次变更同时涉及前后端两层改动',
    }
    parts.push(scopeMap[req.scope])

    return parts.join('。')
  }

  private generateChangesList(req: StructuredRequirement, plan: FilePlan[]): string[] {
    const changes: string[] = []

    if (req.type === 'add_field' && req.fields) {
      req.fields.forEach(field => {
        changes.push(`📝 在「${req.entity}」数据模型中添加 ${field.name} 字段，类型为 ${field.type}`)
        changes.push(`🔌 后端 API 接口将返回该字段的数据`)
        changes.push(`🎨 前端页面将展示该字段的内容`)
      })
    } else {
      plan.forEach(p => {
        changes.push(`📄 ${p.changeDescription}`)
      })
    }

    return changes
  }

  private generateImpact(req: StructuredRequirement): string {
    if (req.scope === 'frontend') {
      return '✅ 不影响数据库结构和后端逻辑，可安全上线'
    }
    if (req.scope === 'backend') {
      return '⚠️ 后端接口变更，需确保前端调用方兼容'
    }
    return '⚠️ 全栈变更，建议完整测试相关页面和接口'
  }
}
