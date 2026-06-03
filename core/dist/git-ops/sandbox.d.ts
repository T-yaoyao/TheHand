export interface Sandbox {
    /** 沙箱工作目录（完整副本） */
    path: string;
    /** 清理沙箱 */
    cleanup(): Promise<void>;
}
/**
 * 沙箱管理器
 *
 * 每次需求执行时创建隔离的 sandbox 副本，执行完丢弃。
 * 保证原始 sandbox-repo 永远不被污染。
 *
 * 对标 Claude Code 的沙箱执行机制
 */
export declare class SandboxManager {
    /** 原始仓库路径（模板） */
    private sourcePath;
    /** 沙箱临时目录父路径 */
    private tempBase;
    private activeSandboxes;
    constructor(
    /** 原始仓库路径（模板） */
    sourcePath: string, 
    /** 沙箱临时目录父路径 */
    tempBase?: string);
    /**
     * 创建沙箱：复制原始仓库到临时目录
     */
    create(id?: string): Promise<Sandbox>;
    /**
     * 在沙箱中执行命令
     */
    execInSandbox(sandbox: Sandbox, command: string): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    /**
     * 获取沙箱相对于原始仓库的 diff
     */
    getDiff(sandbox: Sandbox): Promise<string>;
    /**
     * 将沙箱中的变更应用回原始仓库（只有验证通过才调用）
     * 复制文件后在源仓库中 git add + commit
     */
    applyToSource(sandbox: Sandbox, files: string[], commitMessage?: string): Promise<void>;
    /**
     * 清理所有活跃沙箱
     */
    cleanupAll(): Promise<void>;
    /**
     * 获取活跃沙箱数量
     */
    getActiveCount(): number;
}
//# sourceMappingURL=sandbox.d.ts.map