# 模板库、MCP v2、shadcn Registry 与 AI 对话生成

日期：2026-10-05。本轮实现了上次评估中的五项优先事项，以及编辑器里的 AI 对话生成。旧的最小闭环记录见 [mcp-page-generation.md](mcp-page-generation.md)，那份文档保留作历史验收记录，其中的工具表已被本文取代。

## 1. 总览

```
拖拽编辑器 ──保存为模板──▶ templates/*.json ◀──save_template── 其他 AI（MCP）
     ▲  │                       │
     │  └──AI 助手（对话）       ├──▶ /r/template-<id>.json   （shadcn registry，可 npx shadcn add）
     │        │                 └──▶ list_templates / get_template（MCP）
     │        ▼
     │   /api/ai/chat ──▶ page-agent ──▶ LLMProvider（DeepSeek / OpenAI 兼容 / Mock）
     │        │
     └────────┴── 输出统一转为编辑器命令 → validateDocument → 失败则带错误自动重试（最多 3 次）
```

所有入口共用一套规则：Registry、`validateDocument` 和命令引擎。人工编辑、AI 对话和 MCP 调用都无法绕过这套规则。

## 2. 模板库

- 存储：`templates/<id>.json`，内容为 `{id, name, description, tags, source, updatedAt, document}`。可通过 `TEMPLATES_DIR` 改变位置。写入采用原子重命名，写入前必须通过校验。
- 种子模板：`npm run templates:seed` 会写入 `resource-center`、`books`、`users` 三份。
- 编辑器：顶栏「模板库」可打开或删除模板，「保存为模板」写入同一目录。打开模板会替换画布；当前有未保存修改时会先确认。
- HTTP 接口：`GET/POST /api/templates`，`GET/DELETE /api/templates/:id`。写操作有同源校验。

## 3. MCP v2

| 工具                                                | 说明                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `list_components`                                   | 默认返回摘要（props 键、slots、parents），`detail:"full"` 返回完整 Schema                             |
| `get_component`                                     | 单个组件的完整定义                                                                                    |
| `get_page_protocol`                                 | DSL Schema、规则和起始模板                                                                            |
| `list_templates` / `get_template` / `save_template` | 与拖拽编辑器共用的模板库                                                                              |
| `validate_page`                                     | 校验，返回 path/message                                                                               |
| `apply_commands`                                    | 用编辑器命令做增量修改，原子执行并校验；支持 `page.listDetail`                                        |
| `generate_page_code`                                | 直接返回代码，不写文件。`scope:"page"` 只返回 page.tsx 和 registry 安装提示；`"project"` 返回完整工程 |
| `get_component_source`                              | 返回组件源码及依赖，内联在结果中                                                                      |
| `export_project`                                    | 仅 STDIO 可用：在本机临时目录写出独立工程                                                             |

另外提供资源 `shadcnplane://protocol`、`shadcnplane://components`，以及提示词 `design_page`。

接入方式：

- STDIO：配置不变，`npm run mcp`，见旧文档。
- Streamable HTTP：启动编辑器后，把客户端指向 `http://127.0.0.1:3100/api/mcp`。部署到非本机时，务必设置 `MCP_TOKEN`，客户端带上 `Authorization: Bearer <token>`。HTTP 方式不提供 `export_project`。

## 4. shadcn Registry

编辑器运行时会动态提供以下地址（模板保存后即可安装）：

- `/r/registry.json`：索引
- `/r/shadcnplane-runtime.json`：运行时（registry:block）。依赖官方 shadcn 的 button、input、card、dialog、badge、tabs
- `/r/template-<id>.json`：模板页面（registry:page），安装到 `app/<id>/page.tsx`

在任意已执行过 `shadcn init` 的 Next 项目中：

```sh
npx shadcn@latest add http://127.0.0.1:3100/r/template-books.json
```

静态托管时用 `REGISTRY_BASE_URL=https://你的域名 npm run registry:build`，结果写到 `public/r`。

两点注意：

- 依赖的 UI 原语按名称解析到 shadcn 官方条目，与本地快照的精确版本差异尚未核实。
- 页面的 Tailwind 颜色依赖目标项目 `shadcn init` 生成的 `@theme` 映射。

## 5. LLM 接入层（`src/llm`）

| 文件                    | 职责                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `types.ts`              | `LLMProvider` 接口：`stream()`、`chat()`、`capabilities`；统一的 `ChatChunk`（text/reasoning/done+usage）和 `LLMError` |
| `openai-compatible.ts`  | 通用 `/chat/completions` 实现：SSE 解析、JSON 模式、429/5xx 指数退避重试、超时、取消                                   |
| `providers/deepseek.ts` | DeepSeek：默认 `deepseek-flash`，`thinking.type` 开关，解析 `reasoning_content`                                        |
| `providers/mock.ts`     | 测试或离线使用的脚本化模型                                                                                             |
| `registry.ts`           | 按环境变量选择 provider；`providerStatus()` 给 UI 使用，不含密钥                                                       |

