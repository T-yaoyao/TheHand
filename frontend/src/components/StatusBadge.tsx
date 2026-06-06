import { statusColor, statusLabel } from '../utils/status'

export function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status)
  return (
    <span
      className="status-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: `${color}15`,
        color,
        border: `1px solid ${color}30`,
        letterSpacing: '0.02em',
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}80`,
          animation: status === 'clarifying' || status === 'coding' || status === 'testing'
            ? 'blink 2s ease-in-out infinite' : undefined,
        }}
      />
      {statusLabel(status)}
    </span>
  )
}
