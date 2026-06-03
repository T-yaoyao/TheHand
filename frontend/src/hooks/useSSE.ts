import { useState, useEffect, useCallback, useRef } from 'react'

export interface OrchestratorEvent {
  type: string
  status?: string
  agent?: string
  phase?: string
  progress?: number
  requirement?: { status?: string; pmInput?: string; structuredRequirement?: unknown; plan?: unknown }
  plan?: { path: string; changeDescription: string; priority?: number }[]
  diff?: string
  screenshot?: string
  files?: { path: string; summary: string }[]
  questions?: string[]
  passed?: boolean
  details?: string
  error?: string
  userMessage?: string
  requirementId?: string
  projectId?: string
}

export function useSSE(requirementId: string | null) {
  const [events, setEvents] = useState<OrchestratorEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [latestEvent, setLatestEvent] = useState<OrchestratorEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const errorCountRef = useRef(0)
  const [reconnectKey, setReconnectKey] = useState(0)

  useEffect(() => {
    if (!requirementId) {
      setEvents([])
      setConnected(false)
      setLatestEvent(null)
      return
    }

    // 清理旧连接
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }

    errorCountRef.current = 0
    const source = new EventSource(`/api/events/${requirementId}`)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      errorCountRef.current = 0
    }

    source.onmessage = (e) => {
      try {
        const event: OrchestratorEvent = JSON.parse(e.data)
        if (event.type === 'connected') return
        setLatestEvent(event)
        setEvents((prev) => {
          const next = [...prev, event]
          return next.length > 500 ? next.slice(-250) : next
        })
      } catch {
        // heartbeat
      }
    }

    source.onerror = () => {
      setConnected(false)
      errorCountRef.current++
      // 连续错误超过 5 次，关闭连接（避免 404 无限重连）
      if (errorCountRef.current > 5) {
        source.close()
        sourceRef.current = null
      }
    }

    return () => {
      source.close()
      if (sourceRef.current === source) {
        sourceRef.current = null
      }
    }
  }, [requirementId, reconnectKey])

  const clearEvents = useCallback(() => {
    setEvents([])
    setLatestEvent(null)
  }, [])

  const reconnect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    errorCountRef.current = 0
    setReconnectKey((k) => k + 1)
  }, [])

  return { events, connected, latestEvent, clearEvents, reconnect }
}
