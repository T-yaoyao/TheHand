import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from './services/api'
import type { Requirement, Conversation, FilePlan } from './services/api'
import { useSSE } from './hooks/useSSE'
import { parseJsonField } from './utils/status'
import { Sidebar } from './components/Sidebar'
import { StatusFlow } from './components/StatusFlow'
import { StatusBadge } from './components/StatusBadge'
import { PlanView } from './components/PlanView'
import { StructuredView } from './components/StructuredView'
import './App.css'

type Tab = 'progress' | 'chat' | 'plan' | 'detail'

export function App() {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [selected, setSelected] = useState<Requirement | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [newInput, setNewInput] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<Tab>('progress')
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { events, connected, latestEvent, clearEvents } = useSSE(selected?.id ?? null)

  const showToast = useCallback((type: 'error' | 'success', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const list = await api.getRequirements()
      setRequirements(list)
      if (selected) {
        const updated = list.find((r) => r.id === selected.id)
        if (updated) setSelected(updated)
      }
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '加载失败')
    }
  }, [selected, showToast])

  useEffect(() => {
    refreshList()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected) {
      api.getConversations(selected.id).then(setConversations).catch(() => setConversations([]))
      clearEvents()
      setTab('progress')
    }
  }, [selected?.id, clearEvents])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations, tab])

  useEffect(() => {
    if (!latestEvent || !selected) return
    if (latestEvent.type === 'plan-ready') setTab('plan')
    if (latestEvent.type === 'waiting-for-pm') setTab('chat')
    if (
      latestEvent.type === 'status-change' ||
      latestEvent.type === 'completed' ||
      latestEvent.type === 'failed'
    ) {
      refreshList()
    }
  }, [latestEvent, selected, refreshList])

  const handleCreate = async () => {
    if (!newInput.trim()) return
    setLoading(true)
    try {
      const req = await api.createRequirement(newInput.trim())
      setRequirements((prev) => [req, ...prev])
      setSelected(req)
      setNewInput('')
      showToast('success', '需求已创建')
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!chatInput.trim() || !selected) return
    setLoading(true)
    try {
      await api.addConversation(selected.id, 'pm', chatInput.trim())
      const convs = await api.getConversations(selected.id)
      setConversations(convs)
      setChatInput('')
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '发送失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    if (!selected) return
    setRunning(true)
    clearEvents()
    try {
      setTab('progress')
      await api.runOrchestrator(selected.id)
      showToast('success', '流水线已在后端启动，请查看进度 Tab')
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '触发失败')
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !confirm('确定删除该需求？')) return
    try {
      await api.deleteRequirement(selected.id)
      setRequirements((prev) => prev.filter((r) => r.id !== selected.id))
      setSelected(null)
      showToast('success', '已删除')
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '删除失败')
    }
  }

  const plan = parseJsonField<FilePlan[]>(selected?.plan ?? null)
  const structured = parseJsonField<unknown>(selected?.structured_requirement ?? null)
  const livePlan = latestEvent?.type === 'plan-ready' ? latestEvent.plan : null

  return (
    <div className="app-layout">
      <Sidebar
        requirements={requirements}
        selectedId={selected?.id ?? null}
        newInput={newInput}
        loading={loading}
        onNewInputChange={setNewInput}
        onCreate={handleCreate}
        onSelect={setSelected}
        onRefresh={refreshList}
      />

      <main className="main">
        {!selected ? (
          <div className="main-empty">
            <h2>TheHand</h2>
            <p>用自然语言描述需求，自动完成澄清、方案、编码与测试。开发者在 GitHub 上 Review PR 即可。</p>
            <div className="features">
              <div className="feature-card">
                <strong>澄清</strong>
                <span>识别歧义，输出结构化需求</span>
              </div>
              <div className="feature-card">
                <strong>方案</strong>
                <span>定位文件，生成变更说明</span>
              </div>
              <div className="feature-card">
                <strong>交付</strong>
                <span>沙箱编码、lint、单测后提交</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="detail-header">
              <h2>{selected.pm_input}</h2>
              <div className="detail-actions">
                <StatusBadge status={selected.status} />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleRun}
                  disabled={running}
                >
                  {running ? '运行中…' : '▶ 运行流水线'}
                </button>
                <button type="button" className="btn-danger" onClick={handleDelete}>
                  删除
                </button>
              </div>
            </header>

            <div className="banner">
              点击「运行流水线」将在后端启动 Orchestrator（需配置根目录 <code>.env</code>）。
              请先打开本需求的「进度」Tab 以接收实时 SSE；也可使用{' '}
              <code>node cli-orchestrator.mjs</code> 在终端运行。
            </div>

            <nav className="tabs">
              {(
                [
                  ['progress', '进度'],
                  ['chat', '对话'],
                  ['plan', '方案'],
                  ['detail', '结构化需求'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`tab ${tab === key ? 'tab-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="tab-panel">
              {tab === 'progress' && (
                <StatusFlow
                  events={events}
                  latestEvent={latestEvent}
                  connected={connected}
                  requirementStatus={selected.status}
                />
              )}

              {tab === 'chat' && (
                <div className="messages">
                  {conversations.length === 0 ? (
                    <p className="empty-panel">暂无对话。澄清阶段的问题与回复将显示在这里。</p>
                  ) : (
                    conversations.map((conv) => (
                      <div
                        key={conv.id}
                        className={`message ${conv.role === 'pm' ? 'message-pm' : 'message-system'}`}
                      >
                        <div className="message-role">{conv.role === 'pm' ? 'PM' : '系统'}</div>
                        <div className="message-bubble">{conv.content}</div>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {tab === 'plan' && <PlanView plan={(livePlan as FilePlan[] | undefined) ?? plan} />}

              {tab === 'detail' && <StructuredView data={structured} />}
            </div>

            {tab === 'chat' && (
              <div className="chat-compose">
                <textarea
                  className="textarea"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="回复澄清问题…"
                  rows={2}
                />
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto', marginTop: 0 }}
                  onClick={handleSend}
                  disabled={loading || !chatInput.trim()}
                >
                  发送
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
