/**
 * SSE 事件路由
 * 为前端提供实时状态推送
 */
export declare const eventsRouter: import("express-serve-static-core").Router;
export declare function getActiveConnectionCount(): number;
/**
 * 广播事件给所有订阅者
 */
export declare function broadcastEvent(event: any): void;
/**
 * 向指定需求推送事件
 */
export declare function pushEvent(requirementId: string, event: any): void;
//# sourceMappingURL=events.d.ts.map