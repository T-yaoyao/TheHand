---
name: add-field
description: 给 Sequelize 模型新增字段，并同步更新 API 响应
canHandle: requirement.type === 'add_field'
---

## 代码模式

### 1. Model 层（Sequelize）

读取 `backend/models/{Entity}.js`，在字段定义中新增：

```javascript
{fieldName}: {
  type: DataTypes.{fieldType},
  allowNull: true,
  defaultValue: {defaultValue}
}
```

### 2. API 层

读取 `backend/routes/{entities}.js`，确保：
- 列表接口返回新字段
- 创建/更新接口接受新字段

### 3. 前端层

读取 `frontend/src/components/{Entity}Preview.js` 和相关组件，添加展示逻辑。

## 项目上下文

当前模型定义：
!`cat projects/conduit/context/models.json`

当前路由表：
!`cat projects/conduit/context/routes.json`
