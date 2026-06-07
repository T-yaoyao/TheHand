import type { ProjectStructure, TheHandOrphanGuard } from '../types.js';
/**
 * Vite/React 应用入口：由 HTML 拉取，通常不会被其它 JS `import`，不能按「是否被 import」判孤立。
 * 若 `project.json` 的 `thehand.orphanGuard.entrySkipGlobs` 有配置，则优先按 glob 匹配跳过。
 */
export declare function skipOrphanImportIntegrationCheck(planPath: string, guard?: TheHandOrphanGuard): boolean;
/** 归一化到「逻辑模块」键：index 桶文件、Foo/Foo.jsx 与目录名对齐 */
export declare function canonicalModuleKey(rel: string): string;
/**
 * 相对 import 是否在已知源码路径（沙箱索引 + 本轮 fileMap 键）中可解析；
 * 若否，再检查沙箱磁盘上是否存在该相对路径对应的文件（如 .css/.json 等未编入索引的扩展名）。
 */
export declare function relativeSpecifierResolvesInSandbox(sandboxPath: string, fromFilePosix: string, specifier: string, knownSourcePaths: Set<string>): Promise<boolean>;
/** 从源码行中提取相对 import / require / import() / re-export from 的路径 */
export declare function extractRelativeImportSpecifiers(content: string): string[];
/**
 * 判断 fromPlanPath 对应源码是否通过**相对路径** import 到了 targetPlanPath 所代表的模块。
 */
export declare function sourceFileImportsTargetModule(content: string, fromPlanPath: string, targetPlanPath: string, knownFiles: Set<string>): boolean;
/**
 * 在已加载的沙箱源码索引中，是否存在除「自身文件」外的其它文件通过相对 import 解析到该组件。
 */
export declare function sandboxIndexImportsComponent(index: Map<string, string>, componentPlanPath: string, _baseName: string): boolean;
/**
 * 一次性读入沙箱内候选源码（相对 sandbox 根的路径 → 内容），供多个组件复用，避免重复遍历。
 */
export declare function loadSandboxSourceContents(sandboxPath: string, structure?: ProjectStructure): Promise<Map<string, string>>;
//# sourceMappingURL=component-sandbox-import.d.ts.map