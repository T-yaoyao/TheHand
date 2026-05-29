import { createHostExecutor } from './executor.js';
/**
 * Git 仓库管理器
 * 对标 PRD 第八章代码写入机制
 */
export class RepoManager {
    sandboxPath;
    executor;
    constructor(sandboxPath, executor = createHostExecutor(sandboxPath)) {
        this.sandboxPath = sandboxPath;
        this.executor = executor;
    }
    /**
     * 清洁检查：检测 sandbox-repo 是否有脏状态
     */
    async cleanCheck() {
        try {
            const { stdout } = await this.executor('git status --porcelain');
            if (stdout.trim() === '') {
                return { clean: true };
            }
            // 尝试自动清理
            await this.executor('git checkout -- .');
            await this.executor('git clean -fd');
            return { clean: true, autoCleaned: true };
        }
        catch (e) {
            return { clean: false, error: `无法自动清理: ${e.message}` };
        }
    }
    /**
     * Diff 检查：检测是否有预期外的文件变更
     */
    async diffCheck(expectedFiles) {
        try {
            const { stdout: diffFiles } = await this.executor('git diff --name-only');
            const changedFiles = diffFiles.trim().split('\n').filter(Boolean);
            // 也检查未跟踪的新文件
            const { stdout: untracked } = await this.executor('git ls-files --others --exclude-standard');
            const newFiles = untracked.trim().split('\n').filter(Boolean);
            const allChanged = [...new Set([...changedFiles, ...newFiles])];
            const unexpectedFiles = allChanged.filter(f => !expectedFiles.includes(f));
            // 获取 diff 统计
            let diffSummary = '';
            try {
                const { stdout: stat } = await this.executor('git diff --stat');
                diffSummary = stat.trim();
            }
            catch { }
            return {
                hasUnexpectedChanges: unexpectedFiles.length > 0,
                unexpectedFiles,
                changedFiles: allChanged,
                diffSummary,
            };
        }
        catch (e) {
            return {
                hasUnexpectedChanges: false,
                changedFiles: [],
                diffSummary: `Diff 检查失败: ${e.message}`,
            };
        }
    }
    /**
     * 创建功能分支
     */
    async createBranch(branchName) {
        await this.executor(`git checkout -b ${branchName}`);
    }
    /**
     * 回滚到最近一次干净状态
     */
    async rollback() {
        await this.executor('git checkout -- .');
        await this.executor('git clean -fd');
    }
    /**
     * 暂存指定文件
     */
    async stageFiles(files) {
        for (const file of files) {
            await this.executor(`git add "${file}"`);
        }
    }
    /**
     * 暂存所有变更
     */
    async stageAll() {
        await this.executor('git add -A');
    }
    /**
     * 提交代码
     */
    async commit(message) {
        await this.stageAll();
        await this.executor(`git commit -m '${message.replace(/'/g, "'\\''")}'`);
        const { stdout } = await this.executor('git rev-parse --short HEAD');
        return { hash: stdout.trim(), message };
    }
    /**
     * 推送分支到远程
     */
    async push(branch) {
        const branchArg = branch ? `-u origin ${branch}` : '';
        const { stdout } = await this.executor(`git push ${branchArg}`);
        return stdout.trim();
    }
    /**
     * 创建 PR（通过 gh CLI）
     */
    async createPR(options) {
        const args = [
            `--title "${options.title.replace(/"/g, '\\"')}"`,
            `--body "${options.body.replace(/"/g, '\\"')}"`,
        ];
        if (options.base)
            args.push(`--base ${options.base}`);
        if (options.head)
            args.push(`--head ${options.head}`);
        const { stdout } = await this.executor(`gh pr create ${args.join(' ')}`);
        return stdout.trim();
    }
    /**
     * 获取变更的文件列表
     */
    async getChangedFiles() {
        const { stdout } = await this.executor('git diff --name-only');
        const changed = stdout.trim().split('\n').filter(Boolean);
        const { stdout: untracked } = await this.executor('git ls-files --others --exclude-standard');
        const newFiles = untracked.trim().split('\n').filter(Boolean);
        return [...new Set([...changed, ...newFiles])];
    }
    /**
     * 获取当前分支名
     */
    async getCurrentBranch() {
        const { stdout } = await this.executor('git branch --show-current');
        return stdout.trim();
    }
    /**
     * 获取最近的 commit 信息
     */
    async getLastCommit() {
        const { stdout } = await this.executor('git log -1 --format="%h %s"');
        const [hash, ...msgParts] = stdout.trim().split(' ');
        return { hash, message: msgParts.join(' ') };
    }
}
//# sourceMappingURL=repo-manager.js.map