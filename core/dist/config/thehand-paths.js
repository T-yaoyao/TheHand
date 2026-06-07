import { dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
/**
 * TheHand 仓库根目录。
 * - 优先 `THEHAND_ROOT`（相对路径按 `process.cwd()` 解析）
 * - 否则从本文件在 `core/dist/...` 下的位置向上推导（开发 / monorepo）
 */
export function getTheHandRoot() {
    const env = process.env.THEHAND_ROOT?.trim();
    if (env) {
        return isAbsolute(env) ? env : resolve(process.cwd(), env);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    // .../core/dist/config/thehand-paths.js → 上溯到仓库根
    return resolve(here, '..', '..', '..');
}
/** `projects` 目录（必须设置 `THEHAND_PROJECTS_DIR`，相对路径相对 THEHAND_ROOT） */
export function resolveProjectsDir() {
    const root = getTheHandRoot();
    const raw = process.env.THEHAND_PROJECTS_DIR?.trim();
    if (!raw) {
        throw new Error('[thehand] 缺少必须环境变量 THEHAND_PROJECTS_DIR（示例：projects）。请见仓库根目录 .env.example');
    }
    return isAbsolute(raw) ? raw : resolve(root, raw);
}
/**
 * 沙箱「源」仓库根路径（Docker 克隆源）。
 * 必须设置 `THEHAND_SANDBOX_REPO`：绝对路径，或相对 `THEHAND_ROOT`。
 */
export function resolveSandboxRepoAbs() {
    const root = getTheHandRoot();
    const raw = process.env.THEHAND_SANDBOX_REPO?.trim();
    if (!raw) {
        throw new Error('[thehand] 缺少必须环境变量 THEHAND_SANDBOX_REPO（示例：sandbox-repo/conduit-realworld-example-app）。请见仓库根目录 .env.example');
    }
    return isAbsolute(raw) ? raw : resolve(root, raw);
}
/** 未显式传 `projectId` 时的默认项目 id（必须设置 `THEHAND_DEFAULT_PROJECT_ID`） */
export function getDefaultProjectId() {
    const id = process.env.THEHAND_DEFAULT_PROJECT_ID?.trim();
    if (!id) {
        throw new Error('[thehand] 缺少必须环境变量 THEHAND_DEFAULT_PROJECT_ID（示例：conduit）。请见仓库根目录 .env.example');
    }
    return id;
}
/** 启动时校验 THEHAND_* 已配置（后端 / CLI 应在加载业务模块前调用） */
export function assertTheHandRequiredEnv() {
    getDefaultProjectId();
    resolveSandboxRepoAbs();
    resolveProjectsDir();
}
//# sourceMappingURL=thehand-paths.js.map