# TheHand

## 项目简介

TheHand 是一个面向 PM 的自动化交付平台：用自然语言描述需求后，系统自动完成澄清、方案、编码、测试，并将变更写回目标仓库，开发者主要做 PR Review。

默认接入示例项目：[Conduit RealWorld](https://github.com/TonyMckes/conduit-realworld-example-app)（React + Express + Sequelize）。TheHand 平台代码与目标业务仓库分开维护、分开提交。

## 依赖环境

| 依赖 | 要求 |
|------|------|
| Node.js | >= 18 |
| npm | 支持 workspaces（随 Node 自带） |
| Docker | 运行隔离沙箱与测试（需已安装并可用） |
| Git / gh CLI | 可选；测试通过后自动 push 并创建 PR 时需要 `gh` 已登录 |

## 启动步骤

### 1. 安装依赖

```bash
npm run setup
```

该命令会安装 `core`、`backend`、`frontend` 三个子包依赖，并编译 `core`。

### 2. 配置环境变量

```bash
cp .env.example .env
```

按下方「配置说明」填写 `.env`（含 LLM API Key）。

### 3. 准备目标仓库

在 `THEHAND_SANDBOX_REPO` 指向的目录（默认 `sandbox-repo/conduit-realworld-example-app`）中安装业务依赖：

```bash
cd sandbox-repo/conduit-realworld-example-app && npm install
```

### 4. 启动 Web 界面（推荐）

```bash
# 终端 1：后端 API + Orchestrator
npm run dev:backend

# 终端 2：前端
npm run dev:frontend
```

浏览器访问 http://localhost:5173 ，在左侧输入需求并提交即可启动流水线。

### 5. CLI 端到端（可选）

```bash
node cli-orchestrator.mjs "给 Popular Tags 前 5 个标签加视觉标识"
```

## 目录结构

```
TheHand/
├── core/                 # 调度引擎、Agent、沙箱、LLM 客户端
├── backend/              # Web API + SSE
├── frontend/             # PM 对话界面
├── prompts/              # Agent Prompt 模板（按版本管理）
├── projects/             # 接入项目配置（如 conduit/project.json）
├── scripts/              # 辅助脚本（如 thehand:init）
├── cli-orchestrator.mjs  # 端到端 CLI
├── cli.mjs               # 分步调试 CLI
├── .env.example          # 环境变量示例
├── data/                 # 运行时数据（如 LLM 调用日志）
├── logs/                 # 运行日志
└── sandbox-repo/         # 目标业务仓库本地副本（独立 git，勿提交到 TheHand）
    └── conduit-realworld-example-app/
```

## 配置说明

所有配置通过仓库根目录的 **`.env`** 读取（由 `.env.example` 复制而来，**勿提交 `.env`**）。

### 必填

| 变量 | 说明 |
|------|------|
| `DOUBAO_ENDPOINT` | LLM API 地址（火山方舟 / 豆包 OpenAI 兼容 Chat Completions） |
| `DOUBAO_API_KEY` | LLM API Key |
| `DOUBAO_MODEL` | 推理接入点 ID（控制台「在线推理」中的 Endpoint ID） |
| `THEHAND_SANDBOX_REPO` | 目标业务仓库本地路径，默认 `sandbox-repo/conduit-realworld-example-app` |
| `THEHAND_PROJECTS_DIR` | 项目配置目录，默认 `projects` |
| `THEHAND_DEFAULT_PROJECT_ID` | 默认项目 ID，默认 `conduit` |
| `VITE_THEHAND_DEFAULT_PROJECT_ID` | 前端可见，须与 `THEHAND_DEFAULT_PROJECT_ID` 一致 |

### 常用可选

| 变量 | 说明 | 默认 |
|------|------|------|
| `THEHAND_ROOT` | TheHand 根目录；不设则从 `@thehand/core` 推导 | — |
| `PORT` | 后端监听端口 | `3001` |
| `SANDBOX_NETWORK` | Docker 沙箱网络：`none` / `bridge` | `none` |
| `SANDBOX_MEMORY` | 沙箱内存限制 | `1g` |
| `SANDBOX_CPUS` | 沙箱 CPU 限制 | `1.0` |
| `THEHAND_DISABLE_AUTO_PUSH_PR` | 设为 `1` 时跳过自动 push / 创建 PR | — |
| `THEHAND_PR_BASE` | 自动 PR 的目标分支 | `main` |

更多开关与说明见 [.env.example](.env.example)。

## API Key 配置位置

均在 **仓库根目录 `.env`** 中配置（由 [.env.example](.env.example) 复制，**勿提交 `.env`**）。

**LLM（必填）**

```env
DOUBAO_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/chat/completions
DOUBAO_API_KEY=你的火山方舟_API_Key
DOUBAO_MODEL=你的推理接入点_Endpoint_ID
```

**GitHub PR（可选）**

```env
GITHUB_TOKEN=ghp_你的_Personal_Access_Token
```

- 创建 PR 时优先使用 `GITHUB_TOKEN`（需 `repo` 权限）
- 未配置时回退到本机 `gh auth login` + `gh auth setup-git`
- **请勿**将 `.env` 提交到 Git；仅提交 `.env.example`（不含真实密钥）
