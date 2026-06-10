import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, mkdir, cp, readdir, access, unlink } from 'fs/promises';
import { join, resolve } from 'path';
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
        let containerStarted = false;
        try {
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
            containerStarted = true;
            // 在容器内初始化 git
            await this.dockerExec(containerName, 'git init && git config user.email "thehand@sandbox" && ' +
                'git config user.name "TheHand Sandbox" && ' +
                'git add -A && git commit -m "initial snapshot" --allow-empty');
            // 在容器内安装依赖（避免宿主机 node_modules 原生二进制不兼容）
            await this.dockerExec(containerName, 'npm install', 180_000);
        }
        catch (e) {
            // 创建失败时清理资源
            if (containerStarted) {
                try {
                    await execAsync(`docker rm -f ${containerName}`, { timeout: 10_000 });
                }
                catch { }
            }
            await rm(sandboxPath, { recursive: true, force: true }).catch(() => { });
            throw e;
        }
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
    /** 获取已存在的沙箱（用于 resume 场景，如 diff-ready → commit） */
    getExisting(sandboxId) {
        const entry = this.activeSandboxes.get(sandboxId);
        return entry?.sandbox ?? null;
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
        const resolvedSource = resolve(this.sourcePath);
        console.log(`[applyToSource] files=${files.length}, sourcePath=${this.sourcePath}, sandboxPath=${sandbox.path}`);
        let copiedCount = 0;
        let deletedCount = 0;
        for (const file of files) {
            const src = resolve(sandbox.path, file);
            const dest = resolve(this.sourcePath, file);
            // 路径穿越检查
            if (!src.startsWith(resolve(sandbox.path)) || !dest.startsWith(resolvedSource)) {
                console.log(`[applyToSource] SKIP (path traversal): ${file}`);
                continue;
            }
            // 检查源文件是否存在：存在则复制，不存在则删除目标
            try {
                await access(src);
                await mkdir(join(dest, '..'), { recursive: true });
                await cp(src, dest, { recursive: true });
                copiedCount++;
                console.log(`[applyToSource] copied: ${file}`);
            }
            catch {
                // 源文件不存在 = 被 coding agent 删除
                try {
                    await unlink(dest);
                    deletedCount++;
                    console.log(`[applyToSource] deleted: ${file}`);
                }
                catch {
                    // 目标文件也不存在，忽略
                }
            }
        }
        console.log(`[applyToSource] copied ${copiedCount}, deleted ${deletedCount}, total ${files.length}`);
        if (commitMessage) {
            try {
                // 检查是否有变更
                const status = execFileSync('git', ['status', '--porcelain'], { cwd: this.sourcePath, timeout: 15_000 }).toString().trim();
                console.log(`[applyToSource] git status: "${status.slice(0, 200)}"`);
                if (!status) {
                    console.log('[applyToSource] nothing to commit, skipping');
                    return;
                }
                // 只 stage 本次 apply 的文件，不用 git add -A（避免误提交源仓库累积的无关变更）
                const stageFiles = files.filter(f => {
                    const dest = resolve(this.sourcePath, f);
                    return dest.startsWith(resolvedSource);
                });
                if (stageFiles.length > 0) {
                    execFileSync('git', ['add', '--', ...stageFiles], { cwd: this.sourcePath, timeout: 30_000 });
                    console.log(`[applyToSource] git add ${stageFiles.length} specific files`);
                }
                // 检查 staged 区是否有内容
                const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: this.sourcePath, timeout: 10_000 }).toString().trim();
                if (!staged) {
                    console.log('[applyToSource] nothing staged after git add, skipping commit');
                    return;
                }
                execFileSync('git', ['commit', '-m', commitMessage], { cwd: this.sourcePath, timeout: 30_000 });
                console.log('[applyToSource] git commit done');
            }
            catch (e) {
                console.log(`[applyToSource] git error: ${e.message}`);
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
    async takeScreenshot(port = 3000, route = '/') {
        const entry = this.activeSandboxes.values().next().value;
        if (!entry)
            return null;
        try {
            const pyScript = [
                'import sys',
                'try:',
                '    from playwright.sync_api import sync_playwright',
                '    with sync_playwright() as p:',
                '        browser = p.chromium.launch()',
                "        page = browser.new_page(viewport={'width': 1280, 'height': 720})",
                `        page.goto('http://localhost:${port}${route}', timeout=15000)`,
                "        page.wait_for_load_state('networkidle', timeout=10000)",
                "        page.screenshot(path='/sandbox/.screenshot.png', full_page=True)",
                '        browser.close()',
                "    print('OK')",
                'except Exception as e:',
                "    print(f'FAIL: {e}', file=sys.stderr)",
                '    sys.exit(1)',
            ].join('\n');
            const result = await this.dockerExec(entry.containerName, `python3 -c '${pyScript}'`);
            if (result.exitCode !== 0)
                return null;
            const { stdout: base64 } = await this.dockerExec(entry.containerName, 'base64 -w0 /sandbox/.screenshot.png');
            return base64.trim() || null;
        }
        catch {
            return null;
        }
    }
    async startDevServer(port = 3000, timeoutMs = 30_000) {
        const entry = this.activeSandboxes.values().next().value;
        if (!entry)
            return false;
        try {
            // Start dev server in background
            await this.dockerExec(entry.containerName, 'cd /sandbox && npm run dev &');
        }
        catch {
            // Ignore immediate errors from background process
        }
        // Poll until the server responds or timeout (use node since curl may not be available)
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const result = await this.dockerExec(entry.containerName, `node -e "const http=require('http');const req=http.get('http://localhost:${port}',r=>{console.log(r.statusCode);process.exit(0)});req.on('error',()=>process.exit(1));req.setTimeout(2000,()=>process.exit(1))"`, 5_000);
                if (result.exitCode === 0 && result.stdout.trim().match(/^[23]/)) {
                    return true;
                }
            }
            catch {
                // Server not ready yet, keep polling
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        return false;
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