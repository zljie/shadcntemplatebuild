import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  Bot,
  Boxes,
  Braces,
  Check,
  CodeXml,
  Database,
  FileArchive,
  FileJson,
  FlaskConical,
  Hammer,
  LayoutTemplate,
  Megaphone,
  Minus,
  MonitorSmartphone,
  Package,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  Terminal,
  Undo2,
  Users,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditorMock } from "@/components/landing/editor-mock";

export const metadata: Metadata = {
  title: "Shadcnplane — 用 shadcn 组件装配页面",
  description:
    "受约束的可视化页面装配器：导入业务模型，推演业务场景，拖拽或对话生成页面，输出结构化 DSL，一键导出可运行的 React 工程。",
};

const nav = [
  ["产品", "#features"],
  ["业务建模", "#business"],
  ["工作原理", "#how"],
  ["AI 治理", "#ai"],
  ["对比", "#compare"],
  ["接入方式", "#integrations"],
] as const;

const standards = [
  "shadcn/ui",
  "Tailwind CSS",
  "Radix UI",
  "Next.js",
  "Model Context Protocol",
  "Lucide",
];

const pillars = [
  {
    no: "01",
    icon: Blocks,
    title: "可视化编辑",
    body: "从构件库拖入 shadcn 组件，填进命名槽位，按桌面、平板、手机三档分别调整布局。所见即所得，每一步都能撤销。",
    link: ["打开编辑器", "/editor"],
  },
  {
    no: "02",
    icon: Bot,
    title: "对话生成",
    body: "用一句话描述页面，AI 助手把它变成一条可撤销的编辑命令。校验不通过时自动修复，最多重试三次。",
    link: ["试试 AI 助手", "/editor"],
  },
  {
    no: "03",
    icon: CodeXml,
    title: "导出代码",
    body: "单个页面或整套多模块应用都能导出为独立的 Next.js 工程，也可以通过 shadcn registry 装进你现有的项目，源码归你所有。",
    link: ["查看 registry", "/r/registry.json"],
  },
  {
    no: "04",
    icon: Workflow,
    title: "业务建模",
    body: "导入业务模型 YAML，按对象、关系、行为、规则、角色等视角管理。AI 推演业务场景，再一键生成多页面应用。",
    link: ["进入业务建模", "/business-models"],
  },
] as const;

const steps = [
  {
    icon: Boxes,
    title: "注册构件",
    body: "在一处定义构件的属性、编辑字段、槽位规则和 AI 说明。",
  },
  {
    icon: MonitorSmartphone,
    title: "编辑或生成",
    body: "团队拖拽编辑，AI 通过对话、MCP 或业务模型生成，走同一套命令。",
  },
  {
    icon: ShieldCheck,
    title: "统一校验",
    body: "编辑器和 AI 共用一份校验规则，不合规的修改进不了页面。",
  },
  {
    icon: FileJson,
    title: "存为 DSL",
    body: "页面以 JSON 保存，可版本迁移、可模板化、可导出源码。",
  },
] as const;

const guardrails = [
  "只能使用已注册的构件，不会凭空造组件",
  "槽位限定可放的构件类型和数量上限",
  "父级约束防止构件被放到不该出现的位置",
  "注入品牌、行业和语气等业务上下文",
  "沙盘场景和应用方案里的每个引用都对照业务模型校验，问题逐条列出",
  "没有配置模型时退回规则草稿，并明确标注来源",
  "每次修改都是一条命令，随时撤销",
];

const commandLog = [
  { ok: true, text: "node.insert shadcn.tabs → workspace" },
  { ok: false, text: "pattern.page-header 不能放进标签页槽位" },
  { ok: true, text: "自动修复第 1 次 · 改放 composite.data-table" },
  { ok: true, text: "校验通过 · 已应用，撤销栈 +1" },
];

