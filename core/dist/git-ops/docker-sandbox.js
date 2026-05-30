import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, mkdir, cp, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
const execAsync = promisify(exec);
export class DockerSandboxManager {
    sourcePath;
    activeSandboxes = new Map();
    image;
    network;
    memory;
    cpus;
    tempBase;
    imageBuilt = false;
    constructor(sourcePath, config = {}) {
        this.sourcePath = sourcePath;
        this.image = config.image ?? 'thehand-sandbox';
        this.network = config.network ?? 'bridge';
        this.memory = config.memory ?? '1g';
        this.cpus = config.cpus ?? '1.0';
        this.tempBase = config.tempBase ?? join(tmpdir(), 'thehand-sandbox');
    }
    async create(id) {
        await this.ensureImage();
        const sandboxId = id ?? randomUUID().slice(0, 8);
        const containerName = `thehand-${sandboxId}-${randomUUID().slice(0, 4)}`;
        await mkdir(this.tempBase, { recursive: true });
        const sandboxPath = await mkdtemp(join(this.tempBase, `sandbox-${sandboxId}-`));
        // 复制源文件到沙箱目录（替换 rsync）
        await this.copySource(this.sourcePath, sandboxPath);
        // 启动容器，挂载沙箱目录
        const dockerCmd = [
            'docker run -d',
            `--name ${containerName}`,
            `--network=${this.network}`,
            `--memory=${this.memory}`,
            `--cpus=${this.cpus}`,
            `--volume ${sandboxPath}:/sandbox`,
            '--workdir /sandbox',
            this.image,
        ].join(' ');
        await execAsync(dockerCmd);
        // 在容器内初始化 git
        await this.dockerExec(containerName, 'git init && git config user.email "thehand@sandbox" && ' +
            'git config user.name "TheHand Sandbox" && ' +
            'git add -A && git commit -m "initial snapshot" --allow-empty');
        // 在容器内安装依赖（避免宿主机 node_modules 原生二进制不兼容）
        await this.dockerExec(containerName, 'npm install', 180_000);
        const sandbox = {
            path: sandboxPath,
            cleanup: async () => {
                try {
                    await execAsync(`docker rm -f ${containerName}`, { timeout: 10_000 });
                }
                catch { }
                await rm(sandboxPath, { recursive: true, force: true });
                this.activeSandboxes.delete(sandboxId);
            },
        };
        this.activeSandboxes.set(sandboxId, { sandbox, containerName });
        return sandbox;
    }
    /** 获取容器内执行的 CommandExecutor（供 TestRunner / RepoManager 使用） */
    getExecutor(sandbox) {
        const entry = this.findEntry(sandbox);
        if (!entry)
            throw new Error('Sandbox not tracked');
        return async (command, options) => {
            const r = await this.dockerExec(entry.containerName, command, options?.timeout);
            if (r.exitCode !== 0) {
                const err = new Error(`Command failed (exit ${r.exitCode}): ${command.slice(0, 100)}`);
                err.stdout = r.stdout;
                err.stderr = r.stderr;
                err.code = r.exitCode;
                throw err;
            }
            return { stdout: r.stdout, stderr: r.stderr };
        };
    }
    async applyToSource(sandbox, files, commitMessage) {
        for (const file of files) {
            const src = join(sandbox.path, file);
            const dest = join(this.sourcePath, file);
            await mkdir(join(dest, '..'), { recursive: true });
            await cp(src, dest, { recursive: true });
        }
        if (commitMessage) {
            try {
                await execAsync('git add -A', { cwd: this.sourcePath });
                await execAsync(`git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`, { cwd: this.sourcePath });
            }
            catch (e) {
                if (!e.message?.includes('nothing to commit'))
                    throw e;
            }
        }
    }
    async getDiff(sandbox) {
        try {
            const { stdout } = await execAsync(`diff -rq ${this.sourcePath} ${sandbox.path} ` +
                '--exclude=node_modules --exclude=.git --exclude=dist --exclude=build 2>/dev/null || true');
            return stdout;
        }
        catch {
            return '';
        }
    }
    async cleanupAll() {
        await Promise.all(Array.from(this.activeSandboxes.values()).map(({ sandbox }) => sandbox.cleanup()));
    }
    getActiveCount() {
        return this.activeSandboxes.size;
    }
    // --- private ---
    async ensureImage() {
        if (this.imageBuilt)
            return;
        // 检查镜像是否已存在
        try {
            await execAsync(`docker image inspect ${this.image}`);
            this.imageBuilt = true;
            return;
        }
        catch { }
        // Dockerfile 在 src/git-ops/ 目录，编译后 import.meta.url 指向 dist/git-ops/
        const distDir = fileURLToPath(new URL('.', import.meta.url));
        const srcDir = join(distDir, '../../src/git-ops');
        await execAsync(`docker build -t ${this.image} -f ${join(srcDir, 'sandbox.Dockerfile')} ${srcDir}`, {
            timeout: 120_000,
        });
        this.imageBuilt = true;
    }
    async copySource(src, dest) {
        const exclude = new Set(['.git', 'dist', 'build', 'node_modules']);
        const entries = await readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            if (exclude.has(entry.name))
                continue;
            const srcPath = join(src, entry.name);
            const destPath = join(dest, entry.name);
            await cp(srcPath, destPath, { recursive: true, dereference: true });
        }
    }
    async dockerExec(containerName, command, timeout = 120_000) {
        // 通过 stdin 传入命令，避免 shell 转义问题（Windows 兼容）
        const script = `set -e\n${command}`;
        try {
            const stdout = execFileSync('docker', ['exec', '-i', containerName, 'bash'], {
                input: script,
                timeout,
                maxBuffer: 10 * 1024 * 1024,
            }).toString();
            return { stdout, stderr: '', exitCode: 0 };
        }
        catch (e) {
            return {
                stdout: e.stdout?.toString() ?? '',
                stderr: e.stderr?.toString() ?? '',
                exitCode: e.status ?? 1,
            };
        }
    }
    findEntry(sandbox) {
        for (const entry of this.activeSandboxes.values()) {
            if (entry.sandbox.path === sandbox.path)
                return entry;
        }
        return undefined;
    }
    shellEscape(s) {
        return "'" + s.replace(/'/g, "'\\''") + "'";
    }
}
//# sourceMappingURL=docker-sandbox.js.map