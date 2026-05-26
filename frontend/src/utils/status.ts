export const STATUS_LABELS: Record<string, string> = {
  idle: '待处理',
  clarifying: '澄清中',
  clarified: '已澄清',
  planning: '方案中',
  'plan-approved': '方案就绪',
  'plan-rejected': '方案驳回',
  coding: '编码中',
  testing: '测试中',
  done: '已完成',
  failed: '失败',
}

export const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  clarifying: '#5b8def',
  clarified: '#3dd68c',
  planning: '#5b8def',
  'plan-approved': '#3dd68c',
  'plan-rejected': '#f5a524',
  coding: '#a78bfa',
  testing: '#f5a524',
  done: '#3dd68c',
  failed: '#f2555a',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#6b7280'
}

export function parseJsonField<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
