/**
 * 必须在其它本地模块之前 import：路由等模块会在加载时读取 THEHAND_*。
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
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
        const commentIdx = val.indexOf(' #');
        if (commentIdx !== -1)
            val = val.slice(0, commentIdx).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        process.env[key] = val;
    }
}
catch {
    /* 无 .env 时由后续 THEHAND_* 校验报错 */
}
//# sourceMappingURL=load-env.js.map