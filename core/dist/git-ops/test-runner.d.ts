import type { CommandExecutor } from './executor.js';
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
    private executor;
    constructor(sandboxPath: string, executor?: CommandExecutor);
    /**
     * 执行完整的测试流程：lint → build（若配置）→ test → (失败时) 安装缺失依赖 / auto-fix → retry
     * lint 作为非阻塞检查（warnings 不阻断）；build 与 test 为阻塞检查
     */
    run(commands: {
        lint: string;
        test: string;
        build?: string;
    }, maxFixAttempts?: number): Promise<TestRunResult>;
    /**
     * 执行单个测试步骤
     */
    private executeStep;
}
//# sourceMappingURL=test-runner.d.ts.map