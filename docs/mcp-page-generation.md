# 面向 AI 的页面生成 MCP：最小闭环

此文保留列表／详情任务的验收记录；后续共享表单、记录动作及最新重跑说明见 [business-forms.md](business-forms.md)。
> 2026-10-05 更新：模板库、MCP v2（HTTP、apply_commands、内联代码、模板工具）、shadcn registry 与编辑器 AI 对话见 [ai-chat.md](ai-chat.md)。下文工具表为当时的 v1 记录。
日期：2026-10-01。范围：图书管理、用户管理两种示例列表／详情页面。

## 实现

`PageDocument.listDetail` 是可选的共享业务配置：字段类型和标签、列标题、标题／描述字段、搜索字段、筛选字段、详情字段和示例记录。缺省配置仍为原资源中心。现有组件引用、Shell、Slot 和版本引用保留；旧 DSL／IndexedDB 草稿不迁移、不自动重置历史。现有导入确认仍会提示替换当前画布及撤销历史，并在保存前保留原草稿。

两份示例是实际 AI 客户端从 MCP 规则生成的原始文档，分别为 `examples/books.dsl.json` 和 `examples/users.dsl.json`。两页复用同一 SearchBar、DataTable、ResourceDetails、RuntimeProvider、Shell 及主题，分别配置业务差异。`composite.resource-details` 为兼容旧文档保留的引用，现已按配置展示记录详情。

调用链：

- 查询：MCP → 现有 Registry／Zod Schema／模板规则。
- 校验：MCP／编辑器导入／Command Engine／Generator → 同一 `validateDocument`。
- 预览：DSL → Renderer → 现有 Runtime。
- 导出：MCP → `exportProject` → Generator → 相同 Runtime 和基础组件源码、主题。

新页面明确显示 `SIMULATION 示例数据`。布尔值可配置标签；搜索为不区分大小写的包含匹配，筛选项由示例记录生成，多条件使用 AND。过滤器的 DOM 选项使用 `value:` 前缀区分记录值和“全部”，DSL 内保留 primitive 数据。

## 启动与连接

使用 Node 22，在仓库根目录执行：

```sh
npm ci
npm run mcp
```

STDIO 服务由 MCP 客户端启动并保持连接。stdout 只输出协议，服务将源码根路径固定为自身所在仓库，因此不依赖客户端当前工作目录。MCP 内没有大模型。

Codex 配置示例（本轮未写入全局配置）：

```toml
[mcp_servers.pages]
command = "/opt/homebrew/opt/node@22/bin/node"
args = ["--import", "/Users/johnson_mac/code/shadcnplane/node_modules/tsx/dist/loader.mjs", "/Users/johnson_mac/code/shadcnplane/src/mcp/server.mts"]
cwd = "/Users/johnson_mac/code/shadcnplane"
required = true
startup_timeout_sec = 30
tool_timeout_sec = 60
```

其他支持 STDIO 的客户端可使用相同 command、args、cwd。路径需对应本机安装。

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `list_components` | `{}` | 组件来源、属性 Schema、默认值、Slot、父子约束、动作、限制 |
| `get_page_protocol` | `{}` | 页面 JSON Schema、组合规则、共享模板和资源示例 |
| `validate_page` | `{ "document": <DSL 对象> }` | `valid` 和 `errors: [{path,message}]`；无效时 `isError=true` |
| `export_project` | `{ "document": <DSL 对象> }` | `projectDir`、`files`；无效时返回定位错误 |

导出工具总是在系统临时目录创建全新工程，校验通过后才创建目录，不接收覆盖目标路径。导出工程只含运行所需源码和依赖，不含编辑器、拖拽框架或 MCP SDK。

## 实际客户端调用示例

在仓库根目录、Node 22 环境运行。更换 `DSL_FILE` 可验证另一页；每次导出都会创建新目录。

