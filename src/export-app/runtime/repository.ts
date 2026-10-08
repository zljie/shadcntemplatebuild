import type { DataRecord, ListDetail } from "@/runtime/data";
import { applyRecordRequest, type RecordResult } from "@/runtime/records";
import { manifest } from "./modules";
import type { AppModule } from "./types";

/**
 * Data access for the generated app. The UI only talks to `Repository`; to connect a real
 * backend (BFF / GraphQL), implement this interface with calls to the queries and commands
 * listed in contract.json and export it as `repository` below. The default implementation
 * keeps records in the browser (localStorage) on top of the seed data in src/app-data.
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

export const repository: Repository = new LocalRepository();
