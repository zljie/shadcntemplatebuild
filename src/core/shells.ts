/**
 * Page skeletons (Puck's "root" idea): a shell variant fixes which locked root regions a page has,
 * in which order. Content lives in the regions' slots, so switching shells keeps workspace content.
 */
export const shellVariants = ["contextual", "focus"] as const;
export type ShellVariant = (typeof shellVariants)[number];
export type ShellRegion = { id: string; componentRef: string; seed?: string[] };
export type ShellDefinition = {
  name: string;
  description: string;
  regions: ShellRegion[];
  /** listDetail needs a details region (composite.resource-details inside the context panel). */
  supportsListDetail: boolean;
};
export const shells: Record<ShellVariant, ShellDefinition> = {
  contextual: {
    name: "Contextual Shell",
    description: "侧边导航 + 主工作区 + 右侧详情面板，适合列表／详情业务页",
    regions: [
      { id: "workspace", componentRef: "region.workspace" },
      {
        id: "context",
        componentRef: "composite.context-panel",
        seed: ["composite.resource-details"],
      },
    ],
    supportsListDetail: true,
  },
  focus: {
    name: "Focus Shell",
    description: "侧边导航 + 全宽工作区，无详情面板，适合仪表盘、表单和说明页",
    regions: [{ id: "workspace", componentRef: "region.workspace" }],
    supportsListDetail: false,
  },
};
export const hasDetailsRegion = (root: { componentRef: string }[]) =>
  root.some((node) => node.componentRef === "composite.context-panel");
