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
  missingPlannedFiles?: string[]
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
   * Diff 检查：检测是否有预期外的文件变更，同时校验所有计划内文件都已变更
   */
  async diffCheck(expectedFiles: string[]): Promise<DiffCheckResult> {
    try {
      const { stdout: diffFiles } = await this.executor('git diff --name-only')
      const changedFiles = diffFiles.trim().split('\n').filter(Boolean)

      // 也检查未跟踪的新文件
      const { stdout: untracked } = await this.executor('git ls-files --others --exclude-standard')
      const newFiles = untracked.trim().split('\n').filter(Boolean)

      const allChanged = [...new Set([...changedFiles, ...newFiles])]
      // 正向校验：不多改一个文件
      const unexpectedFiles = allChanged.filter(f => !expectedFiles.includes(f))
      // 反向校验：不少改一个文件
      const missingPlannedFiles = expectedFiles.filter(f => !allChanged.includes(f))

      // 获取 diff 统计
      let diffSummaryParts: string[] = []
      try {
        const { stdout: stat } = await this.executor('git diff --stat')
        diffSummaryParts.push(stat.trim())
      } catch {}
      if (unexpectedFiles.length > 0) {
        diffSummaryParts.push(`⚠️ 检测到 ${unexpectedFiles.length} 个不在计划内的变更文件: ${unexpectedFiles.join(', ')}`)
      }
      if (missingPlannedFiles.length > 0) {
        diffSummaryParts.push(`❌ 检测到 ${missingPlannedFiles.length} 个计划文件未产生任何变更: ${missingPlannedFiles.join(', ')}`)
      }
      const diffSummary = diffSummaryParts.join('\n')

      return {
        hasUnexpectedChanges: unexpectedFiles.length > 0 || missingPlannedFiles.length > 0,
        unexpectedFiles,
        missingPlannedFiles,
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
   *
   * @param message       commit 消息
   * @param specificFiles 可选，指定要 stage 的文件列表。不传则 stage 全部（向后兼容）
   */
  async commit(message: string, specificFiles?: string[]): Promise<CommitResult> {
    if (specificFiles && specificFiles.length > 0) {
      // 精确 stage：只添加指定文件，避免沙箱累积的无关变更被误提交
      await this.stageFiles(specificFiles)
    } else {
      await this.stageAll()
    }

    // 检查是否有 staged 变更，避免 "nothing to commit" 错误
    const { stdout: status } = await this.executor('git diff --cached --name-only')
    if (status.trim() === '') {
      console.log('[repo-manager] 无 staged 变更，跳过 commit')
      const { stdout: head } = await this.executor('git rev-parse --short HEAD')
      return { hash: head.trim(), message: '(no changes)' }
    }

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
