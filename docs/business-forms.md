# 共享表单与受控新增／编辑

前置成果核实后，上一任务已提交为 `2a6e4c7`。本任务按用户提前批准实施；默认选择和后续业务问题见 [business-forms-followups.md](business-forms-followups.md)。保留已有 `.gitignore` 改动，不推送，不覆盖已有导出源码。

## 实现与边界

两页使用同一列表、详情及 `BusinessForm` Dialog。标签来自同一字段契约，默认值／回填、字段错误、提交锁、失败保留输入、成功提示及取消／关闭规范共用。复用现有 shadcn Button、Input、Dialog 和原生 select，未新增依赖。

`listDetail.fields` 描述 `default`、`required`、文本 `minLength/maxLength`、数字 `min/max/integer`、单选 `options:[{label,value}]`；`listDetail.form` 指定字段顺序、唯一字段和已注册动作。例：

```json
{
  "fields": ["title", "author", "category", "inventory"],
  "uniqueField": "title",
  "actions": ["record.create", "record.update"]
}
```

该片段属于 `listDetail.form`，完整示例见 `examples/books.dsl.json`、`examples/users.dsl.json`。新增入口在页面标题区，编辑入口在已选记录详情中。图书借阅状态只读；用户启用状态用布尔枚举编辑。

字段类型和动作名由共享契约定义；现有页面校验器检查严格结构及业务组合，`fieldError` / `validateBusinessConfig` 同时供 Runtime 和 MCP 校验路径复用。模拟适配在提交边界再次检查字段、类型、必填、范围、枚举、只读字段和启用动作，拒绝未知属性及动作。不接收 JavaScript、执行器、网络地址或真实业务数据修改工具。

Runtime 的记录会话独立于 PageCommand 历史。操作不写回 DSL，不进入编辑器撤销／重做。每个 Runtime 创建自己的集合，选中记录按 ID 读取当前值，新增／编辑成功后列表及详情共同更新。重复操作 ID 返回同一结果，变更同一 ID 的输入被拒绝；表单同步锁阻止快速重复提交。模拟等待 200ms，期间禁止关闭／取消；成功后关闭表单并给出提示，失败保留输入。

仅会话内模拟数据。刷新、重新导入或更换配置恢复 DSL 示例；不承诺持久化，不实现真实后端、数据库、权限、账号认证、借还书、删除、批量操作或路由。演示的书名／账号唯一约束用于可重复的失败验证，真实约束需后续确认。新建图书借阅状态默认“可借阅”，与库存不建立业务推导。

## MCP 连接与生成

沿用 [MCP 连接配置和调用示例](mcp-page-generation.md)，仍只有 `list_components`、`get_page_protocol`、`validate_page`、`export_project` 四个工具。协议新增 `runtimeActions`、`formTemplate` 和表单约束；组件事实标明标题／详情承载的已注册记录动作。MCP 不执行业务新增／编辑。

按前文的临时 STDIO 客户端配置，将生成提示替换为：

```text
只使用 pages MCP 工具，先读取 list_components 与 get_page_protocol。
生成图书管理、用户管理完整 DSL，复用共享 Shell、列表、详情和 Dialog 表单。
图书：title书名、author作者必填文本1–80字符，category分类必填枚举
[悬疑小说,科幻小说,文学小说,少儿读物]，inventory库存必填0–100000整数；
loanStatus借阅状态只读，默认可借阅。可编辑字段仅前四项，唯一字段title仅用于演示。
用户：name姓名、account账号必填文本1–80字符；role角色必填枚举
[管理员,馆员,读者,审计员]默认读者；enabled启用状态布尔枚举启用/停用默认true。
用户唯一字段account，不生成密码。
每页至少四条示例，包含库存0／停用false；搜索配置两个文本字段，筛选业务枚举。
所有字段提供默认值，必填文本允许空初值。form.actions启用record.create和record.update。
页面说明明确SIMULATION示例数据及会话内模拟操作，刷新恢复。
不要将记录动作放入node.actions；保留row.select→context.open。
分别validate_page，修复全部错误，再分别export_project。
最终返回JSON，含books、users完整DSL及booksProjectDir、usersProjectDir。
```

必须保留实际 MCP 事件；核对查询、两份合法 DSL 和导出完成，且最终响应、导出参数和工程 `page.dsl.json` 相等。客户端不可用时应报告缺失环节，不能用手写 DSL 替代 AI 验收。

导出调用沿用原入口，每次创建全新仓库外目录。在新目录使用 Node 22：

```sh
npm install --no-audit --no-fund
npm run build
npm start
```

## 验收重跑

仓库根目录：

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
node scripts/verify-slots.mjs
```

图书和用户工程分别启动后，各运行下面两个脚本（使用真实新导出目录）：

```sh
EXPORTED_PROJECT=/absolute/path/to/new-project \
COMPOSER_URL=http://127.0.0.1:3100 EXPORT_URL=http://127.0.0.1:3101 \
node scripts/verify-theme.mjs

