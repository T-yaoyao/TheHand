import { createHostExecutor } from './executor.js';
/**
 * 测试运行器：在沙箱中执行 lint 和单测
 * 不依赖 LLM，直接执行命令并解析结果
 */
export class TestRunner {
    sandboxPath;
    executor;
    constructor(sandboxPath, executor = createHostExecutor(sandboxPath)) {
        this.sandboxPath = sandboxPath;
        this.executor = executor;
    }
    /**
     * 执行完整的测试流程：lint → test → (失败时) auto-fix → retry
     * lint 作为非阻塞检查（warnings 不阻断），test 作为阻塞检查
     */
    async run(commands, maxFixAttempts = 3) {
        const steps = [];
        let fixAttempts = 0;
        // Step 1: Lint（非阻塞，lint 失败不阻断流程）
        const lintResult = await this.executeStep('lint', commands.lint);
        steps.push(lintResult);
        // Step 2: Build（阻塞，验证代码可编译/解析）
        if (commands.build) {
            const buildResult = await this.executeStep('build', commands.build);
            steps.push(buildResult);
            if (!buildResult.passed) {
                return { passed: false, steps, fixAttempts };
            }
        }
        // Step 3: Test（阻塞，test 必须通过）
        const testResult = await this.executeStep('unit-test', commands.test);
        steps.push(testResult);
        // 如果 test 失败，尝试自动修复
        while (!testResult.passed) {
            if (fixAttempts >= maxFixAttempts)
                break;
            fixAttempts++;
            // 尝试运行 lint --fix
            if (!lintResult.passed) {
                const fixResult = await this.executeStep(`lint-fix (attempt ${fixAttempts})`, `${commands.lint} --fix`);
                if (fixResult.passed) {
                    lintResult.passed = true;
                    lintResult.output += `\n[auto-fixed at attempt ${fixAttempts}]`;
                }
            }
            // 重新运行测试
            const retryResult = await this.executeStep(`unit-test-retry (attempt ${fixAttempts})`, commands.test);
            if (retryResult.passed) {
                testResult.passed = true;
                testResult.output += `\n[passed at attempt ${fixAttempts}]`;
                break;
            }
        }
        // 最终结果：test 必须通过，lint 作为 warning 报告
        return {
            passed: testResult.passed,
            steps,
            fixAttempts,
        };
    }
    /**
     * 执行单个测试步骤
     */
    async executeStep(name, command) {
        const startTime = Date.now();
        try {
            const { stdout, stderr } = await this.executor(command, { timeout: 120000 });
            return {
                name,
                passed: true,
                output: [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000),
                durationMs: Date.now() - startTime,
            };
        }
        catch (e) {
            return {
                name,
                passed: false,
                output: `Exit code: ${e.code}\nstdout: ${(e.stdout ?? '').slice(0, 1000)}\nstderr: ${(e.stderr ?? '').slice(0, 1000)}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
}
//# sourceMappingURL=test-runner.js.map