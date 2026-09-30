# 迭代 1：组件来源与主题统一

日期：2026-09-30。状态：本轮授权的迭代 1 已实施，验收场景 1–8 在下述证据范围内通过；迭代 2–5 未实施。没有提交或推送。

## 改动与调用关系

- `src/core/registry.ts` 在原 Registry 上补充 `role`、`source`、`files`、`componentDependencies`、`npmDependencies`、`responsibility`，保留已有 `exportName`、`importPath`。`componentSources` 记录实际导出符号，供 Registry 复用并说明基础 UI、布局、业务组合、Runtime 与适配职责，不是插件框架或依赖解析器。
- DSL → `PageRenderer` 根据 Registry 的实际导出符号选择 `runtime/components.tsx` 实现 → `RuntimeProvider` 提供搜索、筛选、选择和提示状态。Shell、StackSlot 和 ResourceIcon 等非 DSL 支持符号也有来源记录。
- `generateReact` 仍依据相同 Registry 的符号／路径生成代码，直接组合相同 Runtime；`exportProject` 拷贝原基础组件及 Runtime 源码。`/api/export` 调用该导出器生成代码或 ZIP。
- `runtime/tokens.ts` 是 DSL Token 选项、临时主题版本及语义值到 CSS variables 的共享映射。Schema、编辑字段和 `presentation` 共用这些定义；选项、DSL 格式和版本值均不变。
- `runtime/theme.css` 从原 `styles.css` 提取主题值及 Tailwind `@theme inline` 映射。Studio 与导出均经 `globals.css` → `runtime/styles.css` → `theme.css` 导入同一份主题；新增文件已进入固定导出清单。
- 项目别名 `surface/ink/line/green` 引用对应基础 UI variables。`surface-muted` 与 shadcn `muted` 原本不同，保留两者。DSL 圆角 sm/md/lg = 4/8/12px，shadcn sm/md/lg/xl = 4/6/8/12px，各自命名映射，保留现有语义与效果。
- 主题值在 `.page-surface` 及 `.runtime-detail-dialog` 中显式定义，防止编辑器根变量覆盖预览。浏览器对照发现原预览继承编辑器 12px，而导出继承 body 14px；共享主题明确页面字号 12px 和行高 1.5，使导出沿用当前预览效果。
- `scripts/export-example.ts` 的原默认行为保留；新增 `EXPORT_DIR` 与 `--theme-check` 仅用于可重复导出包含 Stack、基础 UI 和非默认 Token 的验收样例。原 `exports/resource-page` 未被覆盖。

属性 Schema、编辑字段、默认值、Slot、父子限制、Shell 锁定、非法修改拒绝、批量回滚、撤销重做和草稿格式保留。没有安装新依赖。

## 来源核查及职责

本地证据：`components.json` 声明 shadcn 配置（new-york、neutral、CSS variables、Lucide）；`src/components/ui/` 中已有源码；Git 初始提交 `a17c443` 包含这些文件。现有仓库没有足以恢复准确 shadcn 上游 revision、CLI 安装版本或本地差异的安装记录。元数据用 `upstreamVersion: null` 明确待核实；没有将 DSL 的 `componentVersion: 0.1.0` 当作 shadcn 版本。导出的 `THIRD_PARTY.md` 同样声明此限制。

所有 DSL 条目的实际实现都属于项目源码，不能因 `componentRef` 带有 `shadcn` 前缀便将适配代码视为上游组件。

