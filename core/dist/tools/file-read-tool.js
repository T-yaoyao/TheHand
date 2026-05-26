import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
/**
 * 文件读取工具
 * 并发安全、只读
 */
export function createFileReadTool(sandboxPath) {
    return {
        name: 'file-read',
        description: '读取 sandbox-repo 中的文件内容',
        inputSchema: z.object({
            path: z.string().describe('相对于 sandbox-repo 的文件路径'),
        }),
        isConcurrencySafe: true,
        isReadOnly: true,
        call: async (input, _context) => {
            const fullPath = resolve(sandboxPath, input.path);
            // 路径穿越检查
            if (!fullPath.startsWith(resolve(sandboxPath))) {
                return { type: 'error', content: '路径越界：只能读取 sandbox-repo 内的文件' };
            }
            try {
                const content = await readFile(fullPath, 'utf-8');
                return { type: 'success', content };
            }
            catch (e) {
                return { type: 'error', content: `读取失败: ${e.message}` };
            }
        },
    };
}
//# sourceMappingURL=file-read-tool.js.map