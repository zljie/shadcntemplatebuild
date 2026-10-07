"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppWindow, ArrowUpRight, Boxes, FilePlus2, LayoutPanelLeft, LayoutTemplate, PanelsTopLeft, PencilRuler, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createDocument } from "@/core/document";
import { readDraft } from "@/core/persistence";
import type { PageDocument } from "@/core/schema";
import { TopNav } from "./top-nav";
import { LayoutWireframe, PageThumbnail } from "./page-thumbnail";

export type DesignItem = {key: string; origin: "database" | "template" | "draft"; name: string; description: string; updatedAt: string; document: PageDocument; openHref: string; runHref?: string; tags: string[]};
type LayoutLink = {name: string; href: string | null};
export type LayoutUsage = Record<"list-detail" | "detail" | "form", LayoutLink[]>;
type Props = {designs: DesignItem[]; layouts: LayoutUsage; apps: {name: string; href: string; count: number}[]; modelCount: number};

const origins = {draft: "本地草稿", database: "数据库页面", template: "模板"} as const;
const layoutInfo = [
  {kind: "list-detail", name: "列表 + 详情", description: "搜索、筛选、表格与右侧详情面板；窄屏自动切换为弹窗。由 Page DSL 描述，可在设计器中自由编排。", dsl: true},
  {kind: "detail", name: "独立详情页", description: "单条记录的完整信息、关联对象跳转与反向关联列表，带编辑与删除操作。", dsl: false},
  {kind: "form", name: "新建 / 编辑页", description: "整页表单，复用与弹窗表单相同的字段校验、默认值与提交锁。", dsl: false},
] as const;
const shellAnatomy = [
  ["侧边导航", "工作空间品牌、模块导航（每个数据模型一项）、帮助与折叠"],
  ["顶栏", "面包屑与数据来源标识（示例数据 / SQLite）"],
  ["工作区", "可编辑 Slot：页面头、搜索、表格、卡片、Tabs 等组件"],
  ["详情区", "锁定区域，承载所选记录详情；窄屏为 Dialog"],
  ["提示区", "操作结果与状态通知"],
] as const;

