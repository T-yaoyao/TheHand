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
        fontSize: 12,
        fontWeight: 500,
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {statusLabel(status)}
    </span>
  )
}
