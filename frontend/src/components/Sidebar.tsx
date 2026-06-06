import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
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
  const listRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(requirements.length)

  // Animate new items in the list
  useGSAP(() => {
    if (!listRef.current) return
    const cards = listRef.current.querySelectorAll('.req-card')
    if (cards.length > 0 && requirements.length > prevCountRef.current) {
      // Animate only the first (newest) card
      gsap.from(cards[0], {
        x: -20,
        opacity: 0,
        duration: 0.4,
        ease: 'power2.out',
      })
    }
    prevCountRef.current = requirements.length
  }, { dependencies: [requirements.length], scope: listRef })

  return (
    <aside className={`sidebar${isOpen ? ' open' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">✋</span>
          <div>
            <h1>TheHand</h1>
            <p>需求交付平台</p>
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
          placeholder="用自然语言描述需求…"
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
        <span className="hint">Ctrl + Enter 快速提交</span>
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

      <div className="sidebar-list" ref={listRef}>
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
