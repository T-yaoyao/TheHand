/**
 * SSE 事件路由
 * 为前端提供实时状态推送
 *
 * 内存管理：
 * - 单个 requirement 最多保留 30 个 SSE 连接
 * - 心跳间隔 15s，连续 3 次无响应自动断开
 * - 定期清理已完成的 requirement 连接
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
/**
 * 标记 requirement 为已完成，清理其 SSE 连接释放内存
 */
export declare function cleanupRequirement(requirementId: string): void;
//# sourceMappingURL=events.d.ts.map