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
 * 根据变更文件列表，计算测试范围路径（公共目录前缀）
 * 用于将全量测试命令（npm test）缩减为仅测试变更相关目录
 *
 * 规则：
 * - 所有文件在同一顶级目录（如 frontend/）→ 返回该目录
 * - 跨多个顶级目录 → 返回 null（不限制，跑全量）
 * - 根目录文件 → 返回 null
 */
export declare function computeTestScope(changedFiles: string[]): string | null;
/**
 * 为测试命令追加范围限定参数
 * npm test → npm test -- <scope>
 * vitest   → vitest <scope>
 */
export declare function scopeTestCommand(baseCommand: string, scope: string | null): string;
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
     *
     * @param commands       lint/test/build 命令
     * @param maxFixAttempts 测试失败后最大重试次数
     * @param changedFiles   本次修改的文件列表（用于限定测试范围，不传则跑全量）
     */
    run(commands: {
        lint: string;
        test: string;
        build?: string;
    }, maxFixAttempts?: number, changedFiles?: string[]): Promise<TestRunResult>;
    /**
     * 执行单个测试步骤
     */
    private executeStep;
}
//# sourceMappingURL=test-runner.d.ts.map