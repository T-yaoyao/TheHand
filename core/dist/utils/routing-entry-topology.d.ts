/**
 * 从「应用入口」源码推断路由挂载拓扑，与仓库形态无关：
 * 若入口已内联声明 <Routes> 且未相对 import 名为 router 的模块，则方案中「尚不存在磁盘」的独立 router.* 文件
 * 视为与当前拓扑不兼容（多为模型臆造），在方案阶段剔除并把约束合并回入口项。
 */
import type { FilePlan, ProjectContext } from '../types.js';
/** 入口文件是否直接写了 React Router 的路由树（常见内联形态） */
export declare function entryFileDeclaresRoutesJsx(entrySource: string): boolean;
/**
 * 入口是否已从相对路径 import 名为 router 的兄弟模块（表示拆出路由表文件为项目既有约定）
 */
export declare function entryImportsRelativeRouterModule(entrySource: string): boolean;
/**
 * 计划中的路径是否为「与当前入口拓扑冲突的、不存在的路由表文件」。
 */
export declare function isPhantomRouteTableVersusEntryTopology(planRelPath: string, sandboxPath: string, entryRel: string | null, entrySource: string | null): boolean;
/**
 * 从方案中移除与入口拓扑冲突的「新建 router.*」项，并把说明合并到路由入口 plan 条目。
 */
export declare function sanitizePhantomRouteTablesAgainstEntryTopology(plan: FilePlan[], sandboxPath: string, projectContext: ProjectContext): FilePlan[];
//# sourceMappingURL=routing-entry-topology.d.ts.map