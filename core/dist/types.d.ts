import { z } from 'zod';
export type RequirementStatus = 'idle' | 'clarifying' | 'clarified' | 'waiting-for-pm' | 'needs-confirmation' | 'planning' | 'plan-ready' | 'plan-approved' | 'plan-rejected' | 'coding' | 'testing' | 'diff-ready' | 'done' | 'failed' | 'reverted';
export interface Requirement {
    id: string;
    status: RequirementStatus;
    pmInput: string;
    structuredRequirement: StructuredRequirement | null;
    plan: FilePlan[] | null;
    confidenceScore?: number;
    riskLevel?: 'low' | 'medium' | 'high';
    naturalLanguageSummary?: string;
    estimatedDurationMs?: number;
    estimatedCost?: number;
    traceId?: string;
    autoApprove?: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface StructuredRequirement {
    type: string;
    entity: string;
    fields?: FieldSpec[];
    scope: 'frontend' | 'backend' | 'fullstack';
    description: string;
    isDefaulted?: boolean;
}
export interface FieldSpec {
    name: string;
    type: string;
    description: string;
    defaultValue?: string;
}
export interface FilePlan {
    path: string;
    changeDescription: string;
    priority: number;
}
import type { ToolDefinition } from './llm/llm-client.js';
export interface AgentDefinition {
    name: string;
    description: string;
    systemPrompt: string | ((context: AgentContext) => string);
    tools: string[];
    model?: string;
    maxRounds?: number;
    outputTool?: ToolDefinition;
}
export interface AgentContext {
    requirement: Requirement;
    projectContext: ProjectContext;
    memory: MemoryContext;
}
export interface MemoryContext {
    structuredRequirement: StructuredRequirement | null;
    recentConversations: Conversation[];
    projectContext: ProjectContext;
    lessons: Lesson[];
}
export interface AgentResult {
    agentName: string;
    status: 'success' | 'failed' | 'needs-pm-input';
    output: any;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
}
export interface SkillDefinition {
    name: string;
    description: string;
    canHandle: (requirement: StructuredRequirement) => boolean;
    execute: (requirement: StructuredRequirement, projectContext: ProjectContext) => Promise<SkillOutput[]>;
    prompt?: string;
    requiredFiles?: string[];
}
export interface SkillOutput {
    path: string;
    content: string;
    summary: string;
}
/** 文件接口信息（正则提取，零 LLM 消耗） */
export interface FileInterface {
    path: string;
    exports: string[];
    imports: string[];
    functionSignatures: string[];
    routeDefinitions: string[];
    modelFields: string[];
}
/** 一个代码生成批次 */
export interface ChangeBatch {
    files: string[];
    reason: string;
}
export interface Tool {
    name: string;
    description: string;
    inputSchema: z.ZodSchema;
    isConcurrencySafe: boolean;
    isReadOnly: boolean;
    call: (input: any, context: ToolContext) => Promise<ToolResult>;
}
export interface ToolResult {
    type: 'success' | 'error';
    content: string;
}
export interface ToolContext {
    sandboxPath: string;
    backupStore: BackupStore;
}
export interface BackupStore {
    save(path: string, content: string | null): Promise<void>;
    restore(path: string): Promise<string | null>;
}
export interface ProjectContext {
    id: string;
    name: string;
    techStack: TechStack;
    structure: ProjectStructure;
    commands: ProjectCommands;
    models: Record<string, ModelDefinition>;
    routes: Record<string, Record<string, string>>;
    constraints?: Record<string, string>;
}
export interface TechStack {
    frontend: string;
    backend: string;
    database: string;
    language: string;
}
export interface ProjectStructure {
    frontend: string;
    backend: string;
    models: string;
    routes: string;
    components: string;
}
export interface ProjectCommands {
    lint: string;
    test: string;
    dev: string;
    build: string;
}
export interface ModelDefinition {
    fields: string[];
    associations: string[];
}
export interface Conversation {
    id: string;
    requirementId: string;
    role: 'pm' | 'system';
    content: string;
    round: number;
    createdAt: Date;
}
export interface Lesson {
    id: string;
    projectId: string;
    requirementId?: string | null;
    phase: string;
    filePath: string | null;
    errorSummary: string;
    errorDetail: string | null;
    fixHint: string | null;
    resolved: boolean;
    createdAt: Date;
}
export interface ChangeRecord {
    id: string;
    requirementId: string;
    filePath: string;
    action: 'created' | 'modified' | 'deleted';
    createdAt: Date;
}
export interface ExecutionRecord {
    id: string;
    requirementId: string;
    agent: string;
    skill: string | null;
    input: any;
    output: any;
    status: 'success' | 'failed';
    reason: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCost: number;
    createdAt: Date;
}
export interface RiskAssessment {
    score: number;
    riskLevel: 'low' | 'medium' | 'high';
    factors: {
        name: string;
        weight: number;
        description: string;
    }[];
    recommendations: string[];
}
export interface NaturalLanguageSummary {
    title: string;
    description: string;
    changes: string[];
    impact: string;
}
export interface DiffCheckResult {
    hasUnexpectedChanges: boolean;
    unexpectedFiles: string[];
    unrelatedChanges: {
        path: string;
        lines: number[];
        description: string;
    }[];
    warnings: string[];
    isSafe: boolean;
}
export interface TraceSpan {
    traceId: string;
    spanId: string;
    name: string;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    status: 'ok' | 'error';
    attributes: Record<string, any>;
    parentSpanId?: string;
}
export interface MetricsSummary {
    totalRequirements: number;
    completedRequirements: number;
    failedRequirements: number;
    averageDurationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCost: number;
    successRate: number;
    agentPerformance: Record<string, {
        count: number;
        successRate: number;
        averageLatencyMs: number;
    }>;
}
export type OrchestratorEvent = {
    type: 'status-change';
    status: RequirementStatus;
    agent: string;
} | {
    type: 'waiting-for-pm';
    requirement: Requirement;
    questions: string[];
} | {
    type: 'plan-ready';
    plan: FilePlan[];
    requirement: Requirement;
    riskAssessment?: RiskAssessment;
    naturalSummary?: NaturalLanguageSummary;
} | {
    type: 'diff-ready';
    requirement: Requirement;
    diff: string;
    screenshot?: string;
    files: {
        path: string;
        summary: string;
    }[];
    diffCheck?: DiffCheckResult;
    fileValidationSummary?: FileValidationSummary;
} | {
    type: 'executing';
    phase: string;
    progress: number;
    warnings?: string[];
} | {
    type: 'test-result';
    passed: boolean;
    details: string;
} | {
    type: 'completed';
    requirement: Requirement;
    prUrl?: string;
    sandboxPath?: string;
} | {
    type: 'failed';
    requirement: Requirement;
    error: string;
    userMessage?: string;
} | {
    type: 'risk-assessed';
    requirement: Requirement;
    assessment: RiskAssessment;
} | {
    type: 'file-validation';
    summary: FileValidationSummary;
};
export interface FileValidationSummary {
    totalPlanFiles: number;
    fullyGenerated: string[];
    fallbackOriginal: string[];
    noChangeDetected: string[];
    criticalMissing: string[];
}
//# sourceMappingURL=types.d.ts.map