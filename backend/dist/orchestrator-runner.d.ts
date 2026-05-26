export declare function isOrchestratorRunning(requirementId: string): boolean;
/**
 * 在后台运行 Orchestrator，事件通过 SSE 推送给前端
 */
export declare function runOrchestratorForRequirement(requirementId: string, projectId?: string): Promise<void>;
//# sourceMappingURL=orchestrator-runner.d.ts.map