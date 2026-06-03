import { z } from 'zod'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import type { Tool, ToolContext, ToolResult } from '../types.js'

const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bexecSync\s*\(/,
  /\brm\s+-rf\b/,
  /\bchild_process\b/,
]

/**
 * 文件写入工具
 * 不并发、写操作前备份
 */
export function createFileWriteTool(sandboxPath: string): Tool {
  return {
    name: 'file-write',
    description: '将生成的代码写入 sandbox-repo 中的指定文件',
    inputSchema: z.object({
      path: z.string().describe('相对于 sandbox-repo 的文件路径'),
      content: z.string().describe('文件完整内容'),
    }),
    isConcurrencySafe: false,
    isReadOnly: false,
    call: async (input, context): Promise<ToolResult> => {
      const fullPath = resolve(sandboxPath, input.path)

      // 路径穿越检查
      if (!fullPath.startsWith(resolve(sandboxPath))) {
        return { type: 'error', content: '路径越界：只能写入 sandbox-repo' }
      }

      // 危险代码检查
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(input.content)) {
          return { type: 'error', content: `检测到危险代码模式: ${pattern.source}` }
        }
      }

      try {
        // 备份原文件（用于回滚）
        try {
          const original = await readFile(fullPath, 'utf-8')
          await context.backupStore.save(input.path, original)
        } catch {
          // 文件不存在，备份 null
          await context.backupStore.save(input.path, null)
        }

        // 写入
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, input.content, 'utf-8')

        return { type: 'success', content: `已写入 ${input.path}` }
      } catch (e: any) {
        return { type: 'error', content: `写入失败: ${e.message}` }
      }
    },
  }
}
