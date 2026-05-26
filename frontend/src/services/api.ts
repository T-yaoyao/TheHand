const BASE = '/api'

export interface Requirement {
  id: string
  status: string
  pm_input: string
  structured_requirement: string | null
  plan: string | null
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

export const api = {
  // 需求
  async createRequirement(input: string): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    return res.json()
  },

  async getRequirements(): Promise<Requirement[]> {
    const res = await fetch(`${BASE}/requirements`)
    return res.json()
  },

  async getRequirement(id: string): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements/${id}`)
    return res.json()
  },

  async updateRequirement(id: string, data: Partial<Requirement>): Promise<Requirement> {
    const res = await fetch(`${BASE}/requirements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  },

  async deleteRequirement(id: string): Promise<void> {
    await fetch(`${BASE}/requirements/${id}`, { method: 'DELETE' })
  },

  // 对话
  async getConversations(requirementId: string): Promise<Conversation[]> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/conversations`)
    return res.json()
  },

  async addConversation(requirementId: string, role: string, content: string): Promise<Conversation> {
    const res = await fetch(`${BASE}/requirements/${requirementId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content }),
    })
    return res.json()
  },
}