type Cell = "yes" | "no" | "partial";
const compare: { row: string; cells: [Cell, Cell, Cell] }[] = [
  { row: "输出结构化页面数据（JSON DSL）", cells: ["yes", "no", "partial"] },
  { row: "只使用你设计系统里的组件", cells: ["yes", "partial", "no"] },
  { row: "非技术成员可以直接可视化修改", cells: ["yes", "no", "yes"] },
  { row: "导出可维护的 React 源码", cells: ["yes", "yes", "no"] },
  {
    row: "从业务模型推演场景并生成多页面应用",
    cells: ["yes", "partial", "partial"],
  },
  { row: "每一步修改都可撤销", cells: ["yes", "partial", "partial"] },
  { row: "部署在自己的服务器，数据不出门", cells: ["yes", "yes", "no"] },
];

const roles = [
  {
    icon: Hammer,
    who: "工程师",
    body: "只负责定义构件和约束，重复的页面搭建交给编辑器和 AI。",
  },
  {
    icon: Palette,
    who: "设计师",
    body: "设计令牌和组件统一来源，页面上线后和设计稿保持一致。",
  },
  {
    icon: Users,
    who: "产品经理",
    body: "导入业务模型，推演业务场景，再用对话调整生成的列表、表单和详情页。",
  },
  {
    icon: Megaphone,
    who: "业务人员",
    body: "从模板出发改字段和文案，当天就能拿到可用的页面。",
  },
] as const;

const integrations = [
  {
    icon: Sparkles,
    title: "编辑器内 AI 助手",
    body: "流式返回生成过程，结果直接落在画布上，可逐条撤销。",
    tag: "/api/ai/chat",
  },
  {
    icon: Plug,
    title: "MCP 服务",
    body: "支持 STDIO 和 HTTP。Claude、Cursor 等智能体既能读写页面，也能导入业务模型、推演沙盘、生成并导出整个应用。",
    tag: "build_app_from_ontology",
  },
  {
    icon: Package,
    title: "shadcn registry",
    body: "运行时和模板都以 registry 发布，用 shadcn CLI 安装。",
    tag: "/r/registry.json",
  },
  {
    icon: Database,
    title: "自带模型",
    body: "内置 DeepSeek 和 OpenAI 兼容接口，一个环境变量切换。",
    tag: "LLM_PROVIDER",
  },
] as const;

const templates = [
  { title: "资源中心", body: "搜索、筛选、表格和详情面板" },
  { title: "用户管理", body: "成员列表、角色和状态" },
  { title: "图书管理", body: "记录增删改与详情页" },
];

const businessFlow = [
  {
    icon: FileJson,
    title: "导入业务模型",
    body: "上传语义模型 YAML，按对象、关系、行为、规则、角色、状态、事件和指标分视角查看和编辑。引用错误带 YAML 路径列为问题，导出时保留原始标识和未知字段。",
  },
  {
    icon: FlaskConical,
    title: "业务沙盘推演",
    body: "AI 从模型推断业务场景：参与角色、触发条件、操作步骤、读写对象、状态变化和异常。每个引用都对照模型校验，确认后成为流程蓝图，并统计命令覆盖。",
  },
  {
    icon: Wand2,
    title: "一键应用设计",
    body: "AI 给出应用方案：模块、名称、图标、列表列和字段标签。方案校验通过后，每个模块生成列表和详情页面，模块之间互相链接，并带三条示例数据。",
  },
  {
    icon: FileArchive,
    title: "导出前端工程",
    body: "整个应用打包成一个独立的 Next.js 工程 zip：每个模块有列表、详情、新建和编辑路由，共享导航，数据走可替换的仓储层。",
  },
] as const;

const appTree = `business-app.zip
├─ src/app/<模块>/page.tsx          列表
├─ src/app/<模块>/[id]/page.tsx     详情
├─ src/app/<模块>/new/page.tsx      新建
├─ src/app/<模块>/[id]/edit/        编辑
├─ src/app-runtime/repository.ts    可替换的数据仓储
├─ src/app-data/<模块>.json         示例数据
├─ dsl/<模块>.dsl.json              页面 DSL
├─ contract.json                    查询与命令契约
└─ app-design.json                  设计方案溯源`;

