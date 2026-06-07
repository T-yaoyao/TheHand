# conduit（thehand init 草稿）

- 生成时间: 2026-06-07T11:58:31.188Z
- 扫描仓库: `/root/Agent/TheHand/sandbox-repo/conduit-realworld-example-app`

## 你必须手动的部分

1. **constraints**：把路由入口、Navbar、目录约定等写进 `project.json` 的 `constraints`（见 README「接入新项目」与 prompts/plan）。
2. **thehand**：已生成模板块。`routingIntegration.enabled` 默认为 `false`；若需要 Architect 自动把「新建子页」补进顶层路由表，请改为 `true` 并按仓库调整 `routeEntryFiles`、`nestedNewPageGlob` / `nestedNewPageExcludeGlobs`。`readContextCandidates` 已按仓库内**真实存在**的 main/index/App/router 路径填充；若仍不全请手改。`recallL1` / `orphanGuard` 可按目录结构微调。
3. **commands**：若 monorepo 测试需 `-w package`，请改成与你团队一致的命令。
4. **structure / keyFiles**：若推断路径不对，直接改 JSON（并同步修正 `thehand` 里与 `structure.frontend` 相关的路径）。
5. **techStack.database**：脚本会读 `.env*` 里 `DATABASE_URL` 协议前缀、`DB_DIALECT` 及 `mysql2`/`pg` 等依赖；若仓库只用 docker-compose 或 CI 密钥注入而无本地 .env，可能推断失败，请手改。

删除本说明文件不影响加载；TheHand 只读取 `project.json` 与可选 `context/*.json`。
