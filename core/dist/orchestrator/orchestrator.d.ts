import type { Requirement, OrchestratorEvent } from '../types.js';
import type { AgentRunner } from '../agents/agent-runner.js';
import type { SkillRegistry } from '../skill-registry/skill-registry.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
import type { Sandbox } from '../git-ops/sandbox.js';
import { RequirementMemory } from '../memory/requirement-memory.js';
import { ProjectMemory } from '../memory/project-memory.js';
export interface SandboxManagerLike {
    create(id?: string): Promise<Sandbox>;
    getExisting?(sandboxId: string): Sandbox | null;
    applyToSource(sandbox: Sandbox, files: string[], commitMessage?: string): Promise<void>;
    cleanupAll(): Promise<void>;
    getActiveCount(): number;
}
export interface OrchestratorDeps {
    agentRunner: AgentRunner;
    llmClient: LLMClient;
    promptManager: PromptManager;
    skillRegistry: SkillRegistry;
    sandboxManager: SandboxManagerLike;
    projectMemory: ProjectMemory;
    requirementMemory: RequirementMemory;
}
/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 支持多阶段暂停：plan-ready → 用户审批 → coding → diff-ready → 用户确认 → commit
 */
export declare class Orchestrator {
    private deps;
    private sandboxShouldCleanup;
    constructor(deps: OrchestratorDeps);
    /**
     * 主循环：根据需求状态调度对应 Agent
     * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
     *
     * 状态流转：
     *   idle/clarifying → 澄清 → 方案 → plan-ready（暂停，等审批）
     *   plan-approved → 编码 → 测试 → diff-ready（暂停，等确认）
     *   diff-ready → commit → apply → done
     */
    run(requirement: Requirement, projectId?: string): AsyncGenerator<OrchestratorEvent>;
    /**
     * 编码+测试阶段（支持从 plan-approved 状态直接进入）
     */
    private phaseCoding;
    /**
     * 提交+应用阶段（支持从 diff-ready 状态直接进入）
     */
    private phaseCommit;
    /**
     * 处理 PM 回复（追问后的继续流程）
     */
    continueWithPMReply(requirement: Requirement, pmReply: string, projectId?: string): AsyncGenerator<OrchestratorEvent>;
    private parsePlan;
    private isTerminal;
    private selectAgent;
}
//# sourceMappingURL=orchestrator.d.ts.map