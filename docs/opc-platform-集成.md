# shadcnplane 对接 opc-platform（OAF-005 G3）

对应 `opc-platform/docs/OAF-005-评审意见与决定.md` 第 8 节步骤 2、11、12：Page DSL 0.2.0、四个配置页面、导出应用接 BFF。
界面沿用 shadcnplane 现有路由、组件和 `src/runtime/tokens.ts` 主题（决定 D2、D5）。

## 1. 启动后端

按 `~/code/opcadminmonorepo/opc-platform/README.md`：

```bash
cd ~/code/opcadminmonorepo/opc-platform
cp .env.example .env && set -a && source .env && set +a   # 需要 Node 24
npm run stack:up && npm run db:migrate && npm run db:seed
npm run dev:meta-data   # 4100
npm run dev:db-connect  # 4200
npm run dev:bff         # 4000（OPC_DEV_IDENTITY=1）
npm run poc:publish     # 发布并启用 campus_library 0.2.0-poc.1
```

meta-data 是内存存储：重启后要重新 `poc:publish`。

## 2. 配置 shadcnplane

在 `.env.local` 里加（`.env.example` 有同样的段落），然后 `npm run dev`（端口 3100）：

| 变量 | 示例 | 作用 |
|---|---|---|
| `OPC_META_DATA_URL` | `http://127.0.0.1:4100` | 发布、目录、映射 |
| `OPC_DB_CONNECT_URL` | `http://127.0.0.1:4200` | 映射编译、就绪/漂移检查 |
| `OPC_BFF_URL` | `http://127.0.0.1:4000` | 能力执行、只读 GraphQL |
| `OPC_APP` | `campus-library-librarian` | 发布中心看哪个应用 |
| `OPC_DEV_IDENTITY` | `1` | 允许把开发身份头 `x-opc-actor / x-opc-roles` 转给 BFF |
| `OPC_DEV_ACTOR` / `OPC_DEV_ROLES` | `u_librarian` / `LIBRARIAN` | 页面没选身份时用的默认开发身份 |

地址只从环境变量读取，代码里没有写死；没配置时页面显示「未配置」。
浏览器从不直连后端：页面调用 `/api/opc/<service>/…`（`src/app/api/opc/[service]/[...path]/route.ts`），
服务端按白名单转发（`src/server/opc-platform.ts`），其余路由一律 403。

## 3. 四个页面（顶部导航「能力平台」，在「业务建模」右侧）

| 路由 | 页面 | 内容 |
|---|---|---|
| `/platform/releases` | 发布中心 | 发布清单、详情（模型包、清单摘要、能力、阻塞项、两端就绪）、与当前启用版本的差异、按运行方案创建发布、检查就绪（db-connect + BFF prepare）、启用（activate 后通知 BFF reload）；以及「页面能力绑定」 |
| `/platform/mappings` | 数据映射 | 对象 → 表、字段 → 列、允许操作（默认拒绝）、关系、编译出的 Operation；Hasura 同步状态、检查同步、重新编译并应用 |
| `/platform/operations` | Operation 目录 | 已登记 Operation：类型、角色、文档 hash、启用状态、是否被当前发布引用、固定 GraphQL 文档与变量 Schema |
| `/platform/try` | 能力试运行 | 选能力 → 按 inputSchema 自动生成表单 → 选开发身份 → 预览 / 执行（命令自动带 Idempotency-Key）/ 用 GraphQL 读取 → 显示 SUCCEEDED / REJECTED / FAILED / PENDING、原因、requestId，可查执行记录 |

## 4. Page DSL 0.2.0

`src/core/schema.ts`：`pageSchema` 与 `codeGenerator` 升到 0.2.0。

- 列表数据源：`listDetail.dataSource` 仍可为 `"example"`；新增
  `{"type":"capability","capabilityRef":"BookCopy.List","input":{},"idField":"copy_id","fieldPaths":{"book":"title.title"}}`。
  `rows` 保留为示例/离线数据。
- 业务命令：`row.select → context.open` 不变；详情面板 `composite.resource-details` 可带最多 4 个 `record.command`：

```json
{
  "event": "record.command", "capabilityRef": "Library.Borrow", "label": "办理借出", "confirm": true,
  "arguments": { "copyId": {"from": "row", "field": "copy_id"}, "readerId": {"from": "form", "label": "读者编号", "type": "text", "required": true} },
  "result": { "onSuccess": {"refresh": true, "receipt": [{"key": "loanId", "label": "借阅编号"}]}, "onRejected": {"notice": "未能借出"} }
}
```

`confirm: true` 时运行时流程为 预览（PREVIEW）→ 确认 → 执行（EXECUTE，带 Idempotency-Key）→ 回执；一次办理只生成一个幂等键，
FAILED 后「重试」复用同一个键，PENDING 可按 requestId 查询结果，不会重复写入。

