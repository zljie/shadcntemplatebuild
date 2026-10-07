# 页面模型扩展（借鉴 Puck）

2026-10-07 加入，参考 Puck 的 Data Migration、Permissions、Root Configuration、AI Configuration、Dynamic Fields。

## 数据迁移 `src/core/migrations.ts`

- `migrations.document`：按 `schemaVersion` 串行升级整份文档（同时更新 `dependencies.pageSchema`）。
- `migrations.component`：按 `componentRef + componentVersion` 改写 props（等同 Puck `transformProps`）。
- 读取入口统一调用 `upgradeDocument`：模板文件、数据库页面、草稿（升级后清空撤销历史）、DSL 导入、AI 对话、导出、MCP 工具。
- 改 pageSchema 或构件 props 时：先写迁移步骤，再改 `schema.ts` 里的版本号。

## 节点权限 `src/core/permissions.ts`

- 三层：全局默认（全部允许）→ 构件 `permissions` → 节点 `meta.permissions`（编辑器属性面板「权限」设置，命令 `node.permissions`，可撤销）。
- 动作：`delete`、`move`、`duplicate`、`edit`。锁定的 Shell 区域永远不能删除、移动、复制。
- 校验按命令结果比较（`permissionIssues`），所以 AI 可以整块重建区域，只要受保护节点原样回到原槽位。
- AI 与 MCP 不能新增或修改 `meta.permissions`。

## 页面骨架 `src/core/shells.ts`

- `contextual`：工作区 + 详情面板（支持 `listDetail`）。
- `focus`：只有全宽工作区，不支持 `listDetail`；表格不会打开详情。
- 切换用命令 `page.shell {variant}`（工具栏下拉框），按区域 id 保留内容，撤销可完整恢复被移除的区域。
- 新增骨架：在 `shells` 中声明区域，必要时在 `ContextualShell` 渲染层适配。

## AI 配置与业务背景

- 构件 `ai.exclude`：不出现在 AI 构件目录，AI 新增该构件会被拒绝。
- 构件 `ai.excludeFields`：AI 修改时这些 props 必须保持原值（新节点保持默认值）。
- 业务背景：AI 面板「业务背景」输入框（浏览器本地保存），或 `.env.local` 的 `AI_BUSINESS_CONTEXT` 作为默认值；MCP `get_page_protocol` 返回 `businessContext`。

## 动态字段

- 构件 `resolveFields(props)` 返回属性面板当前应显示的字段，示例：Tabs 只有在第二个页签有标题后才显示第三个页签标题。
