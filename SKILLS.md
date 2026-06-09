# 插件式 Skill（加分项：抽象到位）

编排器在编码阶段会优先用 `SkillRegistry.match(结构化需求)` 命中自定义 Skill；未命中再走通用 Architect + Coding 路径。

## 新增一种需求模式时要改什么

在**具体项目目录**下（例如 `projects/<projectId>/`）新建：

```text
skills/<skill-name>/SKILL.md
```

无需修改 `CodingPhase` / `SkillRegistry` 等主干 TypeScript；重启或下次 `discover` 时会自动加载该目录下的子文件夹。

## SKILL.md 格式

- **YAML frontmatter**（`---` 包裹）：至少包含 `name`、`description`、`canHandle`
- **canHandle**：支持声明式规则字符串，例如  
  `type:add_field,add_page scope:frontend`  
  或旧式 `requirement.type === 'add_field'`
- **正文**：作为 Skill 执行时的模板 prompt，由注册表内建执行器 + `CODING_TOOLS` 生成文件

示例见：`projects/conduit/skills/add-field/SKILL.md`。

## 运行时

`orchestrator-runner` / CLI 会对 `resolveProjectsDir()/<projectId>` 调用 `skillRegistry.discover(...)`，与数据库中的项目 ID 对齐即可。
