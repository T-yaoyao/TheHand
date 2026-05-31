import { Router } from 'express';
import { log } from '../logger.js';
/**
 * SSE 事件路由
 * 为前端提供实时状态推送
 */
export const eventsRouter = Router();
// 存储活跃的 SSE 连接（支持同一 requirement 多个标签页）
const clients = new Map();
export function getActiveConnectionCount() {
    let count = 0;
    for (const set of clients.values())
        count += set.size;
    return count;
}
/**
 * GET /api/events/:id — 订阅需求的实时事件 (SSE)
 */
eventsRouter.get('/:id', (req, res) => {
    const requirementId = req.params.id;
    // 设置 SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    // 发送初始连接确认
    res.write(`data: ${JSON.stringify({ type: 'connected', requirementId })}\n\n`);
    // 存储连接（支持多标签页）
    if (!clients.has(requirementId)) {
        clients.set(requirementId, new Set());
    }
    clients.get(requirementId).add(res);
    log.info(`[sse] 连接 requirement=${requirementId.slice(0, 8)}… (共 ${getActiveConnectionCount()} 路)`);
    // 心跳保活
    const heartbeat = setInterval(() => {
        try {
            res.write(':heartbeat\n\n');
        }
        catch { }
    }, 15000);
    // 清理
    req.on('close', () => {
        clearInterval(heartbeat);
        const set = clients.get(requirementId);
        if (set) {
            set.delete(res);
            if (set.size === 0)
                clients.delete(requirementId);
        }
        log.info(`[sse] 断开 requirement=${requirementId.slice(0, 8)}… (剩余 ${getActiveConnectionCount()} 路)`);
    });
});
/**
 * POST /api/events/:id — 推送事件给指定需求的订阅者
 * 供 Orchestrator 内部调用
 */
eventsRouter.post('/:id', (req, res) => {
    const requirementId = req.params.id;
    const event = req.body;
    const set = clients.get(requirementId);
    if (set && set.size > 0) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of set) {
            try {
                client.write(data);
            }
            catch { }
        }
        res.json({ ok: true, delivered: set.size });
    }
    else {
        res.json({ ok: true, delivered: false, message: '无活跃订阅者' });
    }
});
/**
 * 广播事件给所有订阅者
 */
export function broadcastEvent(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const [id, set] of clients) {
        for (const client of set) {
            try {
                client.write(data);
            }
            catch {
                set.delete(client);
            }
        }
        if (set.size === 0)
            clients.delete(id);
    }
}
/**
 * 向指定需求推送事件
 */
export function pushEvent(requirementId, event) {
    const set = clients.get(requirementId);
    if (set && set.size > 0) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of set) {
            try {
                client.write(data);
            }
            catch {
                set.delete(client);
            }
        }
    }
}
//# sourceMappingURL=events.js.map