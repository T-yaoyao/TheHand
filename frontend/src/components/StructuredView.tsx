export function StructuredView({ data }: { data: unknown | null }) {
  if (!data) {
    return <p className="empty-panel">暂无结构化需求。</p>
  }

  const obj = data as Record<string, unknown>

  return (
    <div className="structured-view">
      {obj.type != null && (
        <div className="struct-row">
          <span className="struct-label">类型</span>
          <span>{String(obj.type)}</span>
        </div>
      )}
      {obj.entity != null && (
        <div className="struct-row">
          <span className="struct-label">实体</span>
          <span>{String(obj.entity)}</span>
        </div>
      )}
      {obj.scope != null && (
        <div className="struct-row">
          <span className="struct-label">范围</span>
          <span>{String(obj.scope)}</span>
        </div>
      )}
      {obj.description != null && (
        <div className="struct-row struct-row-block">
          <span className="struct-label">描述</span>
          <p>{String(obj.description)}</p>
        </div>
      )}
      <details className="json-details">
        <summary>完整 JSON</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  )
}
