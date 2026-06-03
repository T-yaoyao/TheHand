import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const BLOCKED_COMMANDS = [
    /\brm\s+-rf\s+\/\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bmkfs\b/,
    /\bdd\b/,
];
/**
 * Shell 命令执行工具
 * 不并发、非只读
 */
export function createShellTool(sandboxPath) {
    return {
        name: 'shell',
        description: '在 sandbox-repo 目录下执行 Shell 命令（lint、test、grep 等）',
        inputSchema: z.object({
            command: z.string().describe('要执行的 Shell 命令'),
        }),
        isConcurrencySafe: false,
        isReadOnly: false,
        call: async (input) => {
            // 危险命令检查
            for (const pattern of BLOCKED_COMMANDS) {
                if (pattern.test(input.command)) {
                    return { type: 'error', content: `危险命令被拦截: ${input.command}` };
                }
            }
            try {
                const { stdout, stderr } = await execAsync(input.command, {
                    cwd: sandboxPath,
                    timeout: 60000, // 60 秒超时
                    maxBuffer: 1024 * 1024 * 5, // 5MB
                });
                const output = [stdout, stderr].filter(Boolean).join('\n');
                return { type: 'success', content: output || '(无输出)' };
            }
            catch (e) {
                return {
                    type: 'error',
                    content: `命令执行失败:\nstdout: ${e.stdout}\nstderr: ${e.stderr}\nexitCode: ${e.code}`,
                };
            }
        },
    };
}
//# sourceMappingURL=shell-tool.js.map