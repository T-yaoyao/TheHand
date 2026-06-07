/**
 * 校验本轮 fileMap 中源码的相对 import 在沙箱（磁盘 + 本轮覆盖）下是否可解析，
 * 避免 Vite「Failed to resolve import」类错误在测试未跑 build 时漏网。
 */
import type { FilePlan, ProjectContext } from '../types.js';
export interface UnresolvedRelativeImportViolation {
    fromPath: string;
    specifier: string;
    message: string;
}
/**
 * 对本轮方案涉及的源码路径 + fileMap 产出：检查相对 import 是否均可解析（fileMap 优先，否则读沙箱磁盘）。
 */
export declare function findUnresolvedRelativeImportsInFileMap(sandboxPath: string, projectContext: ProjectContext | undefined, planFiles: FilePlan[], fileMap: Map<string, {
    path: string;
    content: string;
}>): Promise<UnresolvedRelativeImportViolation[]>;
//# sourceMappingURL=relative-import-resolve-guard.d.ts.map