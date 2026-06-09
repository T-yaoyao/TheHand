import { useCallback, useEffect, useState } from 'react'
import { api, type LlmUsageResponse } from '../services/api'

/**
 * 任务详情内 Tab：仅展示当前需求（requirementId）的 LLM 调用记录
 */
export function ObservabilityPanel({ requirementId }: { requirementId: string }) {
  const [data, setData] = useState<LlmUsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getLlmUsage(requirementId)
      setData(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [requirementId])

  useEffect(() => {
    load()
  }, [load])

  const s = data?.summary

  return (
    <div className="obs-panel obs-panel-tab">
      <header className="obs-header-tab">
        <h3 className="obs-title-tab">LLM 可观测性</h3>
        <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      <p className="obs-hint-tab">
        本需求每次 AI 调用的 tokens、延迟与估算成本（单价与 core 中 PRICING_CNY_PER_MILLION 一致）。仅展示已关联本需求 ID 的记录。
      </p>

      {error && <div className="error-banner obs-error">{error}</div>}

      {loading && !data ? (
        <p className="empty-panel">加载中…</p>
      ) : s ? (
        <>
          <section className="obs-stats obs-stats-tab">
            <div className="obs-stat-card">
              <span className="obs-stat-label">调用次数</span>
              <strong className="obs-stat-value">{s.calls}</strong>
            </div>
            <div className="obs-stat-card">
              <span className="obs-stat-label">输入 tokens</span>
              <strong className="obs-stat-value">{s.inputTokens.toLocaleString()}</strong>
            </div>
            <div className="obs-stat-card">
              <span className="obs-stat-label">输出 tokens</span>
              <strong className="obs-stat-value">{s.outputTokens.toLocaleString()}</strong>
            </div>
            <div className="obs-stat-card">
              <span className="obs-stat-label">估算成本（元）</span>
              <strong className="obs-stat-value">¥{s.totalCostCny.toFixed(4)}</strong>
            </div>
            <div className="obs-stat-card">
              <span className="obs-stat-label">平均延迟</span>
              <strong className="obs-stat-value">{s.avgLatencyMs} ms</strong>
            </div>
          </section>

          {Object.keys(s.byAgent).length > 0 && (
            <section className="obs-section">
              <h4 className="obs-subheading">按 Agent 汇总</h4>
              <div className="obs-table-wrap">
                <table className="obs-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>调用</th>
                      <th>in / out tokens</th>
                      <th>成本（元）</th>
                      <th>平均延迟</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.byAgent).map(([agent, g]) => (
                      <tr key={agent}>
                        <td><code>{agent}</code></td>
                        <td>{g.calls}</td>
                        <td>{g.inputTokens.toLocaleString()} / {g.outputTokens.toLocaleString()}</td>
                        <td>¥{g.costCny.toFixed(4)}</td>
                        <td>{g.avgLatencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="obs-section">
            <h4 className="obs-subheading">调用明细</h4>
            {data.recent.length === 0 ? (
              <p className="empty-panel">
                暂无与本需求关联的 LLM 记录。请在本需求上运行流水线；若为本功能上线前的历史数据，可能未写入 requirementId。
              </p>
            ) : (
              <div className="obs-table-wrap obs-table-scroll">
                <table className="obs-table obs-table-compact">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>Agent</th>
                      <th>模型</th>
                      <th>in / out</th>
                      <th>延迟</th>
                      <th>成本</th>
                      <th>finish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="obs-cell-time">{new Date(r.timestamp).toLocaleString()}</td>
                        <td><code>{r.agent}</code></td>
                        <td className="obs-cell-mono">{r.model}</td>
                        <td>{r.inputTokens} / {r.outputTokens}</td>
                        <td>{r.latencyMs} ms</td>
                        <td>¥{r.costCny.toFixed(4)}</td>
                        <td><code>{r.finishReason}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