const footerLinks: { group: string; links: [string, string][] }[] = [
  {
    group: "产品",
    links: [
      ["编辑器", "/editor"],
      ["业务建模", "/business-models"],
      ["模板库", "/projects"],
      ["资源", "/resources"],
    ],
  },
  {
    group: "开发者",
    links: [
      ["Registry", "/r/registry.json"],
      ["运行时包", "/r/shadcnplane-runtime.json"],
    ],
  },
  {
    group: "项目",
    links: [["GitHub", "https://github.com/zljie/shadcntemplatebuild"]],
  },
];

const dsl = `{
  "schemaVersion": "0.1.0",
  "shell": { "variant": "contextual" },
  "root": [{
    "componentRef": "region.workspace",
    "slots": {
      "children": [
        {
          "componentRef": "pattern.page-header",
          "props": { "title": "资源中心" }
        },
        { "componentRef": "composite.search-bar" },
        { "componentRef": "composite.data-table" }
      ]
    }
  }]
}`;

function Mark({ cell }: { cell: Cell }) {
  if (cell === "yes")
    return <Check aria-label="支持" className="mx-auto size-4 text-primary" />;
  if (cell === "partial")
    return (
      <Minus
        aria-label="部分支持"
        className="mx-auto size-4 text-muted-foreground"
      />
    );
  return <X aria-label="不支持" className="mx-auto size-4 text-[#c0c5cc]" />;
}

function SectionHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold tracking-[2px] text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {body && (
        <p className="mt-4 text-base leading-7 text-muted-foreground">{body}</p>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground [font-family:var(--runtime-font-family)]">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Blocks className="size-4" />
            </span>
            Shadcnplane
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            {nav.map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="transition-colors hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <Link href="/projects">模板库</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/editor">打开编辑器</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#eef0f2_1px,transparent_1px),linear-gradient(to_bottom,#eef0f2_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-24 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:pt-24">
            <div>
              <Badge
                variant="outline"
                className="gap-1.5 bg-background px-3 py-1 text-xs"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                基于 shadcn/ui 的页面装配器
              </Badge>
              <h1 className="mt-6 text-4xl leading-[1.15] font-bold tracking-tight text-balance sm:text-5xl lg:text-[56px]">
                让团队和 AI <br className="hidden sm:block" />用
                <span className="text-primary">你的组件</span>装配页面
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                Shadcnplane
                是一个受约束的可视化编辑器。拖拽或用一句话生成页面，也可以从业务模型一键生成整套应用，保存为结构化
                DSL，再导出成可运行的 React 工程。
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/editor">
                    开始搭建 <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/projects">浏览模板</Link>
                </Button>
              </div>
              <div className="mt-8 flex max-w-xl items-center gap-3 overflow-x-auto rounded-lg border bg-[#1b1f24] px-4 py-3 font-mono text-[13px] text-[#e6edf3]">
                <Terminal className="size-4 shrink-0 text-[#7ee2b8]" />
                <code className="whitespace-nowrap">
                  <span className="text-[#7ee2b8]">npx</span> shadcn add
                  &lt;你的域名&gt;/r/shadcnplane-runtime.json
                </code>
              </div>
            </div>
            <EditorMock />
          </div>
        </section>

        <section aria-label="技术基础" className="border-b bg-muted/40">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-8 sm:px-6">
            <span className="w-full text-center text-xs text-muted-foreground md:w-auto">
              构建在开放标准之上
            </span>
            {standards.map((name) => (
              <span
                key={name}
                className="text-sm font-semibold tracking-tight text-[#8a929c]"
              >
                {name}
              </span>
            ))}
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead
              eyebrow="PRODUCT"
              title="一份构件配置，同时驱动编辑、生成和导出"
              body="不需要在可视化工具和代码之间二选一。同一个页面，设计师拖拽、AI 生成、业务模型驱动，工程师拿走源码。"
            />
            <div className="mt-14 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2 lg:grid-cols-4">
              {pillars.map(({ no, icon: Icon, title, body, link }) => (
                <article key={no} className="flex flex-col bg-background p-8">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-muted-foreground">
                      {no}
                    </span>
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="mt-8 text-xl font-semibold">{title}</h3>
                  <p className="mt-3 flex-1 leading-7 text-muted-foreground">
                    {body}
                  </p>
                  <Link
                    href={link[1]}
                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    {link[0]} <ArrowRight className="size-3.5" />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="business" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHead
                eyebrow="BUSINESS MODEL"
                title="从业务模型直接生成应用"
                body="先把业务讲清楚，再生成页面。导入业务模型，让 AI 推演业务场景、设计应用，最后导出一个可以独立运行的前端工程。"
              />
              <Button asChild variant="outline">
                <Link href="/business-models">
                  进入业务建模 <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_1fr]">
              <ol className="grid gap-6 sm:grid-cols-2">
                {businessFlow.map(({ icon: Icon, title, body }, index) => (
                  <li key={title} className="rounded-xl border p-6">
                    <div className="flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-lg bg-accent text-primary">
                        <Icon className="size-5" />
                      </span>
                      <span className="font-mono text-sm text-muted-foreground">
                        0{index + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="self-start overflow-hidden rounded-xl border bg-[#1b1f24] text-[#e6edf3] shadow-xl">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-[#9aa4ae]">
                  <FileArchive className="size-3.5" />
                  导出前端工程 (zip)
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6">
                  <code>{appTree}</code>
                </pre>
                <p className="border-t border-white/10 px-5 py-3 text-xs leading-5 text-[#9aa4ae]">
                  未配置模型或设置 LLM_PROVIDER=mock
                  时，沙盘和应用设计使用规则草稿，同样可以走完整个流程。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-b bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <SectionHead
                eyebrow="HOW IT WORKS"
                title="页面就是数据"
                body="每个页面都是一份带版本号的 JSON。它能被校验、迁移、做成模板，也能被任何智能体读写。"
              />
              <ol className="mt-10 space-y-6">
                {steps.map(({ icon: Icon, title, body }, index) => (
                  <li key={title} className="flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          0{index + 1}
                        </span>
                        {title}
                      </p>
                      <p className="mt-1 leading-7 text-muted-foreground">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="self-center overflow-hidden rounded-xl border bg-[#1b1f24] text-[#e6edf3] shadow-xl">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-[#9aa4ae]">
                <Braces className="size-3.5" />
                resource-center.json
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6">
                <code>{dsl}</code>
              </pre>
            </div>
          </div>
        </section>

        <section id="ai" className="scroll-mt-16 border-b">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-2">
            <div>
              <SectionHead
                eyebrow="AI GOVERNANCE"
                title="AI 只能用你允许的积木"
                body="生成式 AI 很快，但也很容易跑偏。Shadcnplane 把规则写进构件定义，让每一次生成都落在你的设计系统里。"
              />
              <ul className="mt-8 space-y-3">
                {guardrails.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-primary">
                      <Check className="size-3" />
                    </span>
                    <span className="leading-7">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border bg-background p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-primary" />
                  命令校验
                </p>
                <Badge variant="secondary">实时</Badge>
              </div>
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm">
                “加一个标签页，把已发布和草稿分开”
              </p>
              <ol className="mt-5 space-y-2.5 font-mono text-[13px]">
                {commandLog.map(({ ok, text }) => (
                  <li
                    key={text}
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 ${ok ? "" : "border-[#f3d8a8] bg-[#fff8eb] text-[#8a5a12]"}`}
                  >
                    {ok ? (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <X className="size-3.5 shrink-0" />
                    )}
                    {text}
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                <Undo2 className="size-4" />
                整个过程只占撤销栈的一步
              </div>
            </div>
          </div>
        </section>

        <section id="compare" className="scroll-mt-16 border-b bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead
              eyebrow="COMPARE"
              title="介于编码智能体和建站工具之间"
              body="编码智能体给你一堆难以维护的代码，建站工具把页面锁在它的平台上。Shadcnplane 给你两者都缺的东西。"
            />
            <div className="mt-12 overflow-x-auto rounded-xl border bg-background">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-6 py-4 font-medium text-muted-foreground">
                      能力
                    </th>
                    <th className="bg-accent px-6 py-4 text-center font-semibold text-accent-foreground">
                      Shadcnplane
                    </th>
                    <th className="px-6 py-4 text-center font-medium text-muted-foreground">
                      编码智能体
                    </th>
                    <th className="px-6 py-4 text-center font-medium text-muted-foreground">
                      AI 建站工具
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map(({ row, cells }) => (
                    <tr key={row} className="border-b last:border-b-0">
                      <td className="px-6 py-4">{row}</td>
                      {cells.map((cell, index) => (
                        <td
                          key={index}
                          className={`px-6 py-4 ${index === 0 ? "bg-accent/50" : ""}`}
                        >
                          <Mark cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead eyebrow="FOR TEAMS" title="每个角色都能直接动手" />
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {roles.map(({ icon: Icon, who, body }) => (
                <article
                  key={who}
                  className="rounded-xl border p-6 transition-shadow hover:shadow-md"
                >
                  <Icon className="size-5 text-primary" />
                  <h3 className="mt-5 font-semibold">{who}</h3>
                  <p className="mt-2 leading-7 text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="integrations"
          className="scroll-mt-16 border-b bg-muted/40"
        >
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead
              eyebrow="INTEGRATIONS"
              title="四种方式接入你的工作流"
              body="可以只用编辑器，也可以让外部智能体通过标准协议直接生成页面。"
            />
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {integrations.map(({ icon: Icon, title, body, tag }) => (
                <article
                  key={title}
                  className="flex gap-5 rounded-xl border bg-background p-6"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 leading-7 text-muted-foreground">
                      {body}
                    </p>
                    <code className="mt-3 inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {tag}
                    </code>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHead
                eyebrow="TEMPLATES"
                title="从模板开始，几分钟出第一版"
              />
              <Button asChild variant="outline">
                <Link href="/projects">
                  全部模板 <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {templates.map(({ title, body }) => (
                <Link
                  key={title}
                  href="/projects"
                  className="group overflow-hidden rounded-xl border transition-shadow hover:shadow-md"
                >
                  <div className="flex h-36 flex-col gap-2 border-b bg-[#fafbfa] p-5">
                    <span className="h-2 w-16 rounded bg-primary/70" />
                    <span className="h-2 w-28 rounded bg-[#e5e7eb]" />
                    <span className="mt-auto grid grid-cols-3 gap-1.5">
                      {Array.from({ length: 6 }, (_, i) => (
                        <span key={i} className="h-3 rounded bg-[#eceef0]" />
                      ))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-5">
                    <div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {body}
                      </p>
                    </div>
                    <LayoutTemplate className="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-24 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-primary px-6 py-16 text-center text-primary-foreground sm:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,.18),transparent_45%)]"
            />
            <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
              准备好了就开始
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-base leading-7 text-white/80">
              打开编辑器，用模板或一句话生成你的第一个页面；或者导入业务模型，生成整套应用。
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" variant="secondary">
                <Link href="/editor">
                  打开编辑器 <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              >
                <Link href="/business-models">导入业务模型</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 text-sm sm:px-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <Blocks className="size-3.5" />
              </span>
              Shadcnplane
            </p>
            <p className="mt-3 max-w-xs leading-6 text-muted-foreground">
              用 shadcn 组件和结构化 DSL 装配页面。
            </p>
          </div>
          {footerLinks.map(({ group, links }) => (
            <div key={group}>
              <p className="font-medium">{group}</p>
              <ul className="mt-3 space-y-2 text-muted-foreground">
                {links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="hover:text-foreground">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t py-6 text-center text-xs text-muted-foreground">
          © 2026 Shadcnplane
        </div>
      </footer>
    </div>
  );
}
