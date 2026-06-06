import type { NaturalLanguageSummary, RiskAssessment } from '../services/api'

interface NaturalSummaryViewProps {
  summary?: NaturalLanguageSummary
  riskAssessment?: RiskAssessment
  canAutoApprove?: boolean
  onAutoApprove?: () => void
}

export function NaturalSummaryView({ summary, riskAssessment, canAutoApprove, onAutoApprove }: NaturalSummaryViewProps) {
  if (!summary) return null

  const riskLevelColors: Record<'low' | 'medium' | 'high', string> = {
    low: 'risk-low',
    medium: 'risk-medium',
    high: 'risk-high',
  }

  const riskLevelLabels: Record<'low' | 'medium' | 'high', string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  }

  return (
    <div className="natural-summary-card">
      <div className="summary-header">
        <h3>变更摘要</h3>
        {riskAssessment && (
          <div className={`risk-badge ${riskLevelColors[riskAssessment.riskLevel]}`}>
            {riskLevelLabels[riskAssessment.riskLevel]}
            <span className="risk-score">{riskAssessment.score}分</span>
          </div>
        )}
      </div>

      <div className="summary-title">
        <h4>{summary.title}</h4>
      </div>

      <div className="summary-description">
        <p>{summary.description}</p>
      </div>

      <div className="summary-changes">
        <h5>具体变更</h5>
        <ul>
          {summary.changes.map((change: string, idx: number) => (
            <li key={idx}>{change}</li>
          ))}
        </ul>
      </div>

      <div className="summary-impact">
        <div className="impact-banner">{summary.impact}</div>
      </div>

      {riskAssessment && riskAssessment.recommendations.length > 0 && (
        <div className="recommendations">
          <h5>系统建议</h5>
          <ul>
            {riskAssessment.recommendations.map((rec: string, idx: number) => (
              <li key={idx}>{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {canAutoApprove && onAutoApprove && (
        <div className="auto-approve-section">
          <button type="button" className="btn-primary btn-large" onClick={onAutoApprove}>
            一键自动执行（低风险，无需审核）
          </button>
        </div>
      )}
    </div>
  )
}
