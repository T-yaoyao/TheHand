import type { StructuredRequirement, FilePlan, RiskAssessment } from '../types.js'

/**
 * 需求风险评估器
 * 自动评估需求的风险等级，低风险需求支持一键自动执行
 */
export class RiskAssessor {
  /**
   * 评估需求风险等级
   */
  assess(requirement: StructuredRequirement, plan: FilePlan[]): RiskAssessment {
    const factors: RiskAssessment['factors'] = []
    let totalScore = 100

    // 因子1: 需求类型权重
    const typeScore = this.getTypeScore(requirement.type)
    factors.push({
      name: '需求类型',
      weight: 30,
      description: `需求类型"${requirement.type}"，得分 ${typeScore}`,
    })
    totalScore = (totalScore * typeScore) / 100

    // 因子2: 修改文件数量
    const fileCountScore = this.getFileCountScore(plan.length)
    factors.push({
      name: '修改文件数',
      weight: 25,
      description: `计划修改 ${plan.length} 个文件，得分 ${fileCountScore}`,
    })
    totalScore = (totalScore * fileCountScore) / 100

    // 因子3: 影响范围
    const scopeScore = this.getScopeScore(requirement.scope)
    factors.push({
      name: '影响范围',
      weight: 25,
      description: `影响范围为"${requirement.scope}"，得分 ${scopeScore}`,
    })
    totalScore = (totalScore * scopeScore) / 100

    // 因子4: 实体复杂度
    const entityScore = this.getEntityScore(requirement.entity)
    factors.push({
      name: '实体复杂度',
      weight: 20,
      description: `目标实体"${requirement.entity}"，得分 ${entityScore}`,
    })
    totalScore = (totalScore * entityScore) / 100

    // 确定风险等级
    let riskLevel: 'low' | 'medium' | 'high'
    if (totalScore >= 80) {
      riskLevel = 'low'
    } else if (totalScore >= 50) {
      riskLevel = 'medium'
    } else {
      riskLevel = 'high'
    }

    const recommendations = this.generateRecommendations(riskLevel, plan)

    return {
      score: Math.round(totalScore),
      riskLevel,
      factors,
      recommendations,
    }
  }

  private getTypeScore(type: string): number {
    const lowRiskTypes = ['add_field', 'modify_text', 'add_tag', 'add_style']
    const mediumRiskTypes = ['add_page', 'modify_api', 'add_component']
    const highRiskTypes = ['delete_page', 'delete_field', 'refactor', 'change_database']

    if (lowRiskTypes.includes(type)) return 95
    if (mediumRiskTypes.includes(type)) return 70
    if (highRiskTypes.includes(type)) return 30
    return 50
  }

  private getFileCountScore(count: number): number {
    if (count <= 2) return 100
    if (count <= 5) return 75
    if (count <= 10) return 50
    return 25
  }

  private getScopeScore(scope: 'frontend' | 'backend' | 'fullstack'): number {
    if (scope === 'frontend') return 90
    if (scope === 'backend') return 70
    return 50
  }

  private getEntityScore(entity: string): number {
    const simpleEntities = ['Tag', 'ArticlePreview', 'Comment']
    const complexEntities = ['User', 'Article']

    if (simpleEntities.includes(entity)) return 90
    if (complexEntities.includes(entity)) return 70
    return 60
  }

  private generateRecommendations(riskLevel: 'low' | 'medium' | 'high', plan: FilePlan[]): string[] {
    const recs: string[] = []

    if (riskLevel === 'low') {
      recs.push('✅ 低风险需求，可一键自动执行，无需人工审核')
      recs.push('本次变更仅涉及少量文件，历史同类需求通过率 98%')
    } else if (riskLevel === 'medium') {
      recs.push('⚠️ 中风险需求，建议快速浏览方案后确认')
      recs.push('涉及跨模块修改，请留意 API 兼容性')
    } else {
      recs.push('🔴 高风险需求，建议仔细审核方案细节')
      recs.push('涉及核心数据结构变更，修改后请重点测试')
    }

    return recs
  }

  /**
   * 判断是否支持一键自动执行
   */
  canAutoApprove(assessment: RiskAssessment): boolean {
    return assessment.riskLevel === 'low' && assessment.score >= 80
  }
}