兼容：`src/core/migrations.ts` 增加 0.1.0 → 0.2.0（形状是超集，只改版本号）。模板、SQLite 中的页面、草稿、导入、AI/MCP 输入在读入时都会升级；
`templates/*.json` 故意保留 0.1.0，测试会验证它们升级后通过校验。校验器只接受当前版本，旧文档必须先经过迁移。
能力引用的格式由 schema 校验（`Domain.Name`）；是否真的已发布由 `checkCapabilityRefs` 对照发布检查（发布中心的绑定表会显示问题）。

### 页面能力绑定

发布中心底部列出「业务建模」桥接出的列表页中、对象出现在发布数据映射里的页面（例如 campus_library 的 `book_copy`）。
「绑定」按发布冻结的 Operation 找到该对象的列表查询能力（优先直通能力）和命令能力，写进页面 DSL：
`book_copy` → 列表 `BookCopy.List`，命令 `Library.Borrow`（办理借出）与 `BookCopy.UpdateLocation`。
「解除」恢复示例数据。绑定后 `/apps/<类型>` 原型页从 BFF 读数据、详情面板可办理借出；BFF 不可达时退回 SQLite 数据。

## 5. 导出应用

`/api/business-models/<id>/export-app` 导出的工程新增：

| 文件 | 作用 |
|---|---|
| `src/app-runtime/opc-client.ts` | REST `execute`（命令/查询）+ 只读 GraphQL `capability(ref, input)` + `executions/:requestId` |
| `src/app-runtime/repository.ts` | 原 `Repository` 接口不变；新增 `BffRepository`：绑定了能力的模块经 BFF 读取，其余模块仍走本地 |
| `src/app/api/opc/[...path]/route.ts` | 应用自己的服务端代理：白名单转发到 `OPC_BFF_URL`，在服务端加身份 |
| `.env.example` | `DATA_MODE`、`OPC_BFF_URL`、开发身份 |

默认 `DATA_MODE=local`，行为与以前相同（种子 JSON + 浏览器存储）。设 `DATA_MODE=bff` 并重启（无需重新构建）：
绑定模块的列表来自 BFF、隐藏新建/编辑/删除，借书页走 预览 → 确认 → 回执。`contract.json` 每个模块多了 `capabilities`。

## 6. 测试

```bash
npm run typecheck && npm run lint && npm test
npx playwright test                       # 含 tests/e2e/opc-platform.spec.ts
```

- `tests/opc-dsl.test.ts`：0.1.0 → 0.2.0 迁移（模板、main 分支上的 0.1.0 示例）、命令/数据源校验、生成与渲染、绑定建议、发布差异、Schema 表单。
- `tests/opc-client.test.ts`：opc-client、BffRepository（mock fetch）、代理白名单与身份转发。
- `tests/opc-live.test.ts`：BFF 有启用发布时运行（否则跳过），走「导出应用的 opc-client → 导出应用的代理路由 → 真实 BFF」：S1 副本列表、S2 借书预览/执行/幂等重放/执行记录。
- `tests/e2e/opc-platform.spec.ts`：同样只在后端可用时运行；四个页面、页面绑定、`/apps` 借书，以及导出应用在 local / bff 两种模式下构建运行并借书。截图在 `test-results/opc-platform/`。

借书会写入图书馆表（读者借阅上限 2），所以 live 测试和 e2e 开始前会执行 opc-platform 的 `executors/library/src/seed.ts` 重置样例数据
（找 `OPC_PLATFORM_DIR`，默认 `../opcadminmonorepo/opc-platform`；数据库默认 `postgres://opc:opc@127.0.0.1:5432/opc`，可用 `OPC_DATABASE_URL` 覆盖）。

## 7. 选择与限制（如实说明）

- **发布清单**：meta-data 没有「列出发布」接口（且是内存存储），发布中心列的是本机经代理见过的发布 id（SQLite 表 `opc_releases`），
  当前启用的发布总会出现；meta-data 重启后旧 id 显示「meta-data 中已不存在」。
- **Hasura 同步状态**：db-connect 没有只读的同步状态接口。数据映射页显示 db-connect 上次报告的就绪结果；「检查 Hasura 同步」调用
  `POST db-connect /releases/:id/prepare`（会把就绪结果写回 meta-data）；「重新编译并应用」调用 `/mappings/:id/compile`，会整体替换 Hasura 元数据。
- **身份**：仍是开发身份头（DEC-08 未定）。composer 由页面选择；导出应用由其服务端环境变量提供，浏览器不带身份。
- **回执字段**：能力没有 `outputSchema` 时（如 `Library.Borrow`），绑定不生成 `receipt` 标签，回执显示返回的 JSON；可在 DSL 里手写 `result.onSuccess.receipt`。
- **列表字段**：`BookCopy.List` 的固定文档不返回 `acquired_at` 等字段，绑定后这些列为空（绑定表里有提示）。
- **编辑器预览**：设计器里的页面仍用示例行，命令按钮显示为不可用；真实数据在 `/apps` 原型和导出应用里。
- 没有改动 opc-platform 目录。
