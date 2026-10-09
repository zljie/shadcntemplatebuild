"use client";
import { useEffect, useState } from "react";
import type { Navigation, RecordAdapter } from "@/runtime/components";
import type { DataRecord, ListDetail } from "@/runtime/data";
import { manifest } from "./modules";
import { opcClient } from "./opc-client";
import { dataMode, isCapabilityModule, moduleByKey, repository, withLinks, type DataMode } from "./repository";

export const href = (module: string, id?: string, suffix = "") => `/${module}${id ? `/${encodeURIComponent(id)}` : ""}${suffix}`;
/** Where a module's records live, shown in the shell and on record pages. */
export const storeLabel = (module: string, mode: DataMode, error?: string) =>
  mode === "bff" && isCapabilityModule(module) ? (error ? "BFF 读取失败" : "BFF（opc-platform）") : "本地数据";
/** Record create / edit / delete apply to local modules only; BFF modules change through business commands. */
export const isReadOnly = (module: string, mode: DataMode) => mode === "bff" && isCapabilityModule(module);

export function navigation(active: string, counts: Record<string, number> = {}): Navigation {
  return {
    items: manifest.modules.map(m => ({label: m.title, href: href(m.key), active: m.key === active, ...(counts[m.key] !== undefined ? {count: counts[m.key]} : {})})),
    detailHref: `/${active}/{id}`,
  };
}

type ModuleData = {data: Record<string, DataRecord[]>; loaded: boolean; version: number; mode: DataMode; error?: string};
/** Loads the module and its link targets from the repository (seed data until the client has loaded, and if the BFF read fails). */
export function useModuleData(key: string): ModuleData {
  const keys = [...new Set([key, ...Object.values(moduleByKey(key).links)])];
  const [state, setState] = useState<ModuleData>(() => ({data: Object.fromEntries(keys.map(k => [k, moduleByKey(k).seed])), loaded: false, version: 0, mode: "local"}));
  useEffect(() => {
    let live = true;
    void (async () => {
      const mode = await dataMode();
      const settled = await Promise.allSettled(keys.map(async k => [k, await repository.list(k)] as const));
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const data = Object.fromEntries(settled.map((r, i) => r.status === "fulfilled" ? r.value : [keys[i], moduleByKey(keys[i]).seed]));
      if (live) setState(s => ({data, loaded: true, version: s.version + 1, mode, ...(failed ? {error: failed.reason instanceof Error ? failed.reason.message : String(failed.reason)} : {})}));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys derive from `key`
  }, [key]);
  return state;
}

/** Wires a generated list + detail page to the repository, business commands (BFF mode) and the app navigation. */
export function useAppModule(key: string, page: ListDetail): {listDetail: ListDetail; adapter: RecordAdapter; navigation: Navigation; version: number} {
  const {data, version, mode, error} = useModuleData(key);
  const linked = withLinks(moduleByKey(key), data), readOnly = isReadOnly(key, mode);
  const {form, ...rest} = page;
  return {
    listDetail: {...rest, ...(form && !readOnly ? {form} : {}), fields: linked.fields, rows: data[key]},
    adapter: {
      label: storeLabel(key, mode, error), submit: request => repository.submit(key, request),
      ...(mode === "bff" ? {capability: opcClient, reload: () => repository.list(key)} : {}),
    },
    navigation: navigation(key, {[key]: data[key].length}),
    version,
  };
}
