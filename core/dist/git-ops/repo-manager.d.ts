import type { CommandExecutor } from './executor.js';
export interface CleanCheckResult {
    clean: boolean;
    autoCleaned?: boolean;
    error?: string;
}
export interface DiffCheckResult {
    hasUnexpectedChanges: boolean;
    unexpectedFiles?: string[];
    changedFiles: string[];
    diffSummary: string;
}
export interface CommitResult {
    hash: string;
    message: string;
}
/**
 * Git 仓库管理器
 * 对标 PRD 第八章代码写入机制
 */
export declare class RepoManager {
    private sandboxPath;
    private executor;
    constructor(sandboxPath: string, executor?: CommandExecutor);
    /**
     * 清洁检查：检测 sandbox-repo 是否有脏状态
     */
    cleanCheck(): Promise<CleanCheckResult>;
    /**
     * Diff 检查：检测是否有预期外的文件变更
     */
    diffCheck(expectedFiles: string[]): Promise<DiffCheckResult>;
    /**
     * 创建功能分支
     */
    createBranch(branchName: string): Promise<void>;
    /**
     * 回滚到最近一次干净状态
     */
    rollback(): Promise<void>;
    /**
     * 暂存指定文件
     */
    stageFiles(files: string[]): Promise<void>;
    /**
     * 暂存所有变更
     */
    stageAll(): Promise<void>;
    /**
     * 提交代码（通过临时文件传递 message，避免 shell 转义问题）
     */
    commit(message: string): Promise<CommitResult>;
    /**
     * 推送分支到远程
     */
    push(branch?: string): Promise<string>;
    /**
     * 创建 PR（通过 gh CLI）
     */
    createPR(options: {
        title: string;
        body: string;
        base?: string;
        head?: string;
    }): Promise<string>;
    /**
     * 获取变更的文件列表
     */
    getChangedFiles(): Promise<string[]>;
    /**
     * 获取当前分支名
     */
    getCurrentBranch(): Promise<string>;
    /**
     * 获取最近的 commit 信息
     */
    getLastCommit(): Promise<{
        hash: string;
        message: string;
    }>;
}
//# sourceMappingURL=repo-manager.d.ts.map