import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export type CommandExecutor = (
  command: string,
  options?: { timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>

export function createHostExecutor(cwd: string): CommandExecutor {
  return (command, options) =>
    execAsync(command, {
      cwd,
      timeout: options?.timeout ?? 120_000,
      maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
    })
}