EXPORTED_PROJECT=/absolute/path/to/new-project \
COMPOSER_URL=http://127.0.0.1:3100 EXPORT_URL=http://127.0.0.1:3101 \
node scripts/verify-forms.mjs
```

第一项检查列表／详情、搜索／筛选、DSL 往返、ZIP 源码与独立输入、主题与布局对照。第二项检查真实导入预览、新增默认值、标签、焦点、Tab／Enter／Escape、字段错误、非法枚举／库存、取消／关闭、重复身份导致的失败与保留输入、提交中锁、双提交只产生一条记录、新增搜索筛选、编辑回填、取消编辑及详情同步、手机详情中的表单、刷新恢复、运行时修改不改变 DSL。输出默认在 `test-results/business-forms/<page-id>/`，可用 `VERIFY_OUTPUT` 指定新证据目录。

边界检查包含未知动作、非法配置及绕过前端提交。模拟失败通过重复书名／账号重现，无产品测试开关。浏览器脚本创建隔离上下文，不覆盖用户浏览器草稿。

## 验收记录

2026-10-01，使用 Node 22.22.0。原始日志、MCP 事件、截图与汇总位于 `test-results/business-forms/`（本地验收产物，未加入 Git）。

| 证据类型 | 本轮结果 | 可复查记录 |
| --- | --- | --- |
| 自动检查 | 21 项测试、类型检查、lint、Studio 生产构建通过；覆盖合法／非法配置、绕过界面输入、幂等、只读字段、书／用户会话隔离及既有命令／导出回归 | `tests/records.test.ts`、`tests/mcp.test.ts`、`tests/core.test.ts`；`studio-completed-build.log` |
| 真实 AI → MCP | Codex CLI 0.147.0 实际调用组件查询 1 次、协议查询 1 次、校验 2 次、导出 2 次；两份 AI DSL 均合法，最终响应、导出工具参数和工程 DSL 相等；AI 只调用 MCP 工具 | `ai-events.jsonl`、`ai-generated.json`、`ai-summary.json` |
| 浏览器 | 两页真实导入编辑器，默认值、回填、校验、取消／关闭、失败保留输入、双提交、新增搜索筛选、编辑列表／详情同步、键盘焦点、移动端嵌套 Dialog、刷新恢复及 DSL 不变均通过；列表／详情、主题与源码对照通过 | `books-forms.log`、`users-forms.log`、各页 `form-results.json`、截图及主题 `results.json` |
| 独立工程 | 两业务工程和标准资源回归工程，在仓库外全新目录各自安装、生产构建、启动通过。最后的共享焦点／枚举修正后再次创建新导出，未覆盖原 AI 工程；ZIP 文件与实际构建输入逐项一致 | `completed-exports.json`、`completed-build-results.json`、`*-completed-install.log`、`*-completed-build.log`、`*-theme.log` |
| 原能力回归 | 资源中心七种状态对照、槽位编辑／跨槽拖动、撤销重做、IndexedDB 保存恢复、DSL 下载导入与生成代码通过；六组浏览器脚本退出码均为 0 | `resource-theme.log`、`slots-slots.log`、`browser-summary.json` |

最终独立目录：

- 图书：`/tmp/shadcnplane-page-KbNLFk`（验收端口 3211）。
- 用户：`/tmp/shadcnplane-page-oeQ6Uh`（验收端口 3212）。
- 资源：`/var/folders/_5/r7c0jnbd4s13mlyxgtf2bq1w0000gn/T/shadcnplane-form-resource-y2o93p4c`（验收端口 3213）。

已查看图书新增桌面截图、用户编辑手机截图，标签、必填标记、默认／回填值、示例声明及布局正确。未宣称逐像素一致或完成全面无障碍审计。汇总见 `acceptance.json`，本轮四个生产服务和临时诊断服务均已停止。

安装过程中曾遇到磁盘 ENOSPC，清理仅限本轮临时工程的依赖／构建缓存，保留源码、DSL 与日志；最终安装及检查均重跑通过。原 AI 导出和后续所有导出源码仍保留，临时路径可能被系统清理，以上重跑入口可以重建。

本任务按用户要求本地提交，上一任务提交为 `2a6e4c7`；未推送。原 `.gitignore` 无关改动及 Next.js 自动生成声明的本地变更保留。

## 尚未覆盖

仍为单页、最多 200 条会话示例，无真实业务接口／持久化、权限、认证、密码、借还书、删除、批量操作、路由或远程 MCP。唯一性与借阅初始状态属于演示约定，正式规则见后续确认文档。未增加可视化字段设计器、真实取消请求或服务端幂等。主题仍为 provisional；仅完成所列桌面与手机功能／焦点检查，未做完整多浏览器、视觉差异门禁和全面无障碍审计。上一轮已有构建提示与依赖告警未扩大范围处理。
