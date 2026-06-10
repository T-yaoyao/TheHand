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
 * 检测测试输出是否为“无匹配测试文件”
 * vitest/jest 在无匹配时会 exit code 1，但这不是真正的测试失败
 */
export declare function isNoTestFilesFound(output: string): boolean;
/**
 * 根据变更文件列表，计算测试范围路径（公共目录前缀）
 * 用于将全量测试命令（npm test）缩减为仅测试变更相关目录
 *
 * 规则：
 * - 计算所有变更文件的最长公共目录前缀
 * - 上移一级（parent dir），确保兄弟目录的测试文件也被覆盖
 * - 单文件直接取所在目录
 * - 无公共前缀（跨多个顶级目录）→ 返回 null（跑全量）
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