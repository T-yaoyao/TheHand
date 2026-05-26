import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
const execAsync = promisify(exec);
/**
 * 沙箱管理器
 *
 * 每次需求执行时创建隔离的 sandbox 副本，执行完丢弃。
 * 保证原始 sandbox-repo 永远不被污染。
 *
 * 对标 Claude Code 的沙箱执行机制
 */
export class SandboxManager {
    sourcePath;
    tempBase;
    activeSandboxes = new Map();
    constructor(
    /** 原始仓库路径（模板） */
    sourcePath, 
    /** 沙箱临时目录父路径 */
    tempBase = join(tmpdir(), 'thehand-sandbox')) {
        this.sourcePath = sourcePath;
        this.tempBase = tempBase;
    }
    /**
     * 创建沙箱：复制原始仓库到临时目录
     */
    async create(id) {
        const sandboxId = id ?? randomUUID().slice(0, 8);
        await mkdir(this.tempBase, { recursive: true });
        // mkdtemp 保证目录名唯一
        const sandboxPath = await mkdtemp(join(this.tempBase, `sandbox-${sandboxId}-`));
        // 复制仓库（排除 .git；dist/build 仅排除项目构建产物，不能排除 node_modules/*/dist）
        await execAsync(`rsync -a --exclude='.git' --exclude='/dist' --exclude='/build' ${this.sourcePath}/ ${sandboxPath}/`);
        // 在沙箱中初始化 git（支持 diff、commit 等操作）
        await execAsync('git init && git add -A && git commit -m "initial snapshot" --allow-empty', { cwd: sandboxPath });
        const sandbox = {
            path: sandboxPath,
            cleanup: async () => {
                await rm(sandboxPath, { recursive: true, force: true });
                this.activeSandboxes.delete(sandboxId);
            },
        };
        this.activeSandboxes.set(sandboxId, sandbox);
        return sandbox;
    }
    /**
     * 在沙箱中执行命令
     */
    async execInSandbox(sandbox, command) {
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: sandbox.path,
                timeout: 120000,
                maxBuffer: 1024 * 1024 * 10,
            });
            return { stdout, stderr, exitCode: 0 };
        }
        catch (e) {
            return {
                stdout: e.stdout ?? '',
                stderr: e.stderr ?? '',
                exitCode: e.code ?? 1,
            };
        }
    }
    /**
     * 获取沙箱相对于原始仓库的 diff
     */
    async getDiff(sandbox) {
        try {
            const { stdout } = await execAsync(`diff -rq ${this.sourcePath} ${sandbox.path} --exclude=node_modules --exclude=.git --exclude=dist --exclude=build 2>/dev/null || true`);
            return stdout;
        }
        catch {
            return '';
        }
    }
    /**
     * 将沙箱中的变更应用回原始仓库（只有验证通过才调用）
     * 复制文件后在源仓库中 git add + commit
     */
    async applyToSource(sandbox, files, commitMessage) {
        // 1. 复制文件
        for (const file of files) {
            const src = join(sandbox.path, file);
            const dest = join(this.sourcePath, file);
            await execAsync(`cp "${src}" "${dest}"`);
        }
        // 2. 在源仓库中提交
        if (commitMessage) {
            try {
                await execAsync('git add -A', { cwd: this.sourcePath });
                await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: this.sourcePath });
            }
            catch (e) {
                // 如果没有变更（nothing to commit），忽略错误
                if (!e.message?.includes('nothing to commit')) {
                    throw e;
                }
            }
        }
    }
    /**
     * 清理所有活跃沙箱
     */
    async cleanupAll() {
        await Promise.all(Array.from(this.activeSandboxes.values()).map(s => s.cleanup()));
    }
    /**
     * 获取活跃沙箱数量
     */
    getActiveCount() {
        return this.activeSandboxes.size;
    }
}
//# sourceMappingURL=sandbox.js.map