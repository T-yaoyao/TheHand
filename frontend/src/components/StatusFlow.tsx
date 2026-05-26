import type { OrchestratorEvent } from '../hooks/useSSE'

interface StatusFlowProps {
  events: OrchestratorEvent[]
  latestEvent: OrchestratorEvent | null
  connected: boolean
}

const PIPELINE_STEPS = [
  { key: 'clarifying', label: '澄清', icon: '?' },
  { key: 'planning', label: '方案', icon: '>' },
  { key: 'coding', label: '编码', icon: '{}' },
  { key: 'testing', label: '测试', icon: '✓' },
  { key: 'done', label: '完成', icon: '✓' },
]

const STATUS_COLORS: Record<string, string> = {
  idle: '#9e9e9e',
  clarifying: '#2196f3',
  clarified: '#4caf50',
  planning: '#2196f3',
  'plan-approved': '#4caf50',
  coding: '#2196f3',
  testing: '#ff9800',
  done: '#4caf50',
  failed: '#f44336',
}

export function StatusFlow({ events, latestEvent, connected }: StatusFlowProps) {
  // 从事件中提取当前状态
  const currentStatus = latestEvent?.status ?? 'idle'
  const currentPhase = latestEvent?.phase ?? ''
  const currentProgress = latestEvent?.progress ?? 0

  // 计算步骤索引
  const stepIndex = PIPELINE_STEPS.findIndex(s => s.key === currentStatus)
  const isFailed = latestEvent?.type === 'failed'
  const isCompleted = latestEvent?.type === 'completed'

  return (
    <div style={styles.container}>
      {/* 连接状态 */}
      <div style={styles.header}>
        <span style={{ ...styles.dot, background: connected ? '#4caf50' : '#f44336' }} />
        <span style={styles.headerText}>{connected ? '实时连接' : '未连接'}</span>
      </div>

      {/* 流水线步骤 */}
      <div style={styles.steps}>
        {PIPELINE_STEPS.map((step, i) => {
          const isActive = i === stepIndex
          const isDone = i < stepIndex || isCompleted
          const color = isFailed && isActive
            ? STATUS_COLORS.failed
            : isDone
              ? STATUS_COLORS.done
              : isActive
                ? STATUS_COLORS[currentStatus] ?? '#2196f3'
                : '#e0e0e0'

          return (
            <div key={step.key} style={styles.step}>
              <div style={{ ...styles.stepIcon, background: color, color: 'white' }}>
                {isDone ? '✓' : step.icon}
              </div>
              <div style={{ ...styles.stepLabel, color: isActive || isDone ? '#333' : '#999' }}>
                {step.label}
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div style={{ ...styles.stepLine, background: isDone ? STATUS_COLORS.done : '#e0e0e0' }} />
              )}
            </div>
          )
        })}
      </div>

      {/* 当前阶段详情 */}
      {currentPhase && (
        <div style={styles.phase}>
          <span style={styles.phaseLabel}>当前阶段:</span>
          <span style={styles.phaseText}>{currentPhase}</span>
        </div>
      )}

      {/* 进度条 */}
      {currentProgress > 0 && (
        <div style={styles.progressContainer}>
          <div style={{ ...styles.progressBar, width: `${currentProgress}%` }} />
        </div>
      )}

      {/* 测试结果 */}
      {latestEvent?.type === 'test-result' && (
        <div style={{
          ...styles.testResult,
          background: latestEvent.passed ? '#e8f5e9' : '#ffebee',
          borderColor: latestEvent.passed ? '#4caf50' : '#f44336',
        }}>
          {latestEvent.passed ? '测试通过' : '测试失败'}
        </div>
      )}

      {/* 错误信息 */}
      {latestEvent?.type === 'failed' && (
        <div style={styles.error}>
          错误: {latestEvent.error}
        </div>
      )}

      {/* 完成信息 */}
      {latestEvent?.type === 'completed' && (
        <div style={styles.completed}>
          需求处理完成
        </div>
      )}

      {/* 事件日志 */}
      <div style={styles.log}>
        <div style={styles.logTitle}>事件日志</div>
        {events.slice(-10).map((event, i) => (
          <div key={i} style={styles.logEntry}>
            <span style={styles.logType}>{event.type}</span>
            {event.phase && <span style={styles.logPhase}>{event.phase}</span>}
            {event.status && <span style={styles.logStatus}>{event.status}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    background: '#fafafa',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
  },
  headerText: {
    fontSize: 12,
    color: '#666',
  },
  steps: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    position: 'relative',
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
    flex: 1,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: 500,
  },
  stepLine: {
    position: 'absolute',
    top: 16,
    left: '60%',
    right: '-40%',
    height: 2,
  },
  phase: {
    marginBottom: 8,
    fontSize: 13,
  },
  phaseLabel: {
    color: '#666',
    marginRight: 8,
  },
  phaseText: {
    color: '#333',
    fontWeight: 500,
  },
  progressContainer: {
    height: 4,
    background: '#e0e0e0',
    borderRadius: 2,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: '#2196f3',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  testResult: {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 12,
  },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#ffebee',
    color: '#c62828',
    fontSize: 13,
    marginBottom: 12,
  },
  completed: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 12,
  },
  log: {
    maxHeight: 150,
    overflow: 'auto',
    borderTop: '1px solid #e0e0e0',
    paddingTop: 8,
  },
  logTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#666',
    marginBottom: 4,
  },
  logEntry: {
    display: 'flex',
    gap: 8,
    fontSize: 11,
    padding: '2px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  logType: {
    fontWeight: 500,
    color: '#1a73e8',
    minWidth: 100,
  },
  logPhase: {
    color: '#666',
  },
  logStatus: {
    color: '#333',
    fontWeight: 500,
  },
}
