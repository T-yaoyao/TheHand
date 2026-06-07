# TheHand

PM 用自然语言描述需求，系统自动完成澄清、方案、编码、测试，并将变更写回目标仓库。开发者主要做 PR Review。

> Claude Code 面向开发者；TheHand 面向 **PM 驱动的交付流水线**。

## 能做什么

```
PM 输入一句话
  → 澄清需求（结构化 JSON）
  → 生成技术方案（改哪些文件）
  → 在隔离沙箱里写代码
  → lint + 单测
  → 通过后提交并同步回模板仓库
```

当前默认接入项目：[Conduit RealWorld](https://github.com/TonyMckes/conduit-realworld-example-app)（React + Express + Sequelize）。沙箱源目录、默认 `projectId` 与 `projects` 路径由 **必填** 环境变量 `THEHAND_*`（及前端的 `VITE_THEHAND_DEFAULT_PROJECT_ID`）指定，见 [.env.example](.env.example)。

## 仓库结构

TheHand 与目标业务仓库 **分开维护、分开提交**：

```
TheHand/                          # 本平台（本仓库）
├── core/                         # 调度引擎、Agent、沙箱、LLM 客户端
├── backend/                      # Web API + SSE
├── frontend/                     # PM 对话界面
├── prompts/                      # Agent Prompt 模板（版本化）
├── projects/                     # 接入项目配置（如 conduit）
├── cli-orchestrator.mjs          # 端到端 CLI（推荐）
├── cli.mjs                       # 分步调试 CLI
├── logs/                         # 运行日志（gitignore）
└── sandbox-repo/                 # 目标仓库本地副本（gitignore，独立 git）
    └── conduit-realworld-example-app/
```

| 仓库 | 说明 |
|------|------|
| **TheHand** | 平台代码、Prompt、Orchestrator |
| **sandbox-repo/conduit-…** | 被改动的业务项目，有自己的 `git` 历史 |

## 环境要求

- Node.js >= 18
- ~~`rsync`~~（已用 Node.js 原生实现替代，不再需要）
- 豆包 / 火山方舟 OpenAI 兼容 API（或其它兼容端点）

## 快速开始

### 1. 安装依赖（TheHand 一键）

根目录使用 npm workspaces，**一次安装** `core`、`backend`、`frontend` 三个子包（不含 `sandbox-repo`）：

```bash
# 推荐：安装依赖并编译 core（CLI / Orchestrator 需要 dist）
npm run setup

# 仅安装依赖
npm install
# 或
npm run install:all
```

编译 core：

```bash
npm run build:core
```

### 2. 配置 LLM

复制示例并填写密钥（`.env` 勿提交）：

```bash
cp .env.example .env
```

必填项：

- **LLM**：`DOUBAO_ENDPOINT`、`DOUBAO_API_KEY`、`DOUBAO_MODEL`
- **TheHand 路径**（已写在 [.env.example](.env.example) 的 Conduit 默认值，换项目请改）：`THEHAND_SANDBOX_REPO`、`THEHAND_PROJECTS_DIR`、`THEHAND_DEFAULT_PROJECT_ID`、`VITE_THEHAND_DEFAULT_PROJECT_ID`（须与 `THEHAND_DEFAULT_PROJECT_ID` 一致）

可选：`THEHAND_ROOT`、`SANDBOX_*`、`THEHAND_DISABLE_REGRESSION_GUARD` 等（见示例文件注释）。

### 3. 准备目标仓库（可选，与 TheHand 依赖无关）

跑 Orchestrator 前需在 `THEHAND_SANDBOX_REPO` 指向的目录（默认 `sandbox-repo/conduit-realworld-example-app`）内执行 `npm install`。该业务仓库与 TheHand **分开提交**。

### 4. 运行端到端流水线（CLI）

```bash
node cli-orchestrator.mjs "给 Popular Tags 前 5 个标签加视觉标识"
```

脚本会：

1. 自动 `npm run build` 编译 `core`
2. 创建临时沙箱（Node.js 递归复制自 `sandbox-repo`，排除 node_modules 后在沙箱内重新 `npm install`）
3. 跑完整 Orchestrator
4. 在 `logs/` 写入运行日志

### 5. 启动 Web 界面

```bash
# 终端 1：API + Orchestrator
npm run dev:backend

# 终端 2：前端
npm run dev:frontend
```

浏览器打开 http://localhost:5173 ：

1. 左侧输入需求并提交（会自动选中、打开 **「进度」** Tab 并启动流水线，建立 SSE）  
2. 在 **「方案」** Tab 审批方案后继续；**「对话」** Tab 用于澄清追问回复  

需已配置根目录 `.env`：`DOUBAO_*`、**`THEHAND_*` 与 `VITE_THEHAND_DEFAULT_PROJECT_ID`**（见 [.env.example](.env.example)），且 `THEHAND_SANDBOX_REPO` 指向的目录存在并已安装依赖。需要手动重跑时仍可使用 **「运行流水线」**。

## 核心模块（`core/`）

| 模块 | 职责 |
|------|------|
| `orchestrator/` | 状态机：澄清 → 方案 → 编码 → 测试 → 提交 |
| `agents/` | clarification / plan / coding Agent |
| `llm/` | LLM 调用、Token 统计、成本估算 |
| `git-ops/` | 沙箱复制、测试运行、git commit |
| `skill-registry/` | 可插拔 Skill（匹配结构化需求） |
| `tools/` | file-read / file-write / shell |
| `memory/` | 需求与项目上下文 |

### 流水线阶段

```
sandbox-create → clarifying → planning → coding → testing → commit → apply-to-source
```

编码阶段按方案 **逐文件** 调用 LLM（`runCoding`），避免 tool-use 循环输出无法解析。编码 prompt 会附带 **L1 关联上下文**（基于相对 import 图、反向 2 跳、正向 1 跳与入口前向 BFS 拉取少量方案外源文件全文），入口候选与浅层路由目录可由 `projects/<id>/project.json` 的 `thehand.recallL1` 配置。写入沙箱前会对 `.jsx`/`.tsx`/`.vue` 做 **退化检测**（例如丢失 `useState`/`useEffect` 或正文较磁盘原版异常变短），命中则自动带说明重试；可用环境变量 `THEHAND_DISABLE_REGRESSION_GUARD=1` 关闭（不推荐）。另对「新建组件未被任何相对 import 引用」做校验；`thehand.orphanGuard.entrySkipGlobs` 与内置规则会排除 Vite/React 入口等不由相对 import 挂载的文件。**`router.jsx` / `router.tsx` 等顶层路由表**由编排器识别为「应由 `main`/`App` 等入口挂接」：Architect 会自动把 `routingIntegration.routeEntryFiles` / `recallL1.entryCandidates` 中解析到的入口加入分批与说明，孤儿重试提示也会指向该入口而非 `routes/` 下的页面组件。

**Outlet + Tab 与路由表一致**：编码写入前对本轮 `fileMap` 做静态检查——若某文件同时含 `<Outlet>` 与相对路径的 `<NavItem url="…">` / `<NavLink to="…">`（非 `/` 开头），则在合并后的路由入口源码（`main.jsx`、`router.*` 等）中查找 `path="…"` 的 `<Route>`；缺失则阻断并重试（与「孤儿组件」同级），避免「Tab 能点、子路由未注册」的运行期 404。可用 `THEHAND_DISABLE_OUTLET_NAV_GUARD=1` 关闭（不推荐）。

**相对 import 可解析**：对本轮 **方案文件 ∪ fileMap** 的源码做静态检查（fileMap 优先，否则读沙箱磁盘），提取相对路径 `import` 并在「沙箱索引 ∪ fileMap」上解析；无法解析则阻断并重试。若报错文件原不在方案中，编排器会把 **import 所在路径** 并入后续轮次的临时 plan。**outlet-nav（Tab 与 Route 不一致）** 重试时则并入 **`collectRouteIntegrationContextPaths`** 解析到的一组路径（`routeEntryFiles`、应用入口、`recallL1.entryCandidates` 中的入口名、`readContextCandidates` 中至多 3 条、以及常见的 `frontend/src/App.*`），避免只塞 `main.jsx` 而遗漏实际写 `<Route>` 的文件。另建议在 `project.json` 的 `commands.build` 中配置 **`npm run build -w frontend`** 等。可用 `THEHAND_DISABLE_RELATIVE_IMPORT_GUARD=1` 关闭（不推荐）。

**职责划分**：**方案 Agent**（`prompts/plan/v1.md`）保证「新建东西时别把挂载点漏进 `files`」，并通过 **`includeRouteEntryContext`**（布尔）声明是否需要在编码前**自动并入**应用入口与 `readContextCandidates`；仅在为新 path/Tab/Outlet 等做挂载对齐时置 `true`，纯页面内改动置 `false`。**编排与 `component-sandbox-import` 等静态规则**保证不把「桶文件 + 实现文件」等已有结构误判为孤儿。二者互补，单一侧无法单独「彻底」覆盖所有仓库形态。

**方案阶段按需补文件**：在 `resolvePlanToExistingFiles` 与路由拓扑清理之后，若方案 JSON 中 **`includeRouteEntryContext` 为 `true`**，编排器调用 `plan-integration-enrich`：**并入** `pickApplicationEntryForRouteTable` 解析到的应用入口（如 `frontend/src/main.jsx`），以及磁盘存在的 `thehand.readContextCandidates`（至多 3 条），减少「方案只列子页、入口从未进 batch」。若模型填 `false`，但 **`plan-route-context-infer`** 根据「frontend/fullstack + 需求含 Tab/嵌套/Outlet 等 + 方案含 `routes/**/*.jsx|tsx`」判定为嵌套路由类，则**仍视为 `true`** 并并入，使首轮编码即带入口上下文。为 `false` 且未命中推断时不并入；**仍须在 `files` 中列出所有确实要改动的挂载点文件**。

### 沙箱与测试

- 每次需求在 `/tmp/thehand-sandbox-*` 生成隔离副本，不直接污染 `sandbox-repo`
- 复制时使用 `--exclude='/dist'`，避免误删 `node_modules/vitest/dist`
- 测试命令来自 `projects/conduit/project.json`（`lint` + 非空的 **`build`**（如 `npm run build -w frontend`）+ **`npm test`**：在沙箱根目录执行；`build` 通过后再跑单测，可捕获入口 import 等 Vite 级错误；勿在 `project.json` 里写裸 `vitest`）

## 接入新项目

在 `projects/<project-id>/` 下新增：

- `project.json`：技术栈、目录结构、`commands`（lint / test）、**`constraints`**（方案/编码须遵守的挂载与路由约定）、**`thehand`**（可选：`routingIntegration` 路由表自动补全、`recallL1` L1 入口候选、`orphanGuard` 孤儿检测跳过 glob、`readContextCandidates` 追加编码上下文文件）
- `context/`：模型、路由等上下文 JSON（可选；缺省则为空对象）
- `skills/`（可选）：专用 Skill

**草稿生成**：在 TheHand 仓库根目录执行  
`npm run thehand:init -- --repo /path/to/目标应用 [--id 项目id] [--force]`  
会读取目标仓库的 `package.json`、探测 Vitest/Jest 配置与常见目录，并尝试读取 **`.env*`**（如 `DATABASE_URL` 协议、`DB_DIALECT`）与 **依赖名**（`mysql2`、`pg` 等）推断 `techStack.database`，生成本仓库下 `projects/<id>/project.json`（含 **`thehand` 模板**：`routingIntegration` 默认 `enabled: false`，需按项目改 glob/入口后再打开）、`INIT.generated.md`；**`constraints` 与 `thehand` 细节仍须人工核对**（无 `.env` 或仅用运行时注入时推断可能失败）。

Orchestrator 通过 `projectId` 加载配置，核心代码无需修改。

## 常用命令

```bash
# 首次 / 依赖变更后
npm run setup

# 端到端（cli 内会自动 build core，也可先 npm run build:core）
node cli-orchestrator.mjs "需求描述"

# 分步调试 Agent
node cli.mjs "需求描述"

# 平台测试
npm test  #暂时未写测试用例
```

## Prompt 版本

```
prompts/
├── clarification/v1.md
├── plan/v1.md
├── coding/v1.md
└── test/v1.md
```

修改 Prompt 后无需改代码，重启 CLI 即可（`PromptManager` 按路径加载）。

## Token 与成本

`LLMClient.getStats()` 按豆包标准推理定价估算（元/百万 tokens，输入 ≤32k）：

- 输入：0.6 元/百万 tokens
- 输出：3.6 元/百万 tokens

CLI 结束时会打印 Token 统计与预估成本（`¥`）。

## 文档

- [PRD.md](文档/PRD.md) — 产品需求
- [技术路线.md](文档/技术路线.md) — 架构与实现
- [实现周期计划.md](文档/实现周期计划.md) — 里程碑

## 注意事项

1. **不要**在 TheHand 仓库里提交 `sandbox-repo/`（已在 `.gitignore`）
2. **不要**提交 `.env`
3. Conduit 的 `package.json` / `vitest.config.js` 等测试配置变更，应在 **conduit 仓库** 内单独提交
4. 若沙箱里 `npm test` 失败而本地通过，优先检查：沙箱是否排除了 `node_modules/*/dist`、Vitest 配置是否为 ESM

## License

MIT（与 Conduit 示例项目一致；平台部分以本仓库为准）
