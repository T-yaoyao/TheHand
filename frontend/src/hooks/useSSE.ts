import { useState, useEffect, useCallback, useRef } from 'react'

export interface OrchestratorEvent {
  type: string
  status?: string
  agent?: string
  phase?: string
  progress?: number
  requirement?: { status?: string; pmInput?: string; structuredRequirement?: unknown; plan?: unknown }
  plan?: { path: string; changeDescription: string; priority?: number }[]
  questions?: string[]
  passed?: boolean
  details?: string
  error?: string
  requirementId?: string
  projectId?: string
}

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

    const source = new EventSource(`/api/events/${requirementId}`)
    sourceRef.current = source

    source.onopen = () => setConnected(true)

    source.onmessage = (e) => {
      try {
        const event: OrchestratorEvent = JSON.parse(e.data)
        if (event.type === 'connected') return
        setLatestEvent(event)
        setEvents((prev) => [...prev, event])
      } catch {
        // heartbeat
      }
    }

    source.onerror = () => {
      setConnected(false)
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
