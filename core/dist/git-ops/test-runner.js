import { createHostExecutor } from './executor.js';
/**
 * 从命令输出中提取缺失的包名
 * 匹配: Cannot find package 'xxx', Cannot find module 'xxx', Cannot find module "xxx"
 */
function extractMissingPackages(output) {
    const packages = new Set();
    // Cannot find package 'xxx'
    const pkgPattern = /Cannot find package '([^']+)'/g;
    let match;
    while ((match = pkgPattern.exec(output)) !== null) {
        packages.add(match[1]);
    }
    // Cannot find module 'xxx' 或 Cannot find module "xxx"
    const modPattern = /Cannot find module ['"]([^'"]+)['"]/g;
    while ((match = modPattern.exec(output)) !== null) {
        const mod = match[1];
        // 只处理包名（不以 . 或 / 开头），排除相对路径
        if (!mod.startsWith('.') && !mod.startsWith('/')) {
            packages.add(mod);
        }
    }
    return [...packages];
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
export function computeTestScope(changedFiles) {
    if (!changedFiles.length)
        return null;
    const topLevelDirs = new Set();
    for (const f of changedFiles) {
        const parts = f.replace(/\\/g, '/').split('/');
        if (parts.length <= 1)
            return null; // 根目录文件，无法限定范围
        topLevelDirs.add(parts[0]);
    }
    // 所有变更在同一顶级目录 → 限定到该目录
    if (topLevelDirs.size === 1) {
        return [...topLevelDirs][0];
    }
    return null; // 跨多个顶级目录，跑全量
}
/**
 * 为测试命令追加范围限定参数
 * npm test → npm test -- <scope>
 * vitest   → vitest <scope>
 */
export function scopeTestCommand(baseCommand, scope) {
    if (!scope)
        return baseCommand;
    const trimmed = baseCommand.trim();
    // npm run test / npm test → 用 -- 传参给底层脚本
    if (/^npm\s/.test(trimmed)) {
        return `${trimmed} -- ${scope}`;
    }
    // 直接调用 vitest/jest/mocha → 直接追加路径
    return `${trimmed} ${scope}`;
}
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
     * 执行完整的测试流程：lint → build（若配置）→ test → (失败时) 安装缺失依赖 / auto-fix → retry
     * lint 作为非阻塞检查（warnings 不阻断）；build 与 test 为阻塞检查
     *
     * @param commands       lint/test/build 命令
     * @param maxFixAttempts 测试失败后最大重试次数
     * @param changedFiles   本次修改的文件列表（用于限定测试范围，不传则跑全量）
     */
    async run(commands, maxFixAttempts = 3, changedFiles) {
        const steps = [];
        let fixAttempts = 0;
        // 计算测试范围：只跑变更文件所在目录的测试，避免无关测试误报失败
        const scope = changedFiles ? computeTestScope(changedFiles) : null;
        const scopedTestCmd = scopeTestCommand(commands.test, scope);
        if (scope) {
            console.log(`[test-runner] 测试范围限定: ${scope} (变更文件 ${changedFiles.length} 个)`);
        }
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
        const testResult = await this.executeStep('unit-test', scopedTestCmd);
        steps.push(testResult);
        // 如果 test 失败，尝试自动修复
        while (!testResult.passed) {
            if (fixAttempts >= maxFixAttempts)
                break;
            fixAttempts++;
            // 优先检测缺失依赖并安装（只在第一次重试时尝试）
            const failedOutput = steps.filter(s => !s.passed).map(s => s.output).join('\n');
            const missingPkgs = extractMissingPackages(failedOutput);
            if (missingPkgs.length > 0 && fixAttempts === 1) {
                console.log(`[test-runner] 检测到缺失依赖: ${missingPkgs.join(', ')}，尝试自动安装...`);
                const installResult = await this.executeStep(`install-missing-deps (${missingPkgs.join(', ')})`, `npm install ${missingPkgs.join(' ')} --save-dev`, 180_000);
                steps.push(installResult);
                if (installResult.passed) {
                    console.log(`[test-runner] 缺失依赖安装成功，重新运行测试...`);
                    const retryAfterInstall = await this.executeStep('unit-test-after-deps-install', scopedTestCmd);
                    steps.push(retryAfterInstall);
                    if (retryAfterInstall.passed) {
                        testResult.passed = true;
                        testResult.output += `\n[passed after installing missing deps: ${missingPkgs.join(', ')}]`;
                        break;
                    }
                    // 安装后仍然失败，继续走正常的 lint --fix 重试流程
                }
                else {
                    console.log(`[test-runner] 缺失依赖安装失败，继续重试...`);
                }
            }
            // 尝试运行 lint --fix
            if (!lintResult.passed) {
                const fixResult = await this.executeStep(`lint-fix (attempt ${fixAttempts})`, `${commands.lint} --fix`);
                if (fixResult.passed) {
                    lintResult.passed = true;
                    lintResult.output += `\n[auto-fixed at attempt ${fixAttempts}]`;
                }
            }
            // 重新运行测试（保持范围限定）
            const retryResult = await this.executeStep(`unit-test-retry (attempt ${fixAttempts})`, scopedTestCmd);
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
    async executeStep(name, command, timeout = 120000) {
        const startTime = Date.now();
        try {
            const { stdout, stderr } = await this.executor(command, { timeout });
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