```sh
DSL_FILE=examples/books.dsl.json node --import tsx --input-type=module <<'JS'
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const client = new Client({ name: 'page-example', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('src/mcp/server.mts')],
  }));
  console.log((await client.listTools()).tools.map(tool => tool.name));
  const document = JSON.parse(await readFile(process.env.DSL_FILE, 'utf8'));
  const checked = await client.callTool({ name: 'validate_page', arguments: { document } });
  console.log(checked.structuredContent);
  if (checked.isError) throw new Error('DSL validation failed');
  console.log((await client.callTool({ name: 'export_project', arguments: { document } })).structuredContent);
} finally {
  await client.close();
}
JS
```

返回的新工程目录中，独立运行：

```sh
npm install --no-audit --no-fund
npm run build
npm start
```

默认地址为 `http://127.0.0.1:3101`。两工程同时运行时分别指定其他端口。新安装生成的 package-lock 是本次安装产物，本轮没有实施 PLAN.md 的锁定输入迭代。

## 重跑真实 AI → MCP → DSL

当前验收使用 Codex CLI 0.147.0，ChatGPT 登录；没有 API 模型接入或永久配置变更。创建仓库外临时工作目录，使用仅对该进程生效的 MCP 配置：

```sh
ai_dir=$(mktemp -d /tmp/shadcnplane-ai-XXXXXX)
codex exec --ignore-user-config --ephemeral --skip-git-repo-check \
  --sandbox read-only -C "$ai_dir" --json -o "$ai_dir/generated.json" \
  -c 'mcp_servers.pages = { command = "/opt/homebrew/opt/node@22/bin/node", args = ["--import", "/Users/johnson_mac/code/shadcnplane/node_modules/tsx/dist/loader.mjs", "/Users/johnson_mac/code/shadcnplane/src/mcp/server.mts"], cwd = "/Users/johnson_mac/code/shadcnplane", required = true, startup_timeout_sec = 30, tool_timeout_sec = 60 }' \
  - > "$ai_dir/events.jsonl" 2> "$ai_dir/stderr.log" <<'PROMPT'
只使用 pages MCP 工具，不读取仓库文件，不使用 shell/web。
先调用 list_components 和 get_page_protocol，基于返回的事实独立生成两份完整 DSL：
1. 图书管理：书名、作者、分类、库存、借阅状态；至少四条虚构示例，包含库存 0；搜索书名和作者，筛选分类和借阅状态。
2. 用户管理：姓名、账号、角色、布尔启用状态；至少四条虚构示例，包含 true 和 false，标签启用／停用；搜索姓名和账号，筛选角色和启用状态。
两页共用列表／详情模板、Shell、默认主题和间距，详情展示全部业务字段，并明确标注示例数据。
分别调用 validate_page，修复所有错误；通过后分别调用 export_project。
最后只返回 JSON，包含 books、users 完整文档及 booksProjectDir、usersProjectDir。
PROMPT
```

验收必须在 events 中存在实际 MCP 查询、两次校验成功、两次导出成功，且传入导出工具的文档、最终响应、导出目录内的 `page.dsl.json` 一致。只启动服务、直接调用函数、人工编写示例或工具协议测试不能替代这一环节。模型生成内容可以不同；以业务字段与交互约束验收，不要求复刻示例文案。

## 自动检查与浏览器重跑

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

使用现有槽位脚本回归原资源页面；浏览器脚本使用独立的 Playwright 浏览器上下文，不覆盖用户当前草稿。

```sh
node scripts/verify-slots.mjs
```

业务工程启动后，指定它的目录和地址，分别对两页运行：

```sh
EXPORTED_PROJECT=/absolute/path/to/new-project \
COMPOSER_URL=http://127.0.0.1:3100 \
EXPORT_URL=http://127.0.0.1:3101 \
node scripts/verify-theme.mjs
```

脚本经现有文件导入／确认进入编辑器，验证全部表格字段、主／次搜索字段、每个筛选及组合筛选、空结果、打开关闭详情、库存 0／布尔 false、手机 Dialog 与 Escape 关闭、DSL 下载往返，并对照预览和独立应用的主题计算样式及布局尺寸。ZIP 源文件与实际独立构建输入逐文件核对（Next 自动追加声明除外）。截图用于人工视觉核查，不宣称像素完全一致。

