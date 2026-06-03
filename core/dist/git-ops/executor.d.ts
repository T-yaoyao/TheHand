export type CommandExecutor = (command: string, options?: {
    timeout?: number;
    maxBuffer?: number;
}) => Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function createHostExecutor(cwd: string): CommandExecutor;
//# sourceMappingURL=executor.d.ts.map