import Link from "next/link";
import { Database, Layers3 } from "lucide-react";

const links = [
  {href: "/projects", label: "我的项目"},
  {href: "/business-models", label: "业务建模"},
  {href: "/resources", label: "资源清单"},
  {href: "/apps", label: "业务原型"},
  {href: "/editor", label: "页面设计器"},
] as const;

/** Top navigation shared by the project home and the resource catalog. */
export function TopNav({active, database}: {active: (typeof links)[number]["href"]; database?: string}) {
  return <header className="catalog-topbar">
    <Link className="catalog-brand" href="/projects"><span className="app-logo"><Layers3 size={17}/></span><strong>Composer</strong></Link>
    <nav aria-label="主导航">{links.map(link => <Link key={link.href} href={link.href} className={link.href === active ? "active" : undefined} aria-current={link.href === active ? "page" : undefined}>{link.label}</Link>)}</nav>
    {database && <span className="catalog-db" title="SQLite 数据库文件"><Database size={13}/>{database}</span>}
  </header>;
}
