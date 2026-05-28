import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export function createHostExecutor(cwd) {
    return (command, options) => execAsync(command, {
        cwd,
        timeout: options?.timeout ?? 120_000,
        maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
    });
}
//# sourceMappingURL=executor.js.map