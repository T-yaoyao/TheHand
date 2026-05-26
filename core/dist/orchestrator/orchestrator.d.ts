import type { Requirement, OrchestratorEvent } from '../types.js';
import type { AgentRunner } from '../agents/agent-runner.js';
import type { SkillRegistry } from '../skill-registry/skill-registry.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
import { SandboxManager } from '../git-ops/sandbox.js';
import { RequirementMemory } from '../memory/requirement-memory.js';
import { ProjectMemory } from '../memory/project-memory.js';
export interface OrchestratorDeps {
    agentRunner: AgentRunner;
    llmClient: LLMClient;
    promptManager: PromptManager;
    skillRegistry: SkillRegistry;
    sandboxManager: SandboxManager;
    projectMemory: ProjectMemory;
    requirementMemory: RequirementMemory;
}
/**
 * 核心调度引擎：状态机驱动的 Agent 调度循环
 * 对标 Claude Code 的 query() AsyncGenerator
 */
export declare class Orchestrator {
    private deps;
    constructor(deps: OrchestratorDeps);
    /**
     * 主循环：根据需求状态调度对应 Agent
     * 返回 AsyncGenerator，前端通过 SSE 实时接收事件
     */
    run(requirement: Requirement, projectId?: string): AsyncGenerator<OrchestratorEvent>;
    /**
     * 处理 PM 回复（追问后的继续流程）
     */
    continueWithPMReply(requirement: Requirement, pmReply: string, projectId?: string): AsyncGenerator<OrchestratorEvent>;
    /**
     * 将沙箱中的变更应用到源仓库（只有测试通过才调用）
     */
    applyChanges(requirement: Requirement, files: string[]): Promise<void>;
    private parsePlan;
    private parseCodeOutput;
    private isTerminal;
    private selectAgent;
}
//# sourceMappingURL=orchestrator.d.ts.map