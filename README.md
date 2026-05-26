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

当前默认接入项目：[Conduit RealWorld](https://github.com/TonyMckes/conduit-realworld-example-app)（React + Express + Sequelize）。

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
- `rsync`（沙箱复制）
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

必填项：`DOUBAO_ENDPOINT`、`DOUBAO_API_KEY`、`DOUBAO_MODEL`（见 [.env.example](.env.example) 注释）。

### 3. 准备目标仓库（可选，与 TheHand 依赖无关）

跑 Orchestrator 前需自行准备 `sandbox-repo/conduit-realworld-example-app` 并在该目录内 `npm install`安装依赖。该仓库与 TheHand **分开提交**。

### 4. 运行端到端流水线（CLI）

```bash
node cli-orchestrator.mjs "给 Popular Tags 前 5 个标签加视觉标识"
```

脚本会：

1. 自动 `npm run build` 编译 `core`
2. 创建临时沙箱（`rsync` 自 `sandbox-repo`）
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

1. 左侧创建需求  
2. 选中需求后切到 **「进度」** Tab（建立 SSE）  
3. 点击 **「▶ 运行流水线」**（后端会真正执行 Orchestrator 并推送事件）

需已配置根目录 `.env`（`DOUBAO_*`），且存在 `sandbox-repo/conduit-realworld-example-app`。

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

编码阶段按方案 **逐文件** 调用 LLM（`runCoding`），避免 tool-use 循环输出无法解析。

### 沙箱与测试

- 每次需求在 `/tmp/thehand-sandbox-*` 生成隔离副本，不直接污染 `sandbox-repo`
- 复制时使用 `--exclude='/dist'`，避免误删 `node_modules/vitest/dist`
- 测试命令来自 `projects/conduit/project.json`（`lint` + `npm test -- --run`）

## 接入新项目

在 `projects/<project-id>/` 下新增：

- `project.json`：技术栈、目录结构、`commands`（lint / test）
- `context/`：模型、路由等上下文 JSON
- `skills/`（可选）：专用 Skill

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
4. 若沙箱里 `npm test` 失败而本地通过，优先检查：rsync 是否排除了 `node_modules/*/dist`、Vitest 配置是否为 ESM

## License

MIT（与 Conduit 示例项目一致；平台部分以本仓库为准）
