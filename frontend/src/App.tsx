import { useState, useEffect, useRef } from 'react'
import { api } from './services/api'
import type { Requirement, Conversation } from './services/api'
import { useSSE } from './hooks/useSSE'
import { StatusFlow } from './components/StatusFlow'

export function App() {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [selected, setSelected] = useState<Requirement | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // SSE 实时事件订阅
  const { events, connected, latestEvent, clearEvents } = useSSE(selected?.id ?? null)

  // 加载需求列表
  useEffect(() => {
    api.getRequirements().then(setRequirements)
  }, [])

  // 选中需求时加载对话
  useEffect(() => {
    if (selected) {
      api.getConversations(selected.id).then(setConversations)
    }
  }, [selected])

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations])

  // 创建新需求
  const handleCreate = async () => {
    if (!input.trim()) return
    setLoading(true)
    try {
      const req = await api.createRequirement(input.trim())
      setRequirements(prev => [req, ...prev])
      setSelected(req)
      setInput('')
    } finally {
      setLoading(false)
    }
  }

  // 发送对话消息
  const handleSend = async () => {
    if (!input.trim() || !selected) return
    setLoading(true)
    try {
      // 保存 PM 消息
      await api.addConversation(selected.id, 'pm', input.trim())
      const convs = await api.getConversations(selected.id)
      setConversations(convs)
      setInput('')

      // TODO: 后续接入 Orchestrator，这里先模拟系统回复
      await api.addConversation(selected.id, 'system', '（系统回复待接入 Orchestrator）')
      const updatedConvs = await api.getConversations(selected.id)
      setConversations(updatedConvs)
    } finally {
      setLoading(false)
    }
  }

  // 触发 Orchestrator
  const handleRunOrchestrator = async () => {
    if (!selected) return
    try {
      await fetch(`/api/orchestrator/run/${selected.id}`, { method: 'POST' })
    } catch (e) {
      console.error('触发 Orchestrator 失败:', e)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      selected ? handleSend() : handleCreate()
    }
  }

  return (
    <div style={styles.container}>
      {/* 左侧：需求列表 */}
      <div style={styles.sidebar}>
        <h2 style={styles.sidebarTitle}>TheHand</h2>
        <div style={styles.newReqSection}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入新需求..."
            style={styles.input}
            rows={3}
          />
          <button onClick={handleCreate} disabled={loading || !input.trim()} style={styles.button}>
            创建需求
          </button>
        </div>
        <div style={styles.list}>
          {requirements.map(req => (
            <div
              key={req.id}
              onClick={() => setSelected(req)}
              style={{
                ...styles.listItem,
                ...(selected?.id === req.id ? styles.listItemActive : {}),
              }}
            >
              <div style={styles.listItemTitle}>{req.pm_input.slice(0, 30)}</div>
              <div style={styles.listItemMeta}>
                <span style={styles.statusBadge}>{req.status}</span>
                <span>{new Date(req.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：对话区 */}
      <div style={styles.chat}>
        {selected ? (
          <>
            <div style={styles.chatHeader}>
              <h3 style={{ margin: 0 }}>{selected.pm_input}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={styles.statusBadge}>{selected.status}</span>
                <button onClick={handleRunOrchestrator} style={styles.runButton}>
                  运行
                </button>
              </div>
            </div>
            {/* 状态流可视化 */}
            <div style={styles.statusFlowContainer}>
              <StatusFlow events={events} latestEvent={latestEvent} connected={connected} />
            </div>
            <div style={styles.messages}>
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  style={{
                    ...styles.message,
                    ...(conv.role === 'pm' ? styles.messagePM : styles.messageSystem),
                  }}
                >
                  <div style={styles.messageRole}>{conv.role === 'pm' ? 'PM' : '系统'}</div>
                  <div style={styles.messageContent}>{conv.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={styles.chatInput}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="回复..."
                style={{ ...styles.input, flex: 1 }}
                rows={2}
              />
              <button onClick={handleSend} disabled={loading || !input.trim()} style={styles.button}>
                发送
              </button>
            </div>
          </>
        ) : (
          <div style={styles.empty}>
            <h2>TheHand</h2>
            <p>PM 需求交付平台 — 用自然语言描述需求，自动生成代码 PR</p>
            <p style={{ color: '#888' }}>← 左侧创建新需求开始</p>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  sidebar: {
    width: 320,
    borderRight: '1px solid #e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    background: '#fafafa',
  },
  sidebarTitle: {
    margin: 0,
    padding: '16px 16px 8px',
    fontSize: 20,
    fontWeight: 700,
  },
  newReqSection: {
    padding: '0 16px 12px',
    borderBottom: '1px solid #e0e0e0',
  },
  input: {
    width: '100%',
    padding: 8,
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    fontSize: 14,
    resize: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  button: {
    marginTop: 8,
    padding: '8px 16px',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  list: {
    flex: 1,
    overflow: 'auto',
  },
  listItem: {
    padding: '12px 16px',
    cursor: 'pointer',
    borderBottom: '1px solid #f0f0f0',
  },
  listItemActive: {
    background: '#e8f0fe',
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 4,
  },
  listItemMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#888',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 500,
    background: '#e0e0e0',
  },
  chat: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  chatHeader: {
    padding: '12px 20px',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 20,
  },
  message: {
    marginBottom: 16,
    maxWidth: '80%',
  },
  messagePM: {
    marginLeft: 'auto',
    textAlign: 'right',
  },
  messageSystem: {
    marginRight: 'auto',
  },
  messageRole: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  messageContent: {
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.5,
    background: '#f0f0f0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  chatInput: {
    padding: 16,
    borderTop: '1px solid #e0e0e0',
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  statusFlowContainer: {
    padding: '12px 20px',
    borderBottom: '1px solid #e0e0e0',
    background: '#f8f9fa',
  },
  runButton: {
    padding: '4px 12px',
    background: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#666',
  },
}
