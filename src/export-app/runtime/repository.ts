import type { DataRecord, ListDetail } from "@/runtime/data";
import { rowsFromResult, type CapabilityClient } from "@/runtime/opc";
import { applyRecordRequest, type RecordResult } from "@/runtime/records";
import { manifest } from "./modules";
import { opcClient } from "./opc-client";
import type { AppModule } from "./types";

/**
 * Data access for the generated app. The UI only talks to `Repository`. Two implementations:
 * - local (default): records in the browser (localStorage) on top of the seed data in src/app-data;
 * - bff (DATA_MODE=bff on this app's server): modules whose Page DSL list reads a published capability
 *   load through the opc-platform BFF (read-only GraphQL); their writes are business commands
 *   (preview → confirm → receipt), not record edits. Modules without a capability stay local.
 */
export interface Repository {
  list(module: string): Promise<DataRecord[]>;
  submit(module: string, request: unknown): Promise<RecordResult>;
  remove(module: string, id: string): Promise<boolean>;
}

export const NONE = "-";
export const moduleByKey = (key: string): AppModule => {
  const found = manifest.modules.find(m => m.key === key);
  if (!found) throw new Error(`未知模块：${key}`);
  return found;
};
const titleOf = (module: AppModule, row: DataRecord) => String(row[module.config.titleField] || row.id).slice(0, 40);

/** Module configuration with link options built from the target modules' current records. */
export function withLinks(module: AppModule, data: Record<string, DataRecord[]>): ListDetail {
  return {...module.config, fields: module.config.fields.map(field => {
    const target = module.links[field.key];
    if (!target) return field;
    const options = (data[target] ?? []).map(row => ({label: titleOf(moduleByKey(target), row), value: row.id}));
    return {...field, options: field.required && options.length ? options : [{label: "未设置", value: NONE}, ...options]};
  })};
}

class LocalRepository implements Repository {
  private storageKey = (module: string) => `app-data:${manifest.appName}:${module}`;
  async list(module: string): Promise<DataRecord[]> {
    try { const stored = localStorage.getItem(this.storageKey(module)); if (stored) return JSON.parse(stored) as DataRecord[]; } catch { /* storage unavailable */ }
    return moduleByKey(module).seed;
  }
  private save(module: string, rows: DataRecord[]) {
    try { localStorage.setItem(this.storageKey(module), JSON.stringify(rows)); } catch { /* storage unavailable: changes last for this page view */ }
  }
  async submit(module: string, request: unknown): Promise<RecordResult> {
    const target = moduleByKey(module), data: Record<string, DataRecord[]> = {};
    for (const key of new Set([module, ...Object.values(target.links)])) data[key] = await this.list(key);
    const result = applyRecordRequest({...withLinks(target, data), rows: data[module]}, data[module], request, {maxRows: 10_000});
    if (result.ok) this.save(module, result.rows);
    return result;
  }
  async remove(module: string, id: string): Promise<boolean> {
    const rows = await this.list(module), next = rows.filter(row => row.id !== id);
    this.save(module, next);
    return next.length !== rows.length;
  }
}

export type DataMode = "local" | "bff";
/** Whether a module's list comes from a capability (Page DSL 0.2.0 listDetail.dataSource). */
export const isCapabilityModule = (module: string) => typeof moduleByKey(module).config.dataSource === "object";

export class BffRepository implements Repository {
  constructor(private client: CapabilityClient, private fallback: Repository) {}
  async list(module: string): Promise<DataRecord[]> {
    const target = moduleByKey(module), source = target.config.dataSource;
    if (typeof source !== "object") return this.fallback.list(module);
    const result = await this.client.query(source.capabilityRef, source.input);
    if (result.status !== "SUCCEEDED") throw new Error(`${source.capabilityRef} ${result.status}：${result.reasons.map(r => r.message).join("；") || "无原因"}`);
    return rowsFromResult(result.data, source, target.config.fields);
  }
  async submit(module: string, request: unknown): Promise<RecordResult> {
    if (!isCapabilityModule(module)) return this.fallback.submit(module, request);
    return {ok: false, errors: [], message: "这个模块的数据由 BFF 提供，请在详情面板用业务命令办理"};
  }
  async remove(module: string, id: string): Promise<boolean> {
    return isCapabilityModule(module) ? false : this.fallback.remove(module, id);
  }
}

let mode: Promise<DataMode> | null = null;
/** Read once from this app's server (/api/opc/mode → DATA_MODE), so switching modes needs a restart, not a rebuild. */
export const dataMode = (): Promise<DataMode> => (mode ??= fetch("/api/opc/mode", {cache: "no-store"})
  .then(res => res.json()).then((body: {mode?: string}) => (body.mode === "bff" ? "bff" : "local") as DataMode).catch(() => "local" as DataMode));

const local = new LocalRepository(), bff = new BffRepository(opcClient, local);
const pick = async () => ((await dataMode()) === "bff" ? bff : local);
export const repository: Repository = {
  list: async module => (await pick()).list(module),
  submit: async (module, request) => (await pick()).submit(module, request),
  remove: async (module, id) => (await pick()).remove(module, id),
};
