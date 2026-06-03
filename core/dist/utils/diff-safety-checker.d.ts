import type { DiffCheckResult, FilePlan } from '../types.js';
/**
 * 增量Diff安全检查器
 * 检测无关变更，防止AI意外修改未计划的内容
 */
export declare class DiffSafetyChecker {
    private sandboxRoot;
    constructor(sandboxRoot: string);
    check(originalFiles: Map<string, string>, plan: FilePlan[]): Promise<DiffCheckResult>;
    private findUnrelatedChanges;
    private isTrivialChange;
}
//# sourceMappingURL=diff-safety-checker.d.ts.map