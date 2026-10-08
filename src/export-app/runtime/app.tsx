"use client";
import { useEffect, useState } from "react";
import type { Navigation, RecordAdapter } from "@/runtime/components";
import type { DataRecord, ListDetail } from "@/runtime/data";
import { manifest } from "./modules";
import { moduleByKey, repository, withLinks } from "./repository";

export const STORE_LABEL = "本地数据";
export const href = (module: string, id?: string, suffix = "") => `/${module}${id ? `/${encodeURIComponent(id)}` : ""}${suffix}`;

export function navigation(active: string, counts: Record<string, number> = {}): Navigation {
  return {
    items: manifest.modules.map(m => ({label: m.title, href: href(m.key), active: m.key === active, ...(counts[m.key] !== undefined ? {count: counts[m.key]} : {})})),
    detailHref: `/${active}/{id}`,
  };
}

/** Loads the module and its link targets from the repository (seed data until the client has loaded). */
export function useModuleData(key: string): {data: Record<string, DataRecord[]>; loaded: boolean; version: number} {
  const keys = [...new Set([key, ...Object.values(moduleByKey(key).links)])];
  const [state, setState] = useState(() => ({data: Object.fromEntries(keys.map(k => [k, moduleByKey(k).seed])), loaded: false, version: 0}));
  useEffect(() => {
    let live = true;
    void Promise.all(keys.map(async k => [k, await repository.list(k)] as const)).then(entries => {
      if (live) setState(s => ({data: Object.fromEntries(entries), loaded: true, version: s.version + 1}));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys derive from `key`
  }, [key]);
  return state;
}

/** Wires a generated list + detail page to the repository and the app navigation. */
export function useAppModule(key: string, page: ListDetail): {listDetail: ListDetail; adapter: RecordAdapter; navigation: Navigation; version: number} {
  const {data, version} = useModuleData(key);
  const linked = withLinks(moduleByKey(key), data);
  return {
    listDetail: {...page, fields: linked.fields, rows: data[key]},
    adapter: {label: STORE_LABEL, submit: request => repository.submit(key, request)},
    navigation: navigation(key, {[key]: data[key].length}),
    version,
  };
}
