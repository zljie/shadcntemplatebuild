import Link from "next/link";
import { AlertTriangle, Boxes, CircleCheck, CircleX, DatabaseZap, FlaskConical, Rocket } from "lucide-react";
import { TopNav } from "@/prototype/top-nav";
import type { Health, OpcConfig } from "@/server/opc-platform";

export const platformPages = [
  {href: "/platform/releases", label: "发布中心", icon: Rocket},
  {href: "/platform/mappings", label: "数据映射", icon: DatabaseZap},
  {href: "/platform/operations", label: "Operation 目录", icon: Boxes},
  {href: "/platform/try", label: "能力试运行", icon: FlaskConical},
] as const;
export type PlatformPage = (typeof platformPages)[number]["href"];

/** Shared frame of the opc-platform configuration pages: top navigation, page tabs, service health, configuration gaps. */
export function PlatformFrame({active, config, health, eyebrow, title, description, actions, children}: {
  active: PlatformPage; config: OpcConfig; health: Health[]; eyebrow: React.ReactNode; title: string; description: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return <div className="catalog-app">
    <TopNav active="/platform"/>
    <main className="catalog-main">
      <nav className="platform-subnav" aria-label="能力平台">{platformPages.map(({href, label, icon: Icon}) =>
        <Link key={href} href={href} className={href === active ? "active" : undefined} aria-current={href === active ? "page" : undefined}><Icon size={14}/>{label}</Link>)}</nav>
      <section className="catalog-hero">
        <div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
        {actions && <div className="catalog-hero-actions">{actions}</div>}
      </section>
      <ul className="platform-health" aria-label="服务状态">
        {health.map(h => <li key={h.service} data-ok={h.ok} title={h.ok ? JSON.stringify(h.detail) : h.message}>{h.ok ? <CircleCheck size={13}/> : <CircleX size={13}/>}<strong>{h.service}</strong>
          <small>{h.ok ? h.service === "bff" ? `release ${String(h.detail?.release ?? "未加载").slice(0, 12)}` : h.service === "db-connect" ? `Hasura ${h.detail?.hasura ? "正常" : "异常"}` : `contract ${String(h.detail?.contractVersion ?? "")}` : h.message}</small></li>)}
        <li data-ok="neutral"><strong>app</strong><small>{config.app ?? "未配置"}</small></li>
        <li data-ok="neutral"><strong>身份</strong><small>{config.devIdentity ? "开发身份头（x-opc-*）" : "未启用开发身份"}</small></li>
      </ul>
      {config.missing.length > 0 && <div className="bm-alert" role="alert"><AlertTriangle size={14}/><div><strong>未配置 {config.missing.join("、")}</strong>
        <p className="platform-alert-text">在 .env.local 中设置后重启 <code>npm run dev</code>，示例见 .env.example 与 docs/opc-platform-集成.md。</p></div></div>}
      {children}
    </main>
  </div>;
}

export function Empty({children}: {children: React.ReactNode}) {
  return <div className="table-empty"><Boxes size={22}/><span>{children}</span></div>;
}
