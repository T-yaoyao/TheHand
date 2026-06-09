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
    clarificationRound?: number;
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
export interface ValidationError {
    field: string;
    message: string;
    severity: 'error' | 'warning';
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    autoFixable: boolean;
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
/** Architect Agent 输出的单文件分析 */
export interface ArchitectFileAnalysis {
    path: string;
    action: 'create' | 'modify' | 'delete';
    detailedChange: string;
    dependencies: string[];
    exports: string[];
    priority: number;
}
/** 跨文件引用关系 */
export interface CrossFileRef {
    from: string;
    to: string;
    ref: string;
}
/** Architect Agent 完整输出 */
export interface ArchitectOutput {
    globalContext: string;
    files: ArchitectFileAnalysis[];
    crossFileRefs: CrossFileRef[];
    batches: ChangeBatch[];
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
    /** 来自 project.json，供方案/Agent 引用关键路径清单 */
    keyFiles?: Record<string, string[]>;
    thehand?: TheHandProjectConfig;
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
/** project.json 中可选的 thehand 块：驱动路由注入、L1 召回、孤儿检测跳过、编码上下文候选 */
export interface TheHandRoutingIntegration {
    /** 为 false 时关闭本块逻辑 */
    enabled?: boolean;
    /** 路由表入口文件（自上而下优先选用磁盘上存在的路径） */
    routeEntryFiles?: string[];
    /** 命中时表示「需在 routeEntry 中注册」的新建页面 glob（支持 * 与 **） */
    nestedNewPageGlob?: string;
    /** 从 nestedNewPageGlob 中排除（如父壳 Profile.jsx） */
    nestedNewPageExcludeGlobs?: string[];
    /** 注入到 architect 的补充说明：与哪些已有子页同级等 */
    injectSiblingRouteHint?: string;
    /** 与 NavLink / 嵌套路由 path 对齐的提示（文件路径或说明文字） */
    nestedRouteParentHint?: string;
}
export interface TheHandRecallL1 {
    /** 作为「入口」参与 BFS 的候选文件（相对沙箱根） */
    entryCandidates?: string[];
    /** 浅层扫描路由文件的目录（相对沙箱根），如 frontend/src/routes */
    shallowRoutesDir?: string;
}
export interface TheHandOrphanGuard {
    /** 命中 glob 时跳过「孤儿 import」检测（如 Vite 入口） */
    entrySkipGlobs?: string[];
}
export interface TheHandProjectConfig {
    routingIntegration?: TheHandRoutingIntegration;
    recallL1?: TheHandRecallL1;
    orphanGuard?: TheHandOrphanGuard;
    /** 追加到默认列表之后去重，供编码阶段读取关键上下文（须为沙箱内已存在的路径） */
    readContextCandidates?: string[];
    /** 前端框架配置：组件扩展名、入口文件、关键目录，替代硬编码假设 */
    frontendFramework?: {
        /** 组件文件扩展名列表，如 ['.jsx', '.tsx', '.vue', '.svelte'] */
        componentExtensions?: string[];
        /** 应用入口文件候选列表，如 ['frontend/src/main.jsx', 'frontend/src/main.tsx'] */
        entryCandidates?: string[];
        /** 组件目录，如 'frontend/src/components' */
        componentsDir?: string;
        /** 路由/页面目录，如 'frontend/src/routes' */
        routesDir?: string;
        /** 上下文文件候选列表（追加到 readContextCandidates 之前） */
        contextFileCandidates?: string[];
    };
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
/** Phase 执行上下文：每个阶段需要的共享数据 */
export interface PhaseContext {
    requirement: Requirement;
    projectId: string;
    projectContext: ProjectContext;
    sandbox: import('./git-ops/sandbox.js').Sandbox;
    sandboxManager: import('./orchestrator/orchestrator.js').SandboxManagerLike;
    requirementMemory: import('./memory/requirement-memory.js').RequirementMemory;
    agentRunner: import('./agents/agent-runner.js').AgentRunner;
    llmClient: import('./llm/llm-client.js').LLMClient;
    promptManager: import('./llm/prompt-manager.js').PromptManager;
    skillRegistry: import('./skill-registry/skill-registry.js').SkillRegistry;
    projectMemory: import('./memory/project-memory.js').ProjectMemory;
    testRunner: import('./git-ops/test-runner.js').TestRunner;
    repoManager: import('./git-ops/repo-manager.js').RepoManager;
    executor?: import('./git-ops/executor.js').CommandExecutor;
}
export interface TokenBudget {
    maxTotal: number;
    used: number;
    remaining: number;
}
export interface SkillMatchRule {
    type?: string | string[];
    entity?: string | string[];
    scope?: ('frontend' | 'backend' | 'fullstack') | ('frontend' | 'backend' | 'fullstack')[];
    descriptionContains?: string | string[];
    priority?: number;
}
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    module: string;
    message: string;
    data?: Record<string, unknown>;
    traceId?: string;
    requirementId?: string;
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