export function ProjectsHome({designs, layouts, apps, modelCount}: Props) {
  const [draft, setDraft] = useState<DesignItem | null>(null);
  const [query, setQuery] = useState(""), [origin, setOrigin] = useState<"all" | DesignItem["origin"]>("all");
  useEffect(() => {
    let active = true;
    readDraft().then(saved => {
      if (active && saved) setDraft({key: "draft", origin: "draft", name: saved.document.name, description: `rev ${saved.revision} · 保存在当前浏览器`, updatedAt: saved.savedAt, document: saved.document, openHref: "/", tags: []});
    }).catch(() => { /* no readable draft: nothing to show */ });
    return () => { active = false; };
  }, []);
  const shellDocument = useMemo(() => createDocument(true), []);
  const all = draft ? [draft, ...designs] : designs;
  const q = query.trim().toLowerCase();
  const visible = all.filter(d => (origin === "all" || d.origin === origin) && (!q || [d.name, d.description, ...d.tags].join(" ").toLowerCase().includes(q)));

  return <div className="catalog-app">
    <TopNav active="/projects"/>
    <main className="catalog-main">
      <section className="catalog-hero">
        <div><span className="page-eyebrow"><PanelsTopLeft size={14}/> WORKSPACE</span><h1>我的项目</h1>
          <p>项目中的全部页面设计、应用框架（App Shell）与布局模式。点击预览进入设计器继续编辑，或直接运行由数据模型驱动的业务原型。</p></div>
        <div className="catalog-hero-actions">
          <Button asChild><Link href="/editor?new=1"><FilePlus2 size={14}/>新建页面</Link></Button>
          <Button asChild variant="outline"><Link href="/resources"><Boxes size={14}/>新建数据模型</Link></Button>
        </div>
      </section>
      <div className="catalog-stats">
        <Stat icon={<LayoutTemplate size={16}/>} label="页面设计" value={all.length}/><Stat icon={<AppWindow size={16}/>} label="应用框架" value={1}/>
        <Stat icon={<LayoutPanelLeft size={16}/>} label="布局模式" value={layoutInfo.length}/><Stat icon={<Boxes size={16}/>} label="数据模型" value={modelCount}/>
      </div>
      <Tabs defaultValue="pages" className="catalog-tabs">
        <div className="catalog-toolbar"><TabsList><TabsTrigger value="pages">页面</TabsTrigger><TabsTrigger value="shell">应用框架</TabsTrigger><TabsTrigger value="layouts">布局</TabsTrigger></TabsList>
          <label className="catalog-search"><Search size={14}/><span className="sr-only">搜索页面</span><input value={query} placeholder="搜索页面名称、模型或标签…" onChange={e => setQuery(e.target.value)}/></label></div>

        <TabsContent value="pages" className="projects-pages">
          <div className="origin-filter" role="radiogroup" aria-label="页面来源">{(["all", "draft", "database", "template"] as const).map(key =>
            <button key={key} role="radio" aria-checked={origin === key} className={origin === key ? "active" : undefined} onClick={() => setOrigin(key)}>
              {key === "all" ? "全部" : origins[key]}<span>{key === "all" ? all.length : all.filter(d => d.origin === key).length}</span></button>)}</div>
          <div className="design-grid">
            {visible.map(item => <article className="design-card" key={item.key}>
              <Link href={item.openHref} className="design-thumb-link" aria-label={`在设计器中打开 ${item.name}`}><PageThumbnail document={item.document} label={item.name}/></Link>
              <div className="design-body">
                <div className="design-title"><h2>{item.name}</h2><Badge variant={item.origin === "database" ? "default" : "secondary"}>{origins[item.origin]}</Badge></div>
                <p>{item.description || "暂无描述"}</p>
                <div className="design-meta">{item.tags.slice(0, 3).map(tag => <span key={tag} className="type-badge">{tag}</span>)}<span className="date-cell">{formatTime(item.updatedAt)}</span></div>
                <div className="design-actions">
                  <Button asChild size="sm" variant="outline"><Link href={item.openHref}><PencilRuler size={13}/>{item.origin === "draft" ? "继续编辑" : "设计"}</Link></Button>
                  {item.runHref && <Button asChild size="sm" variant="ghost"><Link href={item.runHref}><Play size={13}/>运行</Link></Button>}
                </div>
              </div>
            </article>)}
            <Link href="/editor?new=1" className="design-card design-new"><FilePlus2 size={22}/><strong>新建空白页面</strong><span>从 Contextual Shell 开始装配组件</span></Link>
          </div>
          {!visible.length && <p className="catalog-notice">没有匹配的页面</p>}
        </TabsContent>

        <TabsContent value="shell" className="shell-grid">
          <article className="design-card shell-card">
            <div className="design-thumb-link"><PageThumbnail document={shellDocument} label="Contextual Shell"/></div>
            <div className="design-body">
              <div className="design-title"><h2>Contextual Shell</h2><Badge variant="secondary">锁定框架 v0.1.0</Badge></div>
              <p>所有页面共享的应用框架：设计器与导出工程保持一致；Shell 结构、间距和主题由规范锁定，只有工作区内容可编辑。</p>
              <dl className="shell-anatomy">{shellAnatomy.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>
              <div className="design-actions"><Button asChild size="sm" variant="outline"><Link href="/editor?new=1"><FilePlus2 size={13}/>基于框架新建页面</Link></Button></div>
            </div>
          </article>
          <article className="design-card app-card">
            <div className="design-body">
              <div className="design-title"><h2>业务原型应用</h2><Badge>SQLite</Badge></div>
              <p>同一个 Shell 加上由数据模型生成的模块导航，组成可运行的多页面业务系统。新增数据模型后自动出现在导航中。</p>
              <ul className="app-modules">{apps.map(app => <li key={app.href}><Link href={app.href}><AppWindow size={14}/>{app.name}<span>{app.count} 条</span><ArrowUpRight size={12}/></Link></li>)}</ul>
              {!apps.length && <p className="catalog-notice">还没有模块，先在资源清单中创建数据模型。</p>}
              <div className="design-actions"><Button asChild size="sm"><Link href="/apps"><Play size={13}/>打开业务原型</Link></Button><Button asChild size="sm" variant="ghost"><Link href="/resources">管理数据模型</Link></Button></div>
            </div>
          </article>
        </TabsContent>

        <TabsContent value="layouts" className="layout-grid">
          {layoutInfo.map(layout => { const used = layouts[layout.kind]; return <article className="design-card" key={layout.kind}>
            <div className="design-thumb-link"><LayoutWireframe kind={layout.kind}/></div>
            <div className="design-body">
              <div className="design-title"><h2>{layout.name}</h2><Badge variant="secondary">{layout.dsl ? "Page DSL" : "模型生成"}</Badge></div>
              <p>{layout.description}</p>
              <p className="layout-usage">{used.length} 个页面使用：{used.slice(0, 5).map((u, i) => <span key={u.name}>{i > 0 && "、"}{u.href ? <Link href={u.href}>{u.name}</Link> : u.name}</span>)}{used.length > 5 && " 等"}</p>
              <div className="design-actions">{layout.dsl
                ? <Button asChild size="sm" variant="outline"><Link href="/editor?template=resource-center"><FilePlus2 size={13}/>从示例开始设计</Link></Button>
                : <Button asChild size="sm" variant="outline"><Link href="/resources"><Boxes size={13}/>从数据模型生成</Link></Button>}</div>
            </div>
          </article>; })}
        </TabsContent>
      </Tabs>
    </main>
  </div>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", {timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"});
}
function Stat({icon, label, value}: {icon: React.ReactNode; label: string; value: number}) {
  return <div className="catalog-stat"><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>;
}
