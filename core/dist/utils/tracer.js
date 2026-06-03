import { randomUUID } from 'crypto';
/**
 * 全链路追踪器
 * 为每个需求分配唯一 Trace ID，贯穿所有执行环节
 */
export class Tracer {
    spans = new Map();
    activeTraceId = null;
    /**
     * 开始新的追踪链路
     */
    startTrace() {
        const traceId = randomUUID();
        this.activeTraceId = traceId;
        return traceId;
    }
    /**
     * 开始一个新的 Span
     */
    startSpan(name, attributes = {}, parentSpanId) {
        const spanId = randomUUID();
        const span = {
            traceId: this.activeTraceId,
            spanId,
            name,
            startTime: Date.now(),
            status: 'ok',
            attributes,
            parentSpanId,
        };
        this.spans.set(spanId, span);
        return span;
    }
    /**
     * 结束 Span
     */
    endSpan(spanId, status = 'ok', attributes = {}) {
        const span = this.spans.get(spanId);
        if (!span)
            return;
        span.endTime = Date.now();
        span.durationMs = span.endTime - span.startTime;
        span.status = status;
        span.attributes = { ...span.attributes, ...attributes };
    }
    /**
     * 获取指定 Trace ID 的所有 Span
     */
    getSpansByTraceId(traceId) {
        return Array.from(this.spans.values()).filter(s => s.traceId === traceId);
    }
    /**
     * 生成监控指标汇总
     */
    generateMetrics(executions, requirements) {
        const totalRequirements = requirements.length;
        const completedRequirements = requirements.filter(r => r.status === 'done').length;
        const failedRequirements = requirements.filter(r => r.status === 'failed').length;
        const totalInputTokens = executions.reduce((sum, e) => sum + e.inputTokens, 0);
        const totalOutputTokens = executions.reduce((sum, e) => sum + e.outputTokens, 0);
        const totalEstimatedCost = executions.reduce((sum, e) => sum + (e.estimatedCost || 0), 0);
        const durations = requirements
            .filter(r => r.status === 'done' && r.createdAt && r.updatedAt)
            .map(r => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime());
        const averageDurationMs = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;
        const agentPerformance = {};
        const agentGroups = executions.reduce((groups, e) => {
            if (!groups[e.agent])
                groups[e.agent] = [];
            groups[e.agent].push(e);
            return groups;
        }, {});
        for (const [agentName, records] of Object.entries(agentGroups)) {
            const successCount = records.filter(r => r.status === 'success').length;
            agentPerformance[agentName] = {
                count: records.length,
                successRate: records.length > 0 ? successCount / records.length : 0,
                averageLatencyMs: records.reduce((sum, r) => sum + r.latencyMs, 0) / records.length,
            };
        }
        return {
            totalRequirements,
            completedRequirements,
            failedRequirements,
            averageDurationMs,
            totalInputTokens,
            totalOutputTokens,
            totalEstimatedCost,
            successRate: totalRequirements > 0 ? completedRequirements / totalRequirements : 0,
            agentPerformance,
        };
    }
}
// 全局单例
export const globalTracer = new Tracer();
//# sourceMappingURL=tracer.js.map