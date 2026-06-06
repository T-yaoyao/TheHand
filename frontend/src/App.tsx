import { useState, useEffect, useRef, useCallback } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { api } from './services/api'
import type { Requirement, Conversation, FilePlan } from './services/api'
import { useSSE } from './hooks/useSSE'
import { parseJsonField } from './utils/status'
import { Sidebar } from './components/Sidebar'
import { StatusFlow } from './components/StatusFlow'
import { StatusBadge } from './components/StatusBadge'
import { PlanView } from './components/PlanView'
import './App.css'

type Tab = 'progress' | 'chat' | 'plan' | 'diff'

export function App() {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [selected, setSelected] = useState<Requirement | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [newInput, setNewInput] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [tab, setTab] = useState<Tab>('progress')
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<Requirement | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const suppressAutoPlanTabRef = useRef(false)
  const preferProgressTabAfterSelectRef = useRef(false)
  selectedRef.current = selected

  const [diffData, setDiffData] = useState<{ diff: string; files: { path: string; summary: string }[]; screenshot?: string } | null>(null)
  const [pendingApproval, setPendingApproval] = useState(false)

  const { events, connected, latestEvent, clearEvents, reconnect } = useSSE(selected?.id ?? null)

  // GSAP refs for animated sections
  const emptyRef = useRef<HTMLDivElement>(null)
  const toastRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  // GSAP: empty state entrance animation
  useGSAP(() => {
    if (!emptyRef.current || selected) return
    const title = emptyRef.current.querySelector('h2')
    const desc = emptyRef.current.querySelector('p')
    const features = emptyRef.current.querySelectorAll('.feature-card')
    const guide = emptyRef.current.querySelector('.empty-guide')

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
    if (title) tl.from(title, { y: 20, autoAlpha: 0, duration: 0.6 })
    if (desc) tl.from(desc, { y: 16, autoAlpha: 0, duration: 0.5 }, '-=0.3')
    if (features.length) tl.from(features, { y: 20, autoAlpha: 0, duration: 0.4, stagger: 0.1 }, '-=0.2')
    if (guide) tl.from(guide, { autoAlpha: 0, duration: 0.4 }, '-=0.1')
  }, { dependencies: [selected], scope: emptyRef })

  // GSAP: toast entrance/exit
  useEffect(() => {
    if (!toast || !toastRef.current) return
    gsap.fromTo(toastRef.current,
      { x: 40, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.35, ease: 'power2.out' }
    )
  }, [toast])

  // GSAP: modal entrance
  useEffect(() => {
    if (!confirmDialog || !modalRef.current) return
    gsap.from(modalRef.current, {
      scale: 0.9,
      autoAlpha: 0,
      duration: 0.3,
      ease: 'back.out(1.7)',
    })
  }, [confirmDialog])

  // GSAP: detail header entrance
  useGSAP(() => {
    if (!detailRef.current || !selected) return
    gsap.from(detailRef.current, {
      y: -10,
      autoAlpha: 0,
      duration: 0.4,
      ease: 'power2.out',
    })
  }, { dependencies: [selected?.id], scope: detailRef })

  // GSAP: new chat messages animate in
  useEffect(() => {
    if (!messagesRef.current || conversations.length === 0) return
    const messages = messagesRef.current.querySelectorAll('.message')
    const lastMsg = messages[messages.length - 1]
    if (lastMsg) {
      gsap.from(lastMsg, {
        y: 12,
        autoAlpha: 0,
        duration: 0.35,
        ease: 'power2.out',
      })
    }
  }, [conversations.length])

  const showToast = useCallback((type: 'error' | 'success', msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ type, msg })
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const list = await api.getRequirements()
      setRequirements(list)
      setLoadingList(false)
      setErrorBanner(null)
      const current = selectedRef.current
      if (current) {
        const updated = list.find((r) => r.id === current.id)
        if (updated && (updated.status !== current.status || updated.plan !== current.plan || updated.structured_requirement !== current.structured_requirement)) {
          setSelected(updated)
        }
      }
    } catch (e: unknown) {
      setLoadingList(false)
      setErrorBanner(e instanceof Error ? e.message : '后端服务不可用，请检查后端是否启动')
    }
  }, [])

  useEffect(() => {
    refreshList()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    suppressAutoPlanTabRef.current = false
    if (selected) {
      api.getConversations(selected.id).then(setConversations).catch(() => setConversations([]))
      clearEvents()
      setDiffData(null)
      if (preferProgressTabAfterSelectRef.current) {
        setTab('progress')
        preferProgressTabAfterSelectRef.current = false
      } else {
        setTab('chat')
      }
    }
  }, [selected?.id, clearEvents])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations, tab, thinking])

  useEffect(() => {
    if (!latestEvent || !selected) return
    if (latestEvent.type === 'orchestrator-started') {
      suppressAutoPlanTabRef.current = false
      setPendingApproval(false)
      setSelected(prev => prev && prev.id === latestEvent.requirementId ? { ...prev, status: 'clarifying' } : prev)
      setRequirements(prev => prev.map(r => r.id === latestEvent.requirementId ? { ...r, status: 'clarifying' } : r))
    }
    if (latestEvent.type === 'plan-ready') {
      setPendingApproval(true)
      refreshList()
      if (!suppressAutoPlanTabRef.current) {
        setTab('plan')
      }
    }
    if (latestEvent.type === 'diff-ready') {
      setPendingApproval(false)
      setTab('diff')
      setDiffData({
        diff: latestEvent.diff ?? '',
        files: latestEvent.files ?? [],
        screenshot: latestEvent.screenshot,
      })
      refreshList()
    }
    if (latestEvent.type === 'waiting-for-pm') {
      setTab('chat')
      setThinking(false)
      refreshList()
      api.getConversations(selected.id).then(setConversations).catch(() => {})
    }
    if (latestEvent.type === 'status-change') {
      refreshList()
      if (latestEvent.status === 'coding') {
        setTab('progress')
      }
      const terminalStatuses = ['done', 'failed', 'clarified', 'reverted']
      if (terminalStatuses.includes(latestEvent.status ?? '')) {
        setThinking(false)
      }
    }
    if (latestEvent.type === 'completed' || latestEvent.type === 'failed') {
      refreshList()
      setThinking(false)
      setPendingApproval(false)
      setTab('progress')
    }
  }, [latestEvent, selected?.id, refreshList])

  const handleCreate = async () => {
    if (!newInput.trim()) return
    setCreating(true)
    try {
      const req = await api.createRequirement(newInput.trim())
      preferProgressTabAfterSelectRef.current = true
      setRequirements((prev) => [req, ...prev])
      setSelected(req)
      setNewInput('')
      await doRun(req.id, { skipSuccessToast: true, silentErrorToast: true })
      showToast('success', '需求已提交，流水线已启动')
    } catch (e: unknown) {
      preferProgressTabAfterSelectRef.current = false
      showToast('error', e instanceof Error ? e.message : '创建或启动流水线失败')
    } finally {
      setCreating(false)
    }
  }

  const handleSend = async () => {
    if (!chatInput.trim() || !selected) return
    setSending(true)
    setThinking(true)
    try {
      await api.addConversation(selected.id, 'pm', chatInput.trim())
      const convs = await api.getConversations(selected.id)
      setConversations(convs)
      setChatInput('')
      refreshList()
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : '发送失败')
      setThinking(false)
    } finally {
      setSending(false)
    }
  }

  const doRun = async (id: string, opts?: { skipSuccessToast?: boolean; silentErrorToast?: boolean }) => {
    setConfirmDialog(null)
    setRunning(true)
    clearEvents()
    try {
      setTab('progress')
      await api.runOrchestrator(id)
      setSelected(prev => prev && prev.id === id ? { ...prev, status: 'clarifying' } : prev)
      setRequirements(prev => prev.map(r => r.id === id ? { ...r, status: 'clarifying' } : r))
      if (!opts?.skipSuccessToast) {
        showToast('success', '流水线已启动')
      }
    } catch (e: unknown) {
      if (!opts?.silentErrorToast) {
        showToast('error', e instanceof Error ? e.message : '触发失败')
      }
      throw e
    } finally {
      setRunning(false)
    }
  }

  const handleRun = async () => {
    if (!selected) return
    const id = selected.id
    if (selected.status === 'done' || selected.status === 'failed') {
      setConfirmDialog({
        message: `当前需求状态为"${selected.status === 'done' ? '已完成' : '已失败'}"，确定要重新运行？`,
        onConfirm: () => doRun(id),
      })
      return
    }
    doRun(id)
  }

  const handleDelete = async () => {
    if (!selected) return
    const id = selected.id
    const title = selected.pm_input.slice(0, 30)
    setConfirmDialog({
      message: `确定删除需求"${title}"…？`,
      onConfirm: async () => {
        setConfirmDialog(null)
        setDeleting(true)
        try {
          await api.deleteRequirement(id)
          setRequirements((prev) => prev.filter((r) => r.id !== id))
          setSelected(null)
          showToast('success', '已删除')
        } catch (e: unknown) {
          showToast('error', e instanceof Error ? e.message : '删除失败')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  const handleRevert = async () => {
    if (!selected) return
    const id = selected.id
    setConfirmDialog({
      message: '确定撤回该需求的代码变更？将执行 git revert 回退代码。',
      onConfirm: async () => {
        setConfirmDialog(null)
        setReverting(true)
        try {
          const result = await api.revertRequirement(id)
          showToast('success', `已撤回 commit ${result.revertedCommit}`)
          refreshList()
        } catch (e: unknown) {
          showToast('error', e instanceof Error ? e.message : '撤回失败')
        } finally {
          setReverting(false)
        }
      },
    })
  }

  const plan = parseJsonField<FilePlan[]>(selected?.plan ?? null)
  const livePlan = latestEvent?.type === 'plan-ready' ? latestEvent.plan : null

  const canReply = selected?.status === 'waiting-for-pm' || selected?.status === 'needs-confirmation'
  const isRunning = ['clarifying', 'clarified', 'planning', 'coding', 'testing', 'diff-ready', 'waiting-for-pm', 'needs-confirmation'].includes(selected?.status ?? '')
  const showRunButton = !isRunning || selected?.status === 'clarified' || selected?.status === 'plan-rejected'
  const runButtonText = running ? '运行中…' : (selected?.status === 'done' || selected?.status === 'failed') ? '重新运行' : '运行流水线'

  const filteredRequirements = searchQuery
    ? requirements.filter(r => r.pm_input.toLowerCase().includes(searchQuery.toLowerCase()))
    : requirements

  return (
    <div className="app-layout">
      <Sidebar
        requirements={filteredRequirements}
        selectedId={selected?.id ?? null}
        newInput={newInput}
        loading={creating}
        isOpen={sidebarOpen}
        onNewInputChange={setNewInput}
        onCreate={handleCreate}
        onSelect={(req) => { setSelected(req); setSidebarOpen(false) }}
        onRefresh={refreshList}
        onToggle={() => setSidebarOpen(false)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <button type="button" className="btn-ghost btn-icon sidebar-toggle" onClick={() => setSidebarOpen(true)} title="打开侧边栏">
          ☰
        </button>
        {errorBanner && (
          <div className="error-banner">
            {errorBanner}
            <button type="button" onClick={() => { setErrorBanner(null); refreshList() }}>重试</button>
          </div>
        )}

        {!selected ? (
          <div className="main-empty" ref={emptyRef}>
            <h2>TheHand</h2>
            <p>用自然语言描述需求，系统自动完成澄清、方案、编码与测试。开发者在 GitHub 上 Review PR 即可。</p>
            {loadingList ? (
              <div className="skeleton-list">
                <div className="skeleton-item" /><div className="skeleton-item" /><div className="skeleton-item" />
              </div>
            ) : (
              <>
                <div className="features">
                  <div className="feature-card">
                    <strong>澄清</strong>
                    <span>识别歧义，收敛可执行需求</span>
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
                {requirements.length === 0 && (
                  <p className="empty-guide">在左侧输入你的第一个需求，按 Enter 开始</p>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <header className="detail-header" ref={detailRef}>
              <h2>{selected.pm_input}</h2>
              <div className="detail-actions">
                <StatusBadge status={selected.status} />
                {showRunButton && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleRun}
                    disabled={running}
                  >
                    {runButtonText}
                  </button>
                )}
                <button type="button" className="btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '删除中…' : '删除'}
                </button>
                {selected.status === 'done' && (
                  <button type="button" className="btn-secondary" onClick={handleRevert} disabled={reverting}>
                    {reverting ? '撤回中…' : '撤回'}
                  </button>
                )}
              </div>
            </header>

            <div className="banner">
              提交需求后将自动开始流水线：澄清 → 方案 → 编码与测试。需要补充说明时可在「对话」中回复。
            </div>

            <nav className="tabs" role="tablist">
              {(
                [
                  ['progress', '进度'],
                  ['chat', '对话'],
                  ['plan', '方案'],
                  ['diff', '变更预览'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`tab ${tab === key ? 'tab-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {key === 'chat' && canReply && <span className="tab-badge">!</span>}
                </button>
              ))}
            </nav>

            {canReply && tab !== 'chat' && (
              <div className="reply-banner" onClick={() => setTab('chat')}>
                <span>💬 系统有追问需要你回复，</span>
                <strong>点击切换到「对话」tab →</strong>
              </div>
            )}

            <div className="tab-panel">
              {tab === 'progress' && (
                <StatusFlow
                  events={events}
                  latestEvent={latestEvent}
                  connected={connected}
                  requirementStatus={selected.status}
                  onReconnect={reconnect}
                />
              )}

              {tab === 'chat' && (
                <div className="messages" aria-live="polite" ref={messagesRef}>
                  {conversations.length === 0 && !thinking ? (
                    <p className="empty-panel">暂无对话。澄清阶段的问题与回复将显示在这里。</p>
                  ) : (
                    <>
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={`message ${conv.role === 'pm' ? 'message-pm' : 'message-system'}`}
                        >
                          <div className="message-header">
                            <span className="message-role">{conv.role === 'pm' ? 'PM' : '系统'}</span>
                            <span className="message-time">{new Date(conv.created_at).toLocaleTimeString()}</span>
                          </div>
                          <div className="message-bubble">{conv.content}</div>
                        </div>
                      ))}
                      {thinking && (
                        <div className="message message-system">
                          <div className="message-header">
                            <span className="message-role">系统</span>
                          </div>
                          <div className="message-bubble thinking">
                            <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
                            正在分析…
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {tab === 'plan' && (
                <div>
                  <PlanView plan={(livePlan as FilePlan[] | undefined) ?? plan} />
                  {pendingApproval && (
                    <div className="plan-actions">
                      <button type="button" className="btn-primary" onClick={async () => {
                        suppressAutoPlanTabRef.current = true
                        setRunning(true)
                        setThinking(true)
                        setPendingApproval(false)
                        setTab('progress')
                        try {
                          await api.approvePlan(selected.id)
                          showToast('success', '方案已确认，开始编码')
                          await refreshList()
                        } catch (e: unknown) {
                          suppressAutoPlanTabRef.current = false
                          setTab('plan')
                          setPendingApproval(true)
                          showToast('error', e instanceof Error ? e.message : '确认失败')
                          setThinking(false)
                        } finally {
                          setRunning(false)
                        }
                      }} disabled={running}>
                        {running ? '确认中…' : '确认方案'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={async () => {
                        setRunning(true)
                        setPendingApproval(false)
                        try {
                          await api.rejectPlan(selected.id)
                          showToast('success', '方案已驳回，请修改需求后重新运行')
                          refreshList()
                        } catch (e: unknown) {
                          setPendingApproval(true)
                          showToast('error', e instanceof Error ? e.message : '驳回失败')
                        } finally {
                          setRunning(false)
                        }
                      }} disabled={running}>
                        {running ? '驳回中…' : '驳回方案'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tab === 'diff' && (
                <div className="diff-panel">
                  {diffData ? (
                    <>
                      <div className="diff-header">
                        <h3>代码变更预览</h3>
                        <p>以下文件将被修改，请确认后提交或撤回。</p>
                        {diffData.files && (
                          <ul className="diff-file-list">
                            {diffData.files.map((f) => (
                              <li key={f.path}><code>{f.path}</code> — {f.summary}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {diffData.screenshot ? (
                        <div className="screenshot-preview">
                          <img src={`data:image/png;base64,${diffData.screenshot}`} alt="页面预览" />
                        </div>
                      ) : (
                        <pre className="diff-content"><code>{diffData.diff}</code></pre>
                      )}
                      <div className="plan-actions">
                        <button type="button" className="btn-primary" onClick={async () => {
                          setRunning(true)
                          setThinking(true)
                          try {
                            await api.commitChanges(selected.id)
                            showToast('success', '代码已提交，正在应用到源仓库')
                            refreshList()
                            setTab('progress')
                          } catch (e: unknown) {
                            showToast('error', e instanceof Error ? e.message : '提交失败')
                            setThinking(false)
                          } finally {
                            setRunning(false)
                          }
                        }} disabled={running}>
                          {running ? '提交中…' : '确认提交'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={async () => {
                          setRunning(true)
                          try {
                            await api.rollbackChanges(selected.id)
                            showToast('success', '已撤回变更')
                            refreshList()
                          } catch (e: unknown) {
                            showToast('error', e instanceof Error ? e.message : '撤回失败')
                          } finally {
                            setRunning(false)
                          }
                        }} disabled={running}>
                          {running ? '撤回中…' : '撤回变更'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="empty-panel">暂无变更预览。编码并测试通过后，变更内容将显示在此处。</p>
                  )}
                </div>
              )}
            </div>

            {tab === 'chat' && (
              <div className="chat-compose">
                {canReply ? (
                  <>
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
                      className="btn-primary chat-send-btn"
                      onClick={handleSend}
                      disabled={sending || !chatInput.trim()}
                    >
                      {sending ? '发送中…' : '发送'}
                    </button>
                  </>
                ) : (
                  <p className="chat-hint">
                    {isRunning ? '系统正在处理中，暂无需回复' : '当前阶段无需回复'}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {toast && (
        <div className={`toast toast-${toast.type}`} ref={toastRef}>
          {toast.msg}
        </div>
      )}

      {confirmDialog && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} ref={modalRef}>
            <p>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button type="button" className="btn-primary modal-confirm-btn" onClick={confirmDialog.onConfirm}>确定</button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
