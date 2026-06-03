import type { TraceSpan, MetricsSummary, ExecutionRecord } from '../types.js';
/**
 * 全链路追踪器
 * 为每个需求分配唯一 Trace ID，贯穿所有执行环节
 */
export declare class Tracer {
    private spans;
    private activeTraceId;
    /**
     * 开始新的追踪链路
     */
    startTrace(): string;
    /**
     * 开始一个新的 Span
     */
    startSpan(name: string, attributes?: Record<string, any>, parentSpanId?: string): TraceSpan;
    /**
     * 结束 Span
     */
    endSpan(spanId: string, status?: 'ok' | 'error', attributes?: Record<string, any>): void;
    /**
     * 获取指定 Trace ID 的所有 Span
     */
    getSpansByTraceId(traceId: string): TraceSpan[];
    /**
     * 生成监控指标汇总
     */
    generateMetrics(executions: ExecutionRecord[], requirements: any[]): MetricsSummary;
}
export declare const globalTracer: Tracer;
//# sourceMappingURL=tracer.d.ts.map