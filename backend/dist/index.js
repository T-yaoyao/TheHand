import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initDB } from './db.js';
import { requirementsRouter } from './routes/requirements.js';
import { eventsRouter } from './routes/events.js';
import { orchestratorRouter } from './routes/orchestrator.js';
import { log } from './logger.js';
// 加载 .env
try {
    const envPath = resolve(process.cwd(), '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1)
            continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        // 去除行内注释（# 前至少一个空格）
        const commentIdx = val.indexOf(' #');
        if (commentIdx !== -1)
            val = val.slice(0, commentIdx).trim();
        // 去除首尾引号
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        process.env[key] = val;
    }
}
catch { }
const app = express();
const PORT = process.env.PORT ?? 3001;
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
});
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/requirements', requirementsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/orchestrator', orchestratorRouter);
// 启动
async function start() {
    await initDB();
    app.listen(PORT, () => {
        log.info(`TheHand backend running on http://localhost:${PORT}`);
        log.info(`数据目录: ${resolve(process.cwd(), '..', 'data')}`);
    });
}
start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map