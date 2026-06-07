/**
 * 检测「带 Outlet 的布局里用相对路径 Tab/Nav，但路由表未注册嵌套 path」导致的运行时 404。
 * 纯静态规则，不依赖 LLM 提示词；与 Conduit 等 HashRouter + 顶层 <Routes> 结构兼容。
 */
import type { FilePlan, ProjectContext } from '../types.js';
export interface OutletNavRouteViolation {
    layoutPath: string;
    segment: string;
    message: string;
}
/** 从单文件 JSX 中提取「相对路径」导航段（不含 index 空串、不含绝对路径） */
export declare function extractOutletRelativeNavSegments(content: string): string[];
/** 路由表源码中是否声明了该嵌套 path（与 React Router v6 常见写法匹配） */
export declare function routeTableDeclaresSegment(routeSources: string, segment: string): boolean;
/**
 * 合并路由表文件全文（优先本轮 fileMap，否则读沙箱磁盘），用于与布局内 Tab 路径对照。
 */
export declare function loadMergedRouteTableSources(sandboxPath: string, projectContext: ProjectContext | undefined, planFiles: FilePlan[], fileMap: Map<string, {
    path: string;
    content: string;
}>): Promise<string>;
/**
 * 对本轮方案涉及的布局 + 本轮生成文件：Outlet + 相对 Tab 必须在路由表中出现对应 path，否则返回违规列表（供编码重试）。
 */
export declare function findOutletNavRouteViolations(sandboxPath: string, projectContext: ProjectContext | undefined, planFiles: FilePlan[], fileMap: Map<string, {
    path: string;
    content: string;
}>): Promise<OutletNavRouteViolation[]>;
//# sourceMappingURL=outlet-nav-route-guard.d.ts.map