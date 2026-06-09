import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * 从构建/测试错误输出中提取涉及的源码文件路径，并读取其内容
 * 共享模块：orchestrator.ts 和 testing-phase.ts 共用
 *
 * 只提取项目源码文件，排除 node_modules、工具内部文件、堆栈帧
 * 返回 {path, content}[] 供 coding agent 作为上下文参考
 */
export async function extractAndReadErrorFiles(
  errorOutput: string,
  sandboxPath: string,
): Promise<{ path: string; content: string }[]> {
  const filePaths = extractErrorFilePaths(errorOutput)

  const results: { path: string; content: string }[] = []

  for (const filePath of filePaths) {
    // 尝试多个可能的基础路径
    const candidates = [
      join(sandboxPath, 'frontend', filePath),
      join(sandboxPath, 'backend', filePath),
      join(sandboxPath, filePath),
    ]
    for (const fullPath of candidates) {
      try {
        const content = await readFile(fullPath, 'utf-8')
        results.push({ path: filePath, content })
        break
      } catch {
        // 文件不存在，尝试下一个候选路径
      }
    }
  }

  return results
}

/**
 * 从错误输出中提取项目源码文件路径（纯解析，不读文件）
 */
export function extractErrorFilePaths(errorOutput: string): Set<string> {
  const filePaths = new Set<string>()

  const patterns = [
    // Vite/Rollup 错误行: "src/agent.js (2:9): "getToken" is not exported..."
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:jsx|tsx|ts|js|vue))\s*\(\d+:\d+\):/g,
    // TypeScript 错误: src/foo.ts(10,5): error TS2322
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s(]+\.(?:jsx|tsx|ts|js|vue))\(\d+,\d+\):\s*error/g,
    // ESLint 错误: src/foo.js:10:5: error
    /(?:^|\n)\s*((?:src|app|lib)\/[^\s:]+\.(?:jsx|tsx|ts|js|vue)):\d+:\d+:\s*(?:error|warning)/g,
    // file: 行中的项目源码路径
    /file:\s*\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:()]+\.(?:jsx|tsx|ts|js|vue))/g,
    // 沙箱绝对路径（通用匹配）
    /\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:()]+\.(?:jsx|tsx|ts|js|vue))/g,
    // 错误信息中引用的文件
    /(?:is not exported by|is not declared in|Cannot find module|Module not found)[^"']*["']((?:src|app|lib)\/[^"']+\.(?:jsx|tsx|ts|js|vue))["']/gi,
    // imported by 引用
    /imported by\s+["']((?:src|app|lib)\/[^"']+\.(?:jsx|tsx|ts|js|vue))["']/gi,
    // 绝对路径中的项目源码（含行号）
    /(?:^|\s)\/sandbox\/[^/]+\/((?:src|app|lib)\/[^\s:()]+\.(?:jsx|tsx|ts|js|vue)):\d+/g,
    // 带 frontend/ 或 backend/ 前缀的相对路径
    /(?:^|\n)\s*(?:(?:frontend|backend)\/)((?:src|app|lib)\/[^\s(]+\.(?:jsx|tsx|ts|js|vue))\s*\(\d+:\d+\):/g,
  ]

  const EXCLUDE_PATTERNS = [
    /node_modules[\\/]/,
    /rollup[\\/]dist[\\/]/,
    /vite[\\/]dist[\\/]/,
    /parseAst\.js$/,
    /node-entry\.js$/,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(errorOutput)) !== null) {
      const filePath = match[1].replace(/^\//, '')
      if (EXCLUDE_PATTERNS.some(p => p.test(filePath))) continue
      const normalized = filePath.replace(/^(?:frontend|backend)\//, '')
      filePaths.add(normalized)
    }
  }

  return filePaths
}
