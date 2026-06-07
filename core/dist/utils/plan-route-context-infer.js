const ROUTES_SEGMENT = /(^|\/)routes\//i;
/** 与「嵌套 path / Tab / Outlet」相关的需求描述信号（避免匹配纯「新增字段」类） */
const NESTED_ROUTE_TAB_SIGNAL = /Tab|标签页|子路由|嵌套路由|嵌套\s*path|Outlet|NavItem|NavLink|同级路由|新\s*path|path\s*=\s*["']|path:\s*["']/i;
/**
 * 当方案 Agent 将 includeRouteEntryContext 置为 false，但需求与方案明显是「前端 routes 下 + 嵌套/Tab」类时，
 * 推断为 true，使首轮 coding 即并入 main/App 等上下文，减少 outlet-nav 首轮失败。
 */
export function inferRouteEntryContextFromRequirementAndPlan(structured, plan, pmInput) {
    if (!structured)
        return false;
    const scope = structured.scope ?? '';
    if (!/^(frontend|fullstack)$/i.test(scope.trim()))
        return false;
    const text = [structured.description ?? '', pmInput ?? ''].join('\n');
    if (!NESTED_ROUTE_TAB_SIGNAL.test(text))
        return false;
    const touchesRoutesPage = plan.some(f => {
        const p = f.path.replace(/\\/g, '/');
        return ROUTES_SEGMENT.test(p) && /\.(jsx|tsx)$/i.test(p);
    });
    return touchesRoutesPage;
}
//# sourceMappingURL=plan-route-context-infer.js.map