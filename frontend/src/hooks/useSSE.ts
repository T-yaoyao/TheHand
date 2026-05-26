import { useState, useEffect, useCallback, useRef } from 'react'

export interface OrchestratorEvent {
  type: string
  status?: string
  agent?: string
  phase?: string
  progress?: number
  requirement?: any
  plan?: any[]
  questions?: string[]
  passed?: boolean
  details?: string
  error?: string
}

/**
 * SSE Hook — 订阅 Orchestrator 实时事件
 */
export function useSSE(requirementId: string | null) {
  const [events, setEvents] = useState<OrchestratorEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [latestEvent, setLatestEvent] = useState<OrchestratorEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!requirementId) {
      setEvents([])
      setConnected(false)
      setLatestEvent(null)
      return
    }

    const url = `/api/events/${requirementId}`
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
    }

    source.onmessage = (e) => {
      try {
        const event: OrchestratorEvent = JSON.parse(e.data)
        setLatestEvent(event)
        setEvents(prev => [...prev, event])
      } catch {
        // heartbeat 或非 JSON 数据，忽略
      }
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [requirementId])

  const clearEvents = useCallback(() => {
    setEvents([])
    setLatestEvent(null)
  }, [])

  return { events, connected, latestEvent, clearEvents }
}
