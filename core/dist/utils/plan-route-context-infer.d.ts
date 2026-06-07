import type { FilePlan, StructuredRequirement } from '../types.js';
/**
 * 当方案 Agent 将 includeRouteEntryContext 置为 false，但需求与方案明显是「前端 routes 下 + 嵌套/Tab」类时，
 * 推断为 true，使首轮 coding 即并入 main/App 等上下文，减少 outlet-nav 首轮失败。
 */
export declare function inferRouteEntryContextFromRequirementAndPlan(structured: StructuredRequirement | null | undefined, plan: FilePlan[], pmInput: string | undefined): boolean;
//# sourceMappingURL=plan-route-context-infer.d.ts.map