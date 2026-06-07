/**
 * TheHand 仓库根目录。
 * - 优先 `THEHAND_ROOT`（相对路径按 `process.cwd()` 解析）
 * - 否则从本文件在 `core/dist/...` 下的位置向上推导（开发 / monorepo）
 */
export declare function getTheHandRoot(): string;
/** `projects` 目录（必须设置 `THEHAND_PROJECTS_DIR`，相对路径相对 THEHAND_ROOT） */
export declare function resolveProjectsDir(): string;
/**
 * 沙箱「源」仓库根路径（Docker 克隆源）。
 * 必须设置 `THEHAND_SANDBOX_REPO`：绝对路径，或相对 `THEHAND_ROOT`。
 */
export declare function resolveSandboxRepoAbs(): string;
/** 未显式传 `projectId` 时的默认项目 id（必须设置 `THEHAND_DEFAULT_PROJECT_ID`） */
export declare function getDefaultProjectId(): string;
/** 启动时校验 THEHAND_* 已配置（后端 / CLI 应在加载业务模块前调用） */
export declare function assertTheHandRequiredEnv(): void;
//# sourceMappingURL=thehand-paths.d.ts.map