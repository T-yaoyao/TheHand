import type { Sandbox } from './sandbox.js';
import type { CommandExecutor } from './executor.js';
export interface DockerSandboxConfig {
    /** Docker 镜像名（默认 'thehand-sandbox'） */
    image?: string;
    /** 网络模式：'none' 完全隔离 / 'bridge' 允许网络（默认 'none'） */
    network?: string;
    /** 内存限制，如 '512m'、'1g'（默认 '1g'） */
    memory?: string;
    /** CPU 限制，如 '1.0'、'2.0'（默认 '1.0'） */
    cpus?: string;
    /** 沙箱临时目录父路径 */
    tempBase?: string;
}
export declare class DockerSandboxManager {
    private sourcePath;
    private activeSandboxes;
    private image;
    private network;
    private memory;
    private cpus;
    private tempBase;
    private imageBuilt;
    constructor(sourcePath: string, config?: DockerSandboxConfig);
    create(id?: string): Promise<Sandbox>;
    /** 获取已存在的沙箱（用于 resume 场景，如 diff-ready → commit） */
    getExisting(sandboxId: string): Sandbox | null;
    /** 获取容器内执行的 CommandExecutor（供 TestRunner / RepoManager 使用） */
    getExecutor(sandbox: Sandbox): CommandExecutor;
    applyToSource(sandbox: Sandbox, files: string[], commitMessage?: string): Promise<void>;
    getDiff(sandbox: Sandbox): Promise<string>;
    cleanupAll(): Promise<void>;
    getActiveCount(): number;
    private ensureImage;
    private copySource;
    private dockerExec;
    private findEntry;
    private shellEscape;
}
//# sourceMappingURL=docker-sandbox.d.ts.map