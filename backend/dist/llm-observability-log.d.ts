import type { LlmUsageRecord } from '@thehand/core';
export declare function getLlmObservabilityPath(): string;
export declare function appendLlmUsageRecord(record: LlmUsageRecord): void;
export interface LlmUsageRow {
    id: string;
    agent: string;
    model: string;
    requirementId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costCny: number;
    finishReason: string;
    timestamp: string;
}
export interface LlmUsageSummary {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalCostCny: number;
    avgLatencyMs: number;
    byAgent: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        costCny: number;
        avgLatencyMs: number;
    }>;
}
export declare function parseLlmUsageRows(text: string, maxLines?: number): LlmUsageRow[];
export declare function summarizeLlmUsageRows(rows: LlmUsageRow[]): LlmUsageSummary;
export declare function readLlmUsageFromDisk(maxLines?: number): {
    rows: LlmUsageRow[];
    path: string;
};
//# sourceMappingURL=llm-observability-log.d.ts.map