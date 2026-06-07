import type { ProjectContext, ProjectStructure } from '../types.js';
/** 列出沙箱内待建图的全部源码相对路径（去重） */
export declare function listSandboxSourceRelPaths(sandboxPath: string, structure?: ProjectStructure): Promise<string[]>;
/**
 * 生成注入到编码 prompt 的 L1 段落（Markdown）。
 * @param seedPaths 方案中的相对路径；分批编码时传本 batch 文件即可。
 */
export declare function formatL1RecallSection(sandboxPath: string, projectContext: ProjectContext | undefined, seedPaths: string[]): Promise<string>;
//# sourceMappingURL=recall-l1.d.ts.map