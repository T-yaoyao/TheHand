import { useState, useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { Requirement, MetricsSummary } from '../services/api'

interface DashboardProps {
  requirements: Requirement[]
  metrics?: MetricsSummary | null
}

export function Dashboard({ requirements, metrics }: DashboardProps) {
  const [showDashboard, setShowDashboard] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const stats = {
    total: requirements.length,
    idle: requirements.filter(r => r.status === 'idle').length,
    clarifying: requirements.filter(r => r.status === 'clarifying' || r.status === 'waiting-for-pm' || r.status === 'needs-confirmation').length,
    planning: requirements.filter(r => r.status === 'planning' || r.status === 'plan-ready').length,
    coding: requirements.filter(r => r.status === 'coding').length,
    testing: requirements.filter(r => r.status === 'testing').length,
    done: requirements.filter(r => r.status === 'done').length,
    failed: requirements.filter(r => r.status === 'failed').length,
  }

  const recentRequirements = requirements.slice(0, 5)

  // GSAP: animate dashboard content when expanded
  useGSAP(() => {
    if (!contentRef.current || !showDashboard) return
    const cards = contentRef.current.querySelectorAll('.stat-card, .metric-item, .recent-item')
    gsap.from(cards, {
      y: 12,
      autoAlpha: 0,
      duration: 0.35,
      stagger: 0.05,
      ease: 'power2.out',
    })
  }, { dependencies: [showDashboard], scope: contentRef })

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>需求仪表盘</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowDashboard(!showDashboard)}
        >
          {showDashboard ? '收起' : '展开仪表盘'}
        </button>
      </div>

      {showDashboard && (
        <div ref={contentRef}>
          <div className="stats-grid">
            <div className="stat-card stat-total">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">总需求</div>
            </div>
            <div className="stat-card stat-done">
              <div className="stat-value">{stats.done}</div>
              <div className="stat-label">已完成</div>
            </div>
            <div className="stat-card stat-running">
              <div className="stat-value">{stats.clarifying + stats.planning + stats.coding + stats.testing}</div>
              <div className="stat-label">进行中</div>
            </div>
            <div className="stat-card stat-failed">
              <div className="stat-value">{stats.failed}</div>
              <div className="stat-label">失败</div>
            </div>
          </div>

          {metrics && (
            <div className="metrics-section">
              <h3>系统指标</h3>
              <div className="metrics-grid">
                <div className="metric-item">
                  <span className="metric-label">成功率</span>
                  <span className="metric-value">{(metrics.successRate * 100).toFixed(1)}%</span>
                </div>
                <div className="metric-item">
                  <span className="metric-label">平均耗时</span>
                  <span className="metric-value">{Math.round(metrics.averageDurationMs / 1000)}s</span>
                </div>
                <div className="metric-item">
                  <span className="metric-label">总输入Token</span>
                  <span className="metric-value">{metrics.totalInputTokens.toLocaleString()}</span>
                </div>
                <div className="metric-item">
                  <span className="metric-label">预估总成本</span>
                  <span className="metric-value">¥{metrics.totalEstimatedCost.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="status-flow-visual">
            <h3>需求流转状态</h3>
            <div className="status-bars">
              <div className="status-bar-item">
                <div className="status-bar-label">待处理</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-idle" style={{ width: `${stats.total > 0 ? (stats.idle / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.idle}</span>
              </div>
              <div className="status-bar-item">
                <div className="status-bar-label">澄清中</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-clarifying" style={{ width: `${stats.total > 0 ? (stats.clarifying / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.clarifying}</span>
              </div>
              <div className="status-bar-item">
                <div className="status-bar-label">方案中</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-planning" style={{ width: `${stats.total > 0 ? (stats.planning / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.planning}</span>
              </div>
              <div className="status-bar-item">
                <div className="status-bar-label">编码中</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-coding" style={{ width: `${stats.total > 0 ? (stats.coding / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.coding}</span>
              </div>
              <div className="status-bar-item">
                <div className="status-bar-label">测试中</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-testing" style={{ width: `${stats.total > 0 ? (stats.testing / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.testing}</span>
              </div>
              <div className="status-bar-item">
                <div className="status-bar-label">已完成</div>
                <div className="status-bar">
                  <div className="status-bar-fill status-done" style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%` }} />
                </div>
                <span className="status-bar-count">{stats.done}</span>
              </div>
            </div>
          </div>

          <div className="recent-section">
            <h3>最近需求</h3>
            <div className="recent-list">
              {recentRequirements.map(r => (
                <div key={r.id} className="recent-item">
                  <span className="recent-text">{r.pm_input.slice(0, 40)}{r.pm_input.length > 40 ? '...' : ''}</span>
                  <span className={`recent-status status-${r.status}`}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
