const BASE = '/api'

export interface Requirement {
  id: string
  status: string
  pm_input: string
  structured_requirement: string | null
  plan: string | null
  confidence_score?: number
  risk_level?: 'low' | 'medium' | 'high'
  natural_language_summary?: NaturalLanguageSummary | null
  trace_id?: string
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  requirement_id: string
  role: 'pm' | 'system'
  content: string
  round: number
  created_at: string
}

export interface FilePlan {
  path: string
  changeDescription: string
  priority: number
}

export interface RiskAssessment {
  score: number
  riskLevel: 'low' | 'medium' | 'high'
  factors: {
    name: string
    weight: number
    description: string
  }[]
  recommendations: string[]
}

export interface NaturalLanguageSummary {
  title: string
  description: string
  changes: string[]
  impact: string
}

export interface DiffCheckResult {
  hasUnexpectedChanges: boolean
  unexpectedFiles: string[]
  unrelatedChanges: {
    path: string
    lines: number[]
    description: string
  }[]
  warnings: string[]
  isSafe: boolean
}

export interface MetricsSummary {
  totalRequirements: number
  completedRequirements: number
  failedRequirements: number
  averageDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCost: number
  successRate: number
  agentPerformance: Record<string, {
    count: number
    successRate: number
    averageLatencyMs: number
  }>
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? '请求失败')
  }
  if (res.status === 204) return {} as T
  return res.json()
}

export const api = {
  async createRequirement(input: string): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    return handleResponse(res)
  },

  async getRequirements(): Promise<Requirement[]> {
    const res = await fetch(`${BASE}/requirements`)
    return handleResponse(res)
  },

  async getRequirement(id: string): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements/${id}`)
    return handleResponse(res)
  },

  async updateRequirement(id: string, data: Record<string, unknown>): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(res)
  },

  async deleteRequirement(id: string): Promise<void> {
    const res = await fetch(`${BASE}/requirements/${id}`, { method: 'DELETE' })
    await handleResponse(res)
  },

  async getConversations(requirementId: string): Promise<Conversation[]> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/conversations`)
    return handleResponse(res)
  },

  async addConversation(
    requirementId: string,
    role: string,
    content: string,
    round?: number,
  ): Promise<Conversation> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, ...(round !== undefined ? { round } : {}) }),
    })
    return handleResponse(res)
  },

  async runOrchestrator(requirementId: string, projectId = 'conduit'): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${BASE}/orchestrator/run/${requirementId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    return handleResponse(res)
  },

  async revertRequirement(requirementId: string): Promise<{ ok: boolean; revertedCommit: string }> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    return handleResponse(res)
  },

  async approvePlan(requirementId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/approve-plan`, { method: 'POST' })
    return handleResponse(res)
  },

  async rejectPlan(requirementId: string, reason?: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/reject-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    return handleResponse(res)
  },

  async commitChanges(requirementId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/commit`, { method: 'POST' })
    return handleResponse(res)
  },

  async rollbackChanges(requirementId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/rollback`, { method: 'POST' })
    return handleResponse(res)
  },

  async getMetrics(): Promise<MetricsSummary> {
    const res = await fetch(`${BASE}/orchestrator/metrics`)
    return handleResponse(res)
  },
}
