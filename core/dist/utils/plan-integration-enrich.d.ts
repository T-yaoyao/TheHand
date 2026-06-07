import type { FilePlan, ProjectContext } from '../types.js';
/**
 * 在方案阶段按需并入：应用路由入口（如 main.jsx）、以及 project.json 中已配置的 readContextCandidates（磁盘存在者）。
 * 仅当方案 Agent 显式声明 includeRouteEntryContext === true 时执行，避免「routes 下任意改动」误拉入口文件。
 */
export declare function enrichPlanWithIntegrationEntryFiles(plan: FilePlan[], sandboxPath: string, projectContext: ProjectContext, includeRouteEntryContext: boolean): FilePlan[];
//# sourceMappingURL=plan-integration-enrich.d.ts.map