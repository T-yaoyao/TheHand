import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm, cp, mkdir, readdir, stat, copyFile, readlink, symlink } from 'fs/promises'
import { join, relative, dirname, resolve } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)

/**
 * 递归复制目录，排除指定文件夹（替代 rsync）
 */
async function copyDirRecursive(src: string, dest: string, excludeDirs: Set<string>): Promise<void> {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (excludeDirs.has(entry.name)) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      // 重新创建符号链接（Windows junction/symlink 兼容）
      const target = await readlink(srcPath)
      await symlink(target, destPath)
    } else if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, excludeDirs)
    } else {
      try {
        await copyFile(srcPath, destPath)
      } catch (e: any) {
        if (e.code === 'EPERM' || e.code === 'EBUSY') {
          // 跳过被锁定的文件（Windows 上 npm 的常见问题）
          continue
        }
        throw e
      }
    }
  }
}

/**
 * 对比两个目录的差异（替代 diff -rq）
 */
async function diffDirs(dir1: string, dir2: string, excludeDirs: Set<string>, base = ''): Promise<string> {
  let result = ''
  const entries1 = await readdir(dir1, { withFileTypes: true }).catch(() => [])
  for (const entry of entries1) {
    if (excludeDirs.has(entry.name)) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    const p1 = join(dir1, entry.name)
    const p2 = join(dir2, entry.name)
    const exists = await stat(p2).then(() => true).catch(() => false)
    if (entry.isDirectory()) {
      if (!exists) {
        result += `Only in ${dir1}: ${entry.name}\n`
      } else {
        result += await diffDirs(p1, p2, excludeDirs, rel)
      }
    } else {
      if (!exists) {
        result += `Only in ${dir1}: ${entry.name}\n`
      }
    }
  }
  const entries2 = await readdir(dir2, { withFileTypes: true }).catch(() => [])
  for (const entry of entries2) {
    if (excludeDirs.has(entry.name)) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    const p1 = join(dir1, entry.name)
    const p2 = join(dir2, entry.name)
    const exists = await stat(p1).then(() => true).catch(() => false)
    if (!exists) {
      if (entry.isDirectory()) {
        result += `Only in ${dir2}: ${entry.name}\n`
      } else {
        result += `Only in ${dir2}: ${entry.name}\n`
      }
    }
  }
  return result
}

export interface Sandbox {
  /** 沙箱工作目录（完整副本） */
  path: string
  /** 清理沙箱 */
  cleanup(): Promise<void>
}

/**
 * 沙箱管理器
 *
 * 每次需求执行时创建隔离的 sandbox 副本，执行完丢弃。
 * 保证原始 sandbox-repo 永远不被污染。
 *
 * 对标 Claude Code 的沙箱执行机制
 */
export class SandboxManager {
  private activeSandboxes: Map<string, Sandbox> = new Map()

  constructor(
    /** 原始仓库路径（模板） */
    private sourcePath: string,
    /** 沙箱临时目录父路径 */
    private tempBase: string = join(tmpdir(), 'thehand-sandbox'),
  ) {}

  /**
   * 创建沙箱：复制原始仓库到临时目录
   */
  async create(id?: string): Promise<Sandbox> {
    const sandboxId = id ?? randomUUID().slice(0, 8)
    await mkdir(this.tempBase, { recursive: true })

    // mkdtemp 保证目录名唯一
    const sandboxPath = await mkdtemp(join(this.tempBase, `sandbox-${sandboxId}-`))

    // 复制仓库（排除 .git、dist/build 构建产物、node_modules）
    await copyDirRecursive(this.sourcePath, sandboxPath, new Set(['.git', 'dist', 'build', 'node_modules']))

    // 重新安装依赖
    await execAsync('npm install --ignore-scripts', { cwd: sandboxPath })

    // 在沙箱中初始化 git（支持 diff、commit 等操作）
    // 必须配置 user.name/user.email，否则 Windows 上 commit 会失败
    await execAsync(
      'git init && git config user.email "thehand@sandbox" && git config user.name "TheHand Sandbox" && git add -A && git commit -m "initial snapshot" --allow-empty',
      { cwd: sandboxPath },
    )

    const sandbox: Sandbox = {
      path: sandboxPath,
      cleanup: async () => {
        await rm(sandboxPath, { recursive: true, force: true })
        this.activeSandboxes.delete(sandboxId)
      },
    }

    this.activeSandboxes.set(sandboxId, sandbox)
    return sandbox
  }

  /**
   * 在沙箱中执行命令
   */
  async execInSandbox(sandbox: Sandbox, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: sandbox.path,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (e: any) {
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
        exitCode: e.code ?? 1,
      }
    }
  }

  /**
   * 获取沙箱相对于原始仓库的 diff
   */
  async getDiff(sandbox: Sandbox): Promise<string> {
    try {
      return await diffDirs(this.sourcePath, sandbox.path, new Set(['node_modules', '.git', 'dist', 'build']))
    } catch {
      return ''
    }
  }

  /**
   * 将沙箱中的变更应用回原始仓库（只有验证通过才调用）
   * 复制文件后在源仓库中 git add + commit
   */
  async applyToSource(sandbox: Sandbox, files: string[], commitMessage?: string): Promise<void> {
    // 1. 复制文件
    for (const file of files) {
      const src = join(sandbox.path, file)
      const dest = join(this.sourcePath, file)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(src, dest)
    }

    // 2. 在源仓库中提交（只 stage 本次 apply 的文件，避免误提交源仓库累积的无关变更）
    if (commitMessage) {
      try {
        const resolvedSource = resolve(this.sourcePath)
        const stageArgs = files
          .map(f => resolve(this.sourcePath, f))
          .filter(f => f.startsWith(resolvedSource))
          .map(f => relative(this.sourcePath, f))
        if (stageArgs.length > 0) {
          await execAsync(`git add -- ${stageArgs.map(f => `"${f}"`).join(' ')}`, { cwd: this.sourcePath })
        }
        // 检查 staged 区是否有内容
        const { stdout: staged } = await execAsync('git diff --cached --name-only', { cwd: this.sourcePath })
        if (!staged.trim()) {
          return
        }
        await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: this.sourcePath })
      } catch (e: any) {
        // 如果没有变更（nothing to commit），忽略错误
        if (!e.message?.includes('nothing to commit')) {
          throw e
        }
      }
    }
  }

  /**
   * 清理所有活跃沙箱
   */
  async cleanupAll(): Promise<void> {
    await Promise.all(
      Array.from(this.activeSandboxes.values()).map(s => s.cleanup())
    )
  }

  /**
   * 获取活跃沙箱数量
   */
  getActiveCount(): number {
    return this.activeSandboxes.size
  }
}
