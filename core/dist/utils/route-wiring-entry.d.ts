import type { ProjectContext } from '../types.js';
export declare function isRouteTableModulePath(relPath: string): boolean;
/**
 * 解析「应挂载 router.jsx 路由表」的应用入口路径（磁盘上须存在）。
 * 优先 project.json 的 routingIntegration.routeEntryFiles、recallL1.entryCandidates，再常见默认路径。
 */
export declare function pickApplicationEntryForRouteTable(sandboxPath: string, projectContext: ProjectContext | undefined): string | null;
/**
 * 磁盘上存在的、可能参与路由声明或须与 Tab/Outlet 对齐的上下文文件（与 outlet-nav 合并路由源、plan-enrich 的入口维度对齐）。
 * 用于 outlet-nav / 类似静态 guard 重试时一并并入 plan，避免只注入 main 而遗漏实际写 Route 的 App.jsx。
 */
export declare function collectRouteIntegrationContextPaths(sandboxPath: string, projectContext: ProjectContext | undefined): string[];
//# sourceMappingURL=route-wiring-entry.d.ts.map