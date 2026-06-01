import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { CommandExecutor } from './executor.js'
import { createHostExecutor } from './executor.js'

export interface CleanCheckResult {
  clean: boolean
  autoCleaned?: boolean
  error?: string
}

export interface DiffCheckResult {
  hasUnexpectedChanges: boolean
  unexpectedFiles?: string[]
  changedFiles: string[]
  diffSummary: string
}

export interface CommitResult {
  hash: string
  message: string
}

/**
 * Git 仓库管理器
 * 对标 PRD 第八章代码写入机制
 */
export class RepoManager {
  constructor(
    private sandboxPath: string,
    private executor: CommandExecutor = createHostExecutor(sandboxPath),
  ) {}

  /**
   * 清洁检查：检测 sandbox-repo 是否有脏状态
   */
  async cleanCheck(): Promise<CleanCheckResult> {
    try {
      const { stdout } = await this.executor('git status --porcelain')
      if (stdout.trim() === '') {
        return { clean: true }
      }

      // 尝试自动清理
      await this.executor('git checkout -- .')
      await this.executor('git clean -fd')
      return { clean: true, autoCleaned: true }
    } catch (e: any) {
      return { clean: false, error: `无法自动清理: ${e.message}` }
    }
  }

  /**
   * Diff 检查：检测是否有预期外的文件变更
   */
  async diffCheck(expectedFiles: string[]): Promise<DiffCheckResult> {
    try {
      const { stdout: diffFiles } = await this.executor('git diff --name-only')
      const changedFiles = diffFiles.trim().split('\n').filter(Boolean)

      // 也检查未跟踪的新文件
      const { stdout: untracked } = await this.executor('git ls-files --others --exclude-standard')
      const newFiles = untracked.trim().split('\n').filter(Boolean)

      const allChanged = [...new Set([...changedFiles, ...newFiles])]
      const unexpectedFiles = allChanged.filter(f => !expectedFiles.includes(f))

      // 获取 diff 统计
      let diffSummary = ''
      try {
        const { stdout: stat } = await this.executor('git diff --stat')
        diffSummary = stat.trim()
      } catch {}

      return {
        hasUnexpectedChanges: unexpectedFiles.length > 0,
        unexpectedFiles,
        changedFiles: allChanged,
        diffSummary,
      }
    } catch (e: any) {
      return {
        hasUnexpectedChanges: false,
        changedFiles: [],
        diffSummary: `Diff 检查失败: ${e.message}`,
      }
    }
  }

  /**
   * 创建功能分支
   */
  async createBranch(branchName: string): Promise<void> {
    await this.executor(`git checkout -b ${branchName}`)
  }

  /**
   * 回滚到最近一次干净状态
   */
  async rollback(): Promise<void> {
    await this.executor('git checkout -- .')
    await this.executor('git clean -fd')
  }

  /**
   * 暂存指定文件
   */
  async stageFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await this.executor(`git add "${file}"`)
    }
  }

  /**
   * 暂存所有变更
   */
  async stageAll(): Promise<void> {
    await this.executor('git add -A')
  }

  /**
   * 提交代码（通过临时文件传递 message，避免 shell 转义问题）
   * 注意：executor 可能在 Docker 容器内运行，所以 git 命令必须用相对路径
   */
  async commit(message: string): Promise<CommitResult> {
    await this.stageAll()
    // 写入临时文件（用宿主机路径，因为 sandbox 目录是 volume 挂载的）
    const hostMsgFile = join(this.sandboxPath, '.git', 'COMMIT_MSG_TMP')
    try {
      writeFileSync(hostMsgFile, message, 'utf-8')
      // 用相对路径，这样无论在宿主机还是容器内都能找到文件
      await this.executor('git commit -F .git/COMMIT_MSG_TMP')
    } finally {
      try { unlinkSync(hostMsgFile) } catch {}
    }
    const { stdout } = await this.executor('git rev-parse --short HEAD')
    return { hash: stdout.trim(), message }
  }

  /**
   * 最近一次提交涉及的文件路径（用于 commit 后同步到源仓库）。
   * 注意：commit 后 git diff 为空，不能再用 getChangedFiles()。
   */
  async getFilesInLastCommit(): Promise<string[]> {
    const { stdout } = await this.executor('git diff-tree --no-commit-id --name-only -r HEAD')
    return stdout.trim().split('\n').filter(Boolean)
  }

  /**
   * 推送分支到远程
   */
  async push(branch?: string): Promise<string> {
    const branchArg = branch ? `-u origin ${branch}` : ''
    const { stdout } = await this.executor(`git push ${branchArg}`)
    return stdout.trim()
  }

  /**
   * 创建 PR（通过 gh CLI）
   */
  async createPR(options: { title: string; body: string; base?: string; head?: string }): Promise<string> {
    const args = [
      `--title "${options.title.replace(/"/g, '\\"')}"`,
      `--body "${options.body.replace(/"/g, '\\"')}"`,
    ]
    if (options.base) args.push(`--base ${options.base}`)
    if (options.head) args.push(`--head ${options.head}`)

    const { stdout } = await this.executor(`gh pr create ${args.join(' ')}`)
    return stdout.trim()
  }

  /**
   * 获取变更的文件列表（未提交的变更）
   */
  async getChangedFiles(): Promise<string[]> {
    const { stdout } = await this.executor('git diff --name-only')
    const changed = stdout.trim().split('\n').filter(Boolean)

    const { stdout: untracked } = await this.executor('git ls-files --others --exclude-standard')
    const newFiles = untracked.trim().split('\n').filter(Boolean)

    return [...new Set([...changed, ...newFiles])]
  }

  /**
   * 获取最近一次 commit 的变更文件列表（用于 commit 后获取文件列表）
   */
  async getLastCommitFiles(): Promise<{ stdout: string; stderr: string }> {
    return this.executor('git diff-tree --no-commit-id --name-only -r HEAD')
  }

  /**
   * 获取当前分支名
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await this.executor('git branch --show-current')
    return stdout.trim()
  }

  /**
   * 获取最近的 commit 信息
   */
  async getLastCommit(): Promise<{ hash: string; message: string }> {
    const { stdout } = await this.executor('git log -1 --format="%h %s"')
    const [hash, ...msgParts] = stdout.trim().split(' ')
    return { hash, message: msgParts.join(' ') }
  }
}
