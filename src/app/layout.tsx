import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Composer — 页面装配器",description:"基于 shadcn/ui 与 Page DSL 的受约束页面装配器"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
