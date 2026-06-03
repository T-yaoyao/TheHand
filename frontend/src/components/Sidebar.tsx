import type { Requirement } from '../services/api'
import { StatusBadge } from './StatusBadge'
import { formatTime } from '../utils/status'

interface SidebarProps {
  requirements: Requirement[]
  selectedId: string | null
  newInput: string
  loading: boolean
  isOpen: boolean
  onNewInputChange: (v: string) => void
  onCreate: () => void
  onSelect: (req: Requirement) => void
  onRefresh: () => void
  onToggle: () => void
  searchQuery: string
  onSearchChange: (v: string) => void
}

export function Sidebar({
  requirements,
  selectedId,
  newInput,
  loading,
  isOpen,
  onNewInputChange,
  onCreate,
  onSelect,
  onRefresh,
  onToggle,
  searchQuery,
  onSearchChange,
}: SidebarProps) {
  return (
    <aside className={`sidebar${isOpen ? ' open' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">✋</span>
          <div>
            <h1>TheHand</h1>
            <p>PM 需求交付</p>
          </div>
        </div>
        <div className="sidebar-header-actions">
          <button type="button" className="btn-ghost btn-icon" onClick={onRefresh} title="刷新列表">
            ↻
          </button>
          <button type="button" className="btn-ghost btn-icon sidebar-close" onClick={onToggle} title="关闭侧边栏">
            ✕
          </button>
        </div>
      </div>

      <div className="sidebar-compose">
        <label className="label">提交需求</label>
        <textarea
          className="textarea"
          value={newInput}
          onChange={(e) => onNewInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onCreate()
            }
          }}
          placeholder="用自然语言描述需求，例如：给文章详情页加阅读时长…"
          rows={4}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={onCreate}
          disabled={loading || !newInput.trim()}
        >
          {loading ? '提交中…' : '提交需求'}
        </button>
        <span className="hint">Ctrl+Enter 快速提交</span>
      </div>

      <div className="sidebar-list-header">
        <span>需求列表</span>
        <span className="count">{requirements.length}</span>
      </div>

      {requirements.length > 3 && (
        <div className="sidebar-search">
          <input
            type="text"
            className="search-input"
            placeholder="搜索需求…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}

      <div className="sidebar-list">
        {requirements.length === 0 ? (
          <p className="empty-hint">{searchQuery ? '无匹配需求' : '暂无需求，在上方创建'}</p>
        ) : (
          requirements.map((req) => (
            <button
              key={req.id}
              type="button"
              className={`req-card ${selectedId === req.id ? 'req-card-active' : ''}`}
              onClick={() => onSelect(req)}
            >
              <p className="req-card-title">{req.pm_input}</p>
              <div className="req-card-meta">
                <StatusBadge status={req.status} />
                <time>{formatTime(req.created_at)}</time>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