**切换模型**：只改 `.env.local` 即可，见 `.env.example`。

- 改用 `deepseek-v4-pro`：设 `DEEPSEEK_MODEL=deepseek-v4-pro`。
- 改用通义、Kimi、智谱、OpenAI、本地 vLLM/Ollama：设 `LLM_PROVIDER=openai-compatible`，再配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。

**新增厂商**：

- 协议兼容 OpenAI 时，继承 `OpenAICompatibleProvider`，只需覆盖 `buildBody` 或 `parseDelta`。
- 协议不兼容时（例如 Anthropic、Gemini 原生），直接实现 `LLMProvider`。
- 实现后在 `registry.ts` 的 `providerFactories` 里登记即可，上层代码不用改。

## 6. 对话生成页面

- 入口：工具栏「AI 助手」。Enter 发送，可停止，可打开「深度思考」。每条结果显示模型、修正次数和输出 token 数。
- 协议：模型只能返回 `{reply, mode: commands|document|none, commands?, document?}` 这个 JSON。
  - `document` 模式会被 `documentToCommands` 转成命令批次。
  - 两种模式最终都作为**一条可撤销命令**应用到画布，消息里的「撤销」或 ⌘Z 都可以撤回。
- 修复循环：输出无法解析或校验失败时，把 path/message 错误反馈给模型重试，默认最多 3 次。失败时页面不变，并列出错误。
- 约束：模型不能修改 Shell、文档 id 和依赖版本；只能使用已登记的组件；示例数据为虚构内容。
- 安全：API Key 只在服务端读取；`/api/ai/chat` 有同源和大小限制；状态接口不返回密钥。

**真实模型冒烟测试**（需要本机能访问 api.deepseek.com）：

```sh
npm run ai:smoke -- "生成一个客户管理页面，字段有姓名、电话、等级（普通/VIP），可搜索姓名和电话、按等级筛选，可新增编辑"
```

## 7. 本轮验证

| 检查项                              | 结果                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                          | 33 项通过：原 21 项，新增 MCP HTTP 与模板／命令／代码工具 2 项、LLM 与 agent 8 项、同源 1 项、真实 DeepSeek 输出回归 1 项                                                                                                                  |
| `typecheck` / `lint` / `next build` | 通过；构建只有原有的 export-project 文件追踪警告                                                                                                                                                              |
| `npm run verify:ai`                 | Playwright 通过：模板库打开、AI 对话（含一次自动修正）、Tabs/Badge 渲染、单步撤销与重做、预览切换页签、保存为模板、新模板立即可从 registry 获取、无页面错误。该脚本用真实 page-agent 加脚本化模型，不需要 Key |
| Registry 消费端                     | 在全新 create-next-app 中按 registry 目标路径写入运行时和 3 个模板，并模拟 shadcn init 的主题映射；`next build` 通过，`/books-with-tabs` 渲染与交互正常                                                       |

真实 DeepSeek（deepseek-flash，2026-10-05）：用本项目完整的系统提示词请求“订单管理页”，3.3 秒返回，输入 3863 tokens，输出 1016 tokens。

- 模型返回的是 `mode=document`，但把 listDetail 另放在 `commands` 里。据此修正了 agent：document 与 commands 同时出现时两者都会应用，提示词也补充了要求。
- 这次真实输出已保存为 `tests/fixtures/deepseek-order-page.json` 并加入回归测试；在编辑器中一次通过校验，按状态筛选正常。
- 测试请求是在本机浏览器中直接调用 DeepSeek API 完成的，因为开发环境的网络无法访问 api.deepseek.com。完整的 `/api/ai/chat` 真实链路请在本机运行 `npm run ai:smoke` 或打开 AI 助手确认。

`npx shadcn add` 的实际安装需要访问 ui.shadcn.com，本轮未运行。

## 8. 已修复的旧问题

`/api/export` 原先用 `request.url` 判断同源，而 Next 会把它规范化成 `localhost`。结果通过 `http://127.0.0.1:3100`（即 `npm run dev` 的默认地址）访问时，导出和保存会被误判为跨站。现在统一改用 `src/core/http.ts`，按 Host 头比较。

## 9. 限制与后续

- 页面骨架仍固定为 Contextual Shell（工作区 + 详情区），尚未支持仪表盘、多页面等其他布局。Tabs 最多 3 个页签。
- 对话历史只保存在当前浏览器会话，刷新后清空。AI 生成过程中如果手动改了画布，结果可能无法应用，界面会提示重新发送。
- 模板库是单机文件存储，没有权限和版本历史。如果部署到只读环境（如 Vercel），`save_template` 和 POST 接口会返回错误。
- registry 锁定、Kibo 组件和视觉门禁仍按 PLAN.md 迭代 2–5 推进。
