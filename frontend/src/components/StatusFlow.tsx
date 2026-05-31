import type { OrchestratorEvent } from '../hooks/useSSE'
import { statusLabel } from '../utils/status'

const PIPELINE = [
  { keys: ['clarifying', 'clarified'], label: '澄清' },
  { keys: ['planning', 'plan-approved', 'plan-rejected'], label: '方案' },
  { keys: ['coding'], label: '编码' },
  { keys: ['testing'], label: '测试' },
  { keys: ['diff-ready'], label: '确认' },
  { keys: ['done', 'reverted'], label: '完成' },
]

interface StatusFlowProps {
  events: OrchestratorEvent[]
  latestEvent: OrchestratorEvent | null
  connected: boolean
  requirementStatus: string
  onReconnect?: () => void
}

function deriveStatus(latest: OrchestratorEvent | null, fallback: string): string {
  if (!latest) return fallback
  if (latest.type === 'failed') return 'failed'
  if (latest.type === 'completed') return 'done'
  if (latest.type === 'status-change' && latest.status) return latest.status
  if (latest.requirement?.status) return latest.requirement.status
  return fallback
}

function stepIndex(status: string): number {
  if (status === 'failed') return -1
  if (status === 'done') return PIPELINE.length
  for (let i = 0; i < PIPELINE.length; i++) {
    if (PIPELINE[i].keys.includes(status)) return i
  }
  if (status === 'idle') return -1
  return -1
}

export function StatusFlow({ events, latestEvent, connected, requirementStatus, onReconnect }: StatusFlowProps) {
  const current = deriveStatus(latestEvent, requirementStatus)
  const activeIdx = stepIndex(current)
  const isFailed = latestEvent?.type === 'failed' || current === 'failed'
  const progress = latestEvent?.progress ?? 0
  const phase = latestEvent?.phase ?? ''

  return (
    <div className="status-flow">
      <div className="status-flow-top">
        <span className={`conn-dot ${connected ? 'conn-on' : ''}`} />
        <span className="conn-text">{connected ? 'SSE 已连接' : 'SSE 未连接'}</span>
        {!connected && onReconnect && (
          <button type="button" className="btn-ghost btn-sm" onClick={onReconnect}>
            重新连接
          </button>
        )}
      </div>

      <div className="pipeline">
        {PIPELINE.map((step, i) => {
          const done = activeIdx >= 0 && i < activeIdx
          const active = i === activeIdx
          const failed = isFailed && active
          return (
            <div key={step.label} className="pipeline-step">
              <div
                className={`pipeline-icon ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''} ${active && !failed ? 'pulse' : ''}`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className={`pipeline-label ${active || done ? 'on' : ''}`}>{step.label}</span>
              {i < PIPELINE.length - 1 && <div className={`pipeline-line ${done ? 'done' : ''}`} />}
            </div>
          )
        })}
      </div>

      {(phase || activeIdx >= 0) && (
        <div className="phase-row">
          {phase ? (
            <>
              <span className="muted">当前</span>
              <code>{phase}</code>
              {progress > 0 && <span className="muted">{progress}%</span>}
            </>
          ) : (
            <span className="muted">处理中…</span>
          )}
        </div>
      )}

      <div className="progress-track">
        <div
          className={`progress-fill ${activeIdx >= 0 && !progress ? 'progress-animated' : ''}`}
          style={{ width: progress > 0 ? `${Math.min(progress, 100)}%` : activeIdx >= 0 ? '30%' : '0%' }}
        />
      </div>

      {latestEvent?.type === 'plan-ready' && latestEvent.plan && (
        <div className="alert alert-info">
          <strong>方案就绪</strong> — 请前往「方案」Tab 审批
          <ul>
            {latestEvent.plan.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code> — {f.changeDescription}
              </li>
            ))}
          </ul>
        </div>
      )}

      {latestEvent?.type === 'diff-ready' && (
        <div className="alert alert-info">
          <strong>代码变更就绪</strong> — 请前往「变更预览」Tab 确认提交
        </div>
      )}

      {latestEvent?.type === 'test-result' && (
        <div className={`alert ${latestEvent.passed ? 'alert-success' : 'alert-error'}`}>
          {latestEvent.passed ? '测试通过' : '测试失败'}
        </div>
      )}

      {latestEvent?.type === 'failed' && (
        <div className="alert alert-error">
          <strong>失败</strong>
          <p>{latestEvent.userMessage ?? latestEvent.error}</p>
          {latestEvent.userMessage && latestEvent.error && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>技术详情</summary>
              <pre style={{ fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap' }}>{latestEvent.error}</pre>
            </details>
          )}
        </div>
      )}

      {latestEvent?.type === 'completed' && (
        <div className="alert alert-success">
          <strong>需求已完成</strong>
        </div>
      )}

      {events.length > 0 && (
        <details className="event-log">
          <summary>调试日志（开发者）</summary>
          <div className="event-log-list">
            {[...events].reverse().slice(0, 20).map((ev, i) => (
              <div key={i} className="event-log-item">
                <span className="event-type">{ev.type}</span>
                {ev.status && <span>{statusLabel(ev.status)}</span>}
                {ev.phase && <span className="muted">{ev.phase}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
