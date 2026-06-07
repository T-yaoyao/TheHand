import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { OrchestratorEvent } from '../hooks/useSSE'
import { statusLabel } from '../utils/status'

const PIPELINE = [
  { keys: ['clarifying', 'clarified', 'waiting-for-pm', 'needs-confirmation'], label: '澄清' },
  { keys: ['planning', 'plan-ready', 'plan-approved', 'plan-rejected'], label: '方案' },
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

/** 从事件流中取最近一次状态（executing 等事件常不带 requirement） */
function lastStatusChangeFromEvents(events: OrchestratorEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type === 'status-change' && ev.status) return ev.status
  }
  return null
}

/**
 * 根据 executing.phase 推断「逻辑阶段」，避免 latest 仅为 executing 时回退到过期的 requirementStatus（如仍为 plan-ready）。
 */
function inferStatusFromPhase(phase: string | undefined, eventType: string): string | null {
  if (!phase) {
    if (eventType === 'plan-ready') return 'plan-ready'
    if (eventType === 'diff-ready') return 'diff-ready'
    return null
  }
  const p = phase.toLowerCase()
  if (eventType !== 'executing') return null

  if (
    p.includes('architect') ||
    p.startsWith('coding') ||
    p.startsWith('skill:') ||
    p.includes('coding batch') ||
    p.includes('validating-files') ||
    p.includes('writing-files') ||
    p.includes('diff-validation') ||
    p.includes('file-validation') ||
    p.includes('no-change-detected') ||
    p.startsWith('warning:') ||
    p.includes('critical-missing') ||
    (p.includes('test failed') && p.includes('retrying coding')) ||
    (p.includes('reading ') && p.includes('error-related'))
  ) {
    return 'coding'
  }
  if (p.startsWith('testing')) return 'testing'
  if (p.includes('planning') || p.includes('plan retry') || p.includes('risk-assessment')) return 'planning'
  if (p.includes('enhanced-diff') || p.includes('diff-check') || p.includes('unexpected changes')) return 'testing'
  if (p.includes('committing') || p.includes('committed to sandbox') || p.includes('commit failed') || p.includes('applying')) {
    return 'diff-ready'
  }
  return null
}

function deriveStatus(
  latest: OrchestratorEvent | null,
  fallback: string,
  events: OrchestratorEvent[],
): string {
  if (!latest) return lastStatusChangeFromEvents(events) ?? fallback

  if (latest.type === 'failed') return 'failed'
  if (latest.type === 'completed') return 'done'
  if (latest.type === 'status-change' && latest.status) return latest.status

  if (latest.requirement?.status) return latest.requirement.status

  const fromPhase = inferStatusFromPhase(latest.phase, latest.type)
  if (fromPhase) return fromPhase

  if (latest.type === 'plan-ready') return 'plan-ready'
  if (latest.type === 'diff-ready') return 'diff-ready'

  const last = lastStatusChangeFromEvents(events)
  if (last) return last

  return fallback
}

function stepIndex(status: string): number {
  if (status === 'done') return PIPELINE.length - 1
  for (let i = 0; i < PIPELINE.length; i++) {
    if (PIPELINE[i].keys.includes(status)) return i
  }
  return -1
}

function lastActiveStepFromEvents(events: OrchestratorEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type === 'status-change' && ev.status) {
      const idx = stepIndex(ev.status)
      if (idx >= 0) return idx
    }
  }
  return -1
}

export function StatusFlow({ events, latestEvent, connected, requirementStatus, onReconnect }: StatusFlowProps) {
  const current = deriveStatus(latestEvent, requirementStatus, events)
  const isDone = current === 'done'
  const isFailed = latestEvent?.type === 'failed' || current === 'failed'
  const activeIdx = isFailed ? lastActiveStepFromEvents(events) : stepIndex(current)
  const progress = latestEvent?.progress ?? 0
  const phase = latestEvent?.phase ?? ''

  const pipelineRef = useRef<HTMLDivElement>(null)
  const prevActiveRef = useRef(activeIdx)

  // GSAP: animate pipeline nodes when active step changes
  useGSAP(() => {
    if (!pipelineRef.current) return
    const icons = pipelineRef.current.querySelectorAll('.pipeline-icon')

    if (activeIdx !== prevActiveRef.current && activeIdx >= 0) {
      const icon = icons[activeIdx]
      if (icon) {
        gsap.fromTo(icon,
          { scale: 0.8, autoAlpha: 0.5 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(1.7)' }
        )
      }
    }

    // On completion, animate all nodes sequentially
    if (isDone && prevActiveRef.current !== activeIdx) {
      gsap.timeline()
        .to(icons, {
          scale: 1.05,
          duration: 0.15,
          stagger: 0.08,
          ease: 'power1.out',
        })
        .to(icons, {
          scale: 1,
          duration: 0.2,
          stagger: 0.08,
          ease: 'power1.inOut',
        })
    }

    prevActiveRef.current = activeIdx
  }, { dependencies: [activeIdx, isDone], scope: pipelineRef })

  // Progress bar width
  const barWidth = isDone
    ? '100%'
    : isFailed && activeIdx >= 0
      ? `${((activeIdx + 1) / PIPELINE.length) * 100}%`
      : activeIdx >= 0
        ? '30%'
        : '0%'

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

      <div className="pipeline" ref={pipelineRef}>
        {PIPELINE.map((step, i) => {
          const done = isDone || (activeIdx >= 0 && i < activeIdx)
          const active = !isDone && !isFailed && i === activeIdx
          const failed = isFailed && i === activeIdx
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
          {isDone ? (
            <span className="muted">✅ 已完成</span>
          ) : isFailed ? (
            <span className="muted">❌ 已失败</span>
          ) : phase ? (
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
          className={`progress-fill ${activeIdx >= 0 && !progress && !isDone && !isFailed ? 'progress-animated' : ''}`}
          style={{ width: progress > 0 ? `${Math.min(progress, 100)}%` : barWidth }}
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
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)' }}>技术详情</summary>
              <pre style={{ fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{latestEvent.error}</pre>
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