原资源中心的独立对照可通过 `EXPORT_DIR=<新目录> npm run export:example -- --theme-check` 生成新输入，再运行同一脚本；不覆盖已有 exports。

## 本轮验收记录

- 自动检查：18 项测试通过，包括独立 STDIO 客户端发现／调用四个工具、非法组件／属性／组合／字段／类型／重复记录拒绝、字段 false／0 保留、命令逆操作和导出。类型检查、lint、Studio 生产构建通过。
- 真实 AI：实际客户端先调用组件与协议工具，分别生成两份 DSL，各校验一次通过，再分别通过 MCP 导出。没有预先提供手工业务 DSL；最终响应和工具参数及导出 DSL 深度相等。成功调用记录见 `test-results/mcp-pages/ai-events.jsonl`，生成结果见 `ai-generated.json`，目录映射见 `ai-results.json`。
- 浏览器：原资源中心槽位编辑、跨槽拖动、撤销重做、IndexedDB 保存恢复、DSL 往返和资源交互通过。原资源页面预览／独立工程七种状态的计算样式、布局与交互对照通过。
- 独立工程：两业务工程分别在仓库外新目录安装依赖、生产构建和启动成功；没有读取父级仓库配置。日志见 `test-results/mcp-pages/books-build.log`、`users-build.log`。在最终空字符串筛选修正后，用相同 AI DSL 再次通过真实 MCP 客户端导出至全新目录并重新安装、构建和运行；原 AI 导出未覆盖，最终目录映射见 `final-exports.json`。具体目录见下面的验收目录表。
- 业务浏览器：图书／用户的全部表格字段、主／次搜索、每个筛选及组合筛选、空结果、选行打开／关闭详情、库存 0／停用 false、DSL 往返、手机 Dialog 与 Escape 关闭通过。默认、搜索、空结果、筛选、详情及边界记录的桌面计算样式和布局与独立工程一致；截图和结果位于 `test-results/mcp-pages/books-management/`、`users-management/`。
- 视觉核查：已查看图书默认页、用户详情页，业务字段和示例标记正确，未见布局／主题异常；不宣称逐像素一致。

| 工程 | 仓库外独立目录 | 本轮端口 |
| --- | --- | --- |
| 图书 | `/tmp/shadcnplane-page-nVAHWp` | 3211 |
| 用户 | `/tmp/shadcnplane-page-82dLr2` | 3212 |
| 资源回归 | `/tmp/shadcnplane-page-epL2YU` | 3213 |

这些临时目录用于本轮证据，可能被系统清理；源码中的两份 DSL 和重跑入口可重新生成工程。验收结束后已停止本轮启动的四个服务。最终汇总见 `test-results/mcp-pages/acceptance.json`。

## 未覆盖与限制

- 仅单页、单个共享列表／详情数据集；最多 200 条示例记录、20 个字段、10 列、3 个筛选。无排序、分页、复杂查询、真实 API／数据库、登录权限、CRUD、借还书、用户启停、多页面路由或远程 MCP。
- 业务配置通过 DSL 导入，不提供可视化字段设计器，也不支持将导出 React 反向导入编辑器。
- 主题仍为 `provisional-0.1.0`；上游 shadcn 精确 revision 待核实。未实施 registry.lock、完整依赖解析、Kibo 或 PLAN.md 其他迭代。
- 已检查桌面主题／尺寸及手机 Dialog，未完成平板／手机全状态视觉矩阵、正式截图差异门禁或完整无障碍审计。
- 既有 Studio 动态文件访问追踪、父级 workspace 提示和 Vitest configLoader 提示保留。真实 AI 客户端有模型缓存字段警告，但成功完成了全部工具调用；未修改客户端缓存。
- `npm audit` 报告原有 Next.js 16.3.5 的 critical 依赖告警（GHSA-vcvr-r3jv-pc5j，next/og ImageResponse）。本轮未新增该版本，也未扩大范围升级；未据此断言当前页面存在可利用路径。
- 本轮没有暂存、提交、推送或覆盖已有导出工程，原 `.gitignore` 改动保留。
