export interface TestStepResult {
    name: string;
    passed: boolean;
    output: string;
    durationMs: number;
}
export interface TestRunResult {
    passed: boolean;
    steps: TestStepResult[];
    fixAttempts: number;
}
/**
 * 测试运行器：在沙箱中执行 lint 和单测
 * 不依赖 LLM，直接执行命令并解析结果
 */
export declare class TestRunner {
    private sandboxPath;
    constructor(sandboxPath: string);
    /**
     * 执行完整的测试流程：lint → test → (失败时) auto-fix → retry
     * lint 作为非阻塞检查（warnings 不阻断），test 作为阻塞检查
     */
    run(commands: {
        lint: string;
        test: string;
    }, maxFixAttempts?: number): Promise<TestRunResult>;
    /**
     * 执行单个测试步骤
     */
    private executeStep;
}
//# sourceMappingURL=test-runner.d.ts.map