| DSL 条目 | 实际导出（均来自 `@/runtime/components`） | 职责与底层来源 |
| --- | --- | --- |
| `region.workspace` | `WorkspacePane` | 项目布局；锁定主内容区域 |
| `layout.stack` | `Stack` | 项目布局；受控 presentation 与 StackSlot 槽位组合 |
| `shadcn.card` | `CardBlock` | 项目适配；底层 shadcn Card/CardHeader/CardTitle/CardContent，来自 `@/components/ui/card` |
| `shadcn.button` | `ButtonBlock` | 项目适配；底层 shadcn Button，来自 `@/components/ui/button`；提示动作由 Runtime 承担 |
| `shadcn.input` | `InputBlock` | 项目适配；底层 shadcn Input，来自 `@/components/ui/input`；标签与 ID 由适配层处理 |
| `pattern.page-header` | `PageHeader` | 项目业务组合；标题、说明与本地资源统计 |
| `composite.search-bar` | `SearchBar` | 项目业务组合；shadcn Input、原生 select、Runtime 搜索筛选 |
| `composite.data-table` | `DataTable` | 项目业务组合；原生 table、资源过滤及选行；不是 shadcn 通用 DataTable |
| `composite.empty-state` | `EmptyState` | 项目业务组合；空白引导 |
| `composite.context-panel` | `ContextPanel` | 项目区域布局；Runtime 关闭／选择和窄屏 shadcn Dialog 适配，底层来自 `@/components/ui/dialog` |
| `composite.resource-details` | `ResourceDetails` | 项目业务组合；所选示例资源详情 |

`files` 记录所属源码文件；`componentDependencies` 引用 `componentSources` 中的实际符号；`npmDependencies` 记录对应实现直接使用的包名，版本继续取当前 package.json。Dialog 源文件内部使用 Button，已登记。基础 UI 的 `cn` 依赖 clsx 与 tailwind-merge；Button 依赖 radix-ui 与 class-variance-authority；图标依赖 lucide-react。

Runtime 仍共处一个模块，工程导出需要整个模块的依赖集合。本轮保持固定完整文件清单，没有做按需裁剪或自动闭包解析。主题／样式文件由 `tokenValues.files` 记录，实际 CSS 导入关系也经过导出测试。编辑器另用 Badge、Tabs、Tooltip，这些不是 DSL Registry 条目，未额外接入导出 Runtime。

## 实际验证结果

环境：Node 22.22.0，npm；Python 核查与图像检查使用 python3。读取了本地 Next.js 16.3.5 的 CSS 与 use-client 指南。zvec 检索返回 INDEX_MISSING，使用精确检索核查源码，未创建持久化索引。

| 场景 | 结果与证据 |
| --- | --- |
| 1. 当前核心测试 | 修改前 14/14；最终 16/16，原 14 项全部保留 |
| 2. 新元数据与主题检查 | 增加 2 项现有 Vitest 检查：11 个条目覆盖、真实导出符号、源码文件、依赖引用／npm 覆盖、上游版本未知标记；共享 Schema 选项、布局与响应式映射、非法值拒绝、CSS variables 及原样源码导出 |
| 3. Stack／槽位／撤销 | `node scripts/verify-slots.mjs` 通过：创建、配置、槽位增删、跨槽拖动、组件库拖入、撤销重做、横向布局和手机纵向布局 |
| 4. 保存刷新与 DSL 往返 | 同一浏览器脚本通过；恢复及重新导入的完整 DSL 与导出前深度相等 |
| 5. 资源交互 | 原脚本扩展并通过搜索、MCP 筛选（2 条）、空结果、选行与关闭详情；独立工程再次验证搜索（1 条）、Document 筛选（2 条）、空结果、选行、关闭和按钮提示 |
| 6. 组件与主题输入一致 | 核心测试逐文件对照本地源码；浏览器验收核对 ZIP 的 22 个文件与独立工程输入：21 个逐字节一致；Next 构建自动追加路由声明的 next-env.d.ts 保留导出引用前缀；无 Builder／拖拽依赖进入导出 |
| 7. 构建、运行与主题对照 | Studio typecheck、lint、生产 build 通过；仓库外全新目录独立 npm install、生产 build、npm start 成功；浏览器运行与七种状态对照通过 |
| 8. 全条目来源与职责 | 上表 11 个条目及 Registry 元数据覆盖完成；上游版本、安装记录与差异明确待核实 |

浏览器使用现有安装的 Playwright Chromium；原槽位脚本可用，无需替代工具。页面没有捕获到未处理的浏览器运行错误。

独立工程最终核查目录：`/var/folders/_5/r7c0jnbd4s13mlyxgtf2bq1w0000gn/T/shadcnplane-iteration01-g9v4ixj_`，生产应用使用端口 3101；验收结束后已停止本轮启动的 Studio 与独立应用。仓库内的验收输入保留在 `exports/iteration01-resource-page`。先前在仓库子目录的构建虽然通过，但 Next.js 会读取父级配置，所以没有把该结果当作独立工程的最终证据；最终目录不在仓库内，未使用父级配置。

### 视觉证据范围

- 当前 Studio 默认预览与实施前基线截图逐字节相同：`/tmp/iteration01-before.png` 与 `/tmp/iteration01-after.png`。
- `scripts/verify-theme.mjs` 使用相同 DSL、示例数据与 1440px 页面视口。Studio 宿主视口 2200×1800、缩放 100%；独立应用视口 1440×1000。对照仅截取 `.page-surface`，截图时排除外层编辑器画框圆角／阴影，并使用足够高的宿主避免内容裁切。
- 七种状态：默认、搜索、空结果、类型筛选、详情展开、按钮提示、编辑器根变量隔离。全部元素的主题计算样式一致；HTML 元素和 SVG 根的相对位置、尺寸一致。零尺寸元素和 SVG 内部 path 的浮点边界不作位置断言。
- 截图不是逐像素完全一致。实际像素检查：排除截图最后一行的高度取整边缘后，各状态仅 150–211 个像素不同，最大单通道差值 24；差异集中于少量抗锯齿边缘。默认／详情原图各另有 1440 个最后一行差异。已人工查看默认与详情两端图，未发现主题或内容布局变化。
- 图片、计算样式、JSON 结果与差异图保留在 `test-results/iteration-01/`；`results.json` 是可重复脚本结果，`visual-inspection.json` 记录本次额外像素检查。脚本严格断言样式、位置与交互，截图供人工核查；没有偷换成像素完全一致，也没有建立迭代 5 的截图阈值门禁。

## 重跑入口

在项目根目录、Node 22 环境执行：

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

服务就绪后另一个终端执行：

```sh
node scripts/verify-slots.mjs
export iter01_project_dir=$(mktemp -d /tmp/shadcnplane-iteration01-XXXXXX)
EXPORT_DIR="$iter01_project_dir" npm run export:example -- --theme-check
(cd "$iter01_project_dir" && npm install --no-audit --no-fund && npm run build && npm start)
```

独立应用就绪后，在项目根目录的另一个终端执行：

```sh
EXPORTED_PROJECT="$iter01_project_dir" node scripts/verify-theme.mjs
```

最后一条命令所在终端需使用同一导出目录；可直接将变量替换为实际绝对路径。已有独立应用占用 3101 时先停止本次验收启动的应用。`COMPOSER_URL`、`EXPORT_URL` 可以指定已有服务地址。只使用临时／新建目录；不要将验收样例覆盖到有手工修改的导出工程。

## 限制、未覆盖项与下一轮入口

- `provisional-0.1.0` 仍是临时主题，没有正式企业主题输入；不宣称完成企业设计规范。
- shadcn 准确上游 revision、CLI 安装记录及源码差异尚未核实。没有自动升级组件。
- 桌面七种状态对照已验证；手机槽位布局已回归。平板／手机两端完整视觉对照、移动 Dialog 焦点与无障碍扫描、全浏览器矩阵和正式像素门禁未在本轮覆盖，留给后续验收。
- 固定导出清单仍保留；没有 registry.lock.json、校验和锁定、完整依赖解析或生成依赖锁文件功能。验收工程 npm install 生成的 package-lock 只是该次安装产物。
- Studio 构建仍报告现有的动态文件路径会追踪整个项目警告，以及仓库外 pnpm-workspace.yaml 被忽略的提示；独立目录构建／启动无这些父级提示。Vitest 仍报告 configLoader 未来默认值提示。没有顺带改动这些无关问题。
- 保存仍为浏览器 IndexedDB，没有服务端持久化、真实 API、AI、多页面或 Kibo 接入。
- 入口是 PLAN.md 的迭代 2：以本轮 `componentSources` 和共享主题为依据核查可追溯快照，设计锁文件与确定性导出。需另行授权后执行。
- 原 `.gitignore` 修改保留。PLAN.md 原为未跟踪文件，只更新迭代 1 与总状态；后续迭代内容和确认项保持原样。没有修改其他仓库、暂存、提交或推送。
