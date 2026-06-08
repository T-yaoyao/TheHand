/**
 * Phase 接口定义
 * 每个 Pipeline 阶段实现此接口
 */
import type { Requirement, OrchestratorEvent, ProjectContext } from '../types.js';
import type { AgentRunner } from '../agents/agent-runner.js';
import type { SkillRegistry } from '../skill-registry/skill-registry.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { PromptManager } from '../llm/prompt-manager.js';
import type { Sandbox } from '../git-ops/sandbox.js';
import type { CommandExecutor } from '../git-ops/executor.js';
import type { TestRunner } from '../git-ops/test-runner.js';
import type { RepoManager } from '../git-ops/repo-manager.js';
import type { RequirementMemory } from '../memory/requirement-memory.js';
import type { ProjectMemory } from '../memory/project-memory.js';
import type { SandboxManagerLike } from './orchestrator.js';
/**
 * Phase 执行上下文
 * 包含一个 Phase 执行所需的全部依赖
 */
export interface PhaseContext {
    requirement: Requirement;
    projectId: string;
    sandbox: Sandbox;
    executor?: CommandExecutor;
    testRunner: TestRunner;
    repoManager: RepoManager;
    agentRunner: AgentRunner;
    llmClient: LLMClient;
    promptManager: PromptManager;
    skillRegistry: SkillRegistry;
    sandboxManager: SandboxManagerLike;
    projectMemory: ProjectMemory;
    requirementMemory: RequirementMemory;
    projectContext: ProjectContext;
}
/**
 * Pipeline Phase 接口
 * 每个阶段是一个 AsyncGenerator，yield OrchestratorEvent
 */
export interface Phase {
    readonly name: string;
    run(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent>;
}
//# sourceMappingURL=phase.d.ts.map