import type { Metadata } from "next";

export const metadata: Metadata = { title: "业务原型 — Composer", description: "由数据模型生成、数据保存在 SQLite 的业务系统原型" };

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
