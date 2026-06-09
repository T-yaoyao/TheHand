import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import type { LlmUsageRecord } from '@thehand/core'

const DEFAULT_MAX_LINES = 800

export function getLlmObservabilityPath(): string {
  return process.env.THEHAND_LLM_OBSERVABILITY_PATH?.trim() || resolve(process.cwd(), '..', 'data', 'llm-calls.jsonl')
}

export function appendLlmUsageRecord(record: LlmUsageRecord): void {
  const path = getLlmObservabilityPath()
  mkdirSync(dirname(path), { recursive: true })
  const line = JSON.stringify({
    id: record.id,
    agent: record.agent,
    model: record.model,
    requirementId: record.requirementId,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    latencyMs: record.latencyMs,
    costCny: record.costCny,
    finishReason: record.finishReason,
    timestamp: record.timestamp.toISOString(),
  })
  appendFileSync(path, `${line}\n`, 'utf-8')
}

export interface LlmUsageRow {
  id: string
  agent: string
  model: string
  requirementId: string | null
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costCny: number
  finishReason: string
  timestamp: string
}

export interface LlmUsageSummary {
  calls: number
  inputTokens: number
  outputTokens: number
  totalCostCny: number
  avgLatencyMs: number
  byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number; costCny: number; avgLatencyMs: number }>
}

export function parseLlmUsageRows(text: string, maxLines = DEFAULT_MAX_LINES): LlmUsageRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const slice = lines.length > maxLines ? lines.slice(-maxLines) : lines
  const out: LlmUsageRow[] = []
  for (const line of slice) {
    try {
      const o = JSON.parse(line) as LlmUsageRow
      if (typeof o.id === 'string' && typeof o.agent === 'string' && typeof o.timestamp === 'string') {
        out.push({
          id: o.id,
          agent: o.agent,
          model: typeof o.model === 'string' ? o.model : '',
          requirementId: o.requirementId ?? null,
          inputTokens: Number(o.inputTokens) || 0,
          outputTokens: Number(o.outputTokens) || 0,
          latencyMs: Number(o.latencyMs) || 0,
          costCny: Number(o.costCny) || 0,
          finishReason: typeof o.finishReason === 'string' ? o.finishReason : '',
          timestamp: o.timestamp,
        })
      }
    } catch {
      // 跳过损坏行
    }
  }
  return out
}

export function summarizeLlmUsageRows(rows: LlmUsageRow[]): LlmUsageSummary {
  const acc: Record<string, { calls: number; inputTokens: number; outputTokens: number; costCny: number; totalLatency: number }> = {}
  let inputTokens = 0
  let outputTokens = 0
  let totalLatency = 0
  let totalCost = 0

  for (const r of rows) {
    inputTokens += r.inputTokens
    outputTokens += r.outputTokens
    totalLatency += r.latencyMs
    totalCost += r.costCny
    const g = acc[r.agent] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costCny: 0, totalLatency: 0 }
    g.calls += 1
    g.inputTokens += r.inputTokens
    g.outputTokens += r.outputTokens
    g.costCny += r.costCny
    g.totalLatency += r.latencyMs
    acc[r.agent] = g
  }

  const calls = rows.length
  const byAgent: LlmUsageSummary['byAgent'] = {}
  for (const [agent, g] of Object.entries(acc)) {
    byAgent[agent] = {
      calls: g.calls,
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
      costCny: g.costCny,
      avgLatencyMs: g.calls > 0 ? Math.round(g.totalLatency / g.calls) : 0,
    }
  }

  return {
    calls,
    inputTokens,
    outputTokens,
    totalCostCny: totalCost,
    avgLatencyMs: calls > 0 ? Math.round(totalLatency / calls) : 0,
    byAgent,
  }
}

export function readLlmUsageFromDisk(maxLines = DEFAULT_MAX_LINES): { rows: LlmUsageRow[]; path: string } {
  const path = getLlmObservabilityPath()
  if (!existsSync(path)) {
    return { rows: [], path }
  }
  const text = readFileSync(path, 'utf-8')
  const rows = parseLlmUsageRows(text, maxLines)
  return { rows, path }
}
