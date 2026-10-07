import {
  Blocks,
  Bot,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Tablet,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const library = ["按钮", "卡片", "数据表格", "标签页", "徽章", "输入框"];
const rows = [
  { name: "订单同步服务", type: "MCP", status: "已发布" },
  { name: "客户画像接口", type: "API", status: "已发布" },
  { name: "季度运营报告", type: "文档", status: "草稿" },
];

/** 首页 Hero 里的编辑器示意图，纯展示，不接入真实编辑器状态。 */
export function EditorMock() {
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl border bg-background shadow-[0_24px_60px_-20px_rgba(24,116,87,.35)]">
        <div className="flex h-10 items-center gap-3 border-b bg-muted/60 px-4 text-xs text-muted-foreground">
          <span className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-[#e5e7eb]" />
            <i className="size-2.5 rounded-full bg-[#e5e7eb]" />
            <i className="size-2.5 rounded-full bg-[#e5e7eb]" />
          </span>
          <span className="font-medium text-foreground">资源中心</span>
          <span className="hidden sm:inline">· 已保存</span>
          <span className="ml-auto flex items-center gap-1 rounded-md border bg-background p-0.5">
            <span className="rounded bg-accent p-1 text-accent-foreground">
              <Monitor className="size-3" />
            </span>
            <span className="p-1">
              <Tablet className="size-3" />
            </span>
            <span className="p-1">
              <Smartphone className="size-3" />
            </span>
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Undo2 className="size-3" />
            撤销
          </span>
        </div>
        <div className="grid grid-cols-[1fr] md:grid-cols-[132px_1fr_150px]">
          <aside className="hidden border-r p-3 md:block">
            <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground">
              构件库
            </p>
            <ul className="space-y-1.5">
              {library.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[11px]"
                >
                  <Blocks className="size-3 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </aside>
          <div className="bg-[#fafbfa] p-4">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-[9px] font-semibold tracking-[1.4px] text-primary">
                RESOURCES
              </p>
              <p className="mt-1 text-sm font-semibold">资源中心</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="flex h-7 flex-1 items-center gap-1.5 rounded-md border px-2 text-[10px] text-muted-foreground">
                  <Search className="size-3" />
                  搜索资源
                </span>
                <span className="flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground">
                  <Plus className="size-3" />
                  新建
                </span>
              </div>
              <div className="mt-3 overflow-hidden rounded-md border-2 border-dashed border-primary/50">
                <div className="flex items-center justify-between bg-accent px-2 py-1 text-[9px] text-accent-foreground">
                  <span>composite.data-table · 已选中</span>
                  <span>workspace / 1</span>
                </div>
                <table className="w-full text-left text-[10px]">
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name} className="border-t first:border-t-0">
                        <td className="px-2 py-1.5 font-medium">{row.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.type}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              row.status === "草稿"
                                ? "text-muted-foreground"
                                : "text-primary"
                            }
                          >
                            ● {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <aside className="hidden border-l p-3 md:block">
            <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground">
              属性
            </p>
            {[
              ["数据源", "资源"],
              ["密度", "紧凑"],
              ["行点击", "打开详情"],
            ].map(([label, value]) => (
              <div key={label} className="mb-2.5">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="mt-1 rounded-md border px-2 py-1 text-[11px]">
                  {value}
                </p>
              </div>
            ))}
            <Badge variant="outline" className="mt-1 text-[10px]">
              已通过校验
            </Badge>
          </aside>
        </div>
      </div>
      <div className="absolute -bottom-6 left-4 w-[min(300px,85%)] rounded-xl border bg-background p-3 text-[11px] shadow-lg sm:-left-6">
        <p className="flex items-center gap-1.5 font-medium">
          <Bot className="size-3.5 text-primary" />
          AI 助手
        </p>
        <p className="mt-2 rounded-md bg-muted px-2 py-1.5">
          给资源列表加一列负责人，草稿置灰
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-primary">
          <Sparkles className="size-3" />
          已应用 1 条命令 · 可撤销
        </p>
      </div>
    </div>
  );
}
