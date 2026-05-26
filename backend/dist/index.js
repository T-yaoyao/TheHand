import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initDB } from './db.js';
import { requirementsRouter } from './routes/requirements.js';
import { eventsRouter } from './routes/events.js';
import { orchestratorRouter } from './routes/orchestrator.js';
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
        const commentIdx = val.indexOf('  #');
        if (commentIdx !== -1)
            val = val.slice(0, commentIdx).trim();
        process.env[key] = val;
    }
}
catch { }
const app = express();
const PORT = process.env.PORT ?? 3001;
app.use(cors());
app.use(express.json());
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
        console.log(`TheHand backend running on http://localhost:${PORT}`);
    });
}
start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map