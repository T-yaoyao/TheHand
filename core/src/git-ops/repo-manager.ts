import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
  constructor(private sandboxPath: string) {}

  /**
   * 清洁检查：检测 sandbox-repo 是否有脏状态
   */
  async cleanCheck(): Promise<CleanCheckResult> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.sandboxPath })
      if (stdout.trim() === '') {
        return { clean: true }
      }

      // 尝试自动清理
      await execAsync('git checkout -- .', { cwd: this.sandboxPath })
      await execAsync('git clean -fd', { cwd: this.sandboxPath })
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
      const { stdout: diffFiles } = await execAsync('git diff --name-only', { cwd: this.sandboxPath })
      const changedFiles = diffFiles.trim().split('\n').filter(Boolean)

      // 也检查未跟踪的新文件
      const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', { cwd: this.sandboxPath })
      const newFiles = untracked.trim().split('\n').filter(Boolean)

      const allChanged = [...new Set([...changedFiles, ...newFiles])]
      const unexpectedFiles = allChanged.filter(f => !expectedFiles.includes(f))

      // 获取 diff 统计
      let diffSummary = ''
      try {
        const { stdout: stat } = await execAsync('git diff --stat', { cwd: this.sandboxPath })
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
    await execAsync(`git checkout -b ${branchName}`, { cwd: this.sandboxPath })
  }

  /**
   * 回滚到最近一次干净状态
   */
  async rollback(): Promise<void> {
    await execAsync('git checkout -- .', { cwd: this.sandboxPath })
    await execAsync('git clean -fd', { cwd: this.sandboxPath })
  }

  /**
   * 暂存指定文件
   */
  async stageFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await execAsync(`git add "${file}"`, { cwd: this.sandboxPath })
    }
  }

  /**
   * 暂存所有变更
   */
  async stageAll(): Promise<void> {
    await execAsync('git add -A', { cwd: this.sandboxPath })
  }

  /**
   * 提交代码
   */
  async commit(message: string): Promise<CommitResult> {
    await this.stageAll()
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: this.sandboxPath })
    const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd: this.sandboxPath })
    return { hash: stdout.trim(), message }
  }

  /**
   * 推送分支到远程
   */
  async push(branch?: string): Promise<string> {
    const branchArg = branch ? `-u origin ${branch}` : ''
    const { stdout } = await execAsync(`git push ${branchArg}`, { cwd: this.sandboxPath })
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

    const { stdout } = await execAsync(`gh pr create ${args.join(' ')}`, { cwd: this.sandboxPath })
    return stdout.trim()
  }

  /**
   * 获取变更的文件列表
   */
  async getChangedFiles(): Promise<string[]> {
    const { stdout } = await execAsync('git diff --name-only', { cwd: this.sandboxPath })
    const changed = stdout.trim().split('\n').filter(Boolean)

    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', { cwd: this.sandboxPath })
    const newFiles = untracked.trim().split('\n').filter(Boolean)

    return [...new Set([...changed, ...newFiles])]
  }

  /**
   * 获取当前分支名
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await execAsync('git branch --show-current', { cwd: this.sandboxPath })
    return stdout.trim()
  }

  /**
   * 获取最近的 commit 信息
   */
  async getLastCommit(): Promise<{ hash: string; message: string }> {
    const { stdout } = await execAsync('git log -1 --format="%h %s"', { cwd: this.sandboxPath })
    const [hash, ...msgParts] = stdout.trim().split(' ')
    return { hash, message: msgParts.join(' ') }
  }
}
