import type { DataRecord, RecordField, RecordValue } from "./data";

/**
 * Business capabilities served by an opc-platform BFF (Page DSL 0.2.0). Plain types and pure helpers only:
 * shared by the composer, its runtime and generated apps, with no network code.
 */
export const capabilityRefPattern = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/;

export type Phase = "PREVIEW" | "EXECUTE";
export type ResultStatus = "SUCCEEDED" | "REJECTED" | "FAILED" | "PENDING";
export type Reason = { code: string; message: string; ruleId?: string };
/** Unified capability result returned by REST execute and the GraphQL `capability` query alike. */
export type CapabilityResult = {
  requestId: string; traceId: string; releaseId: string; capabilityRef: string;
  phase: Phase; status: ResultStatus; data: unknown; reasons: Reason[]; evidenceRefs: string[];
};
/** What a page needs to know about a published capability (BFF GraphQL `release.capabilities`). */
export type CapabilityInfo = { capabilityRef: string; kind: "query" | "command"; title?: string | null; allowedRoles: string[]; inputSchema?: Record<string, unknown> | null };

export type Binding =
  | { from: "row"; field: string }
  | { from: "form"; label: string; type: "text" | "number"; required?: boolean; field?: string }
  | { from: "const"; value: RecordValue };
export type CommandAction = {
  event: "record.command"; capabilityRef: string; label: string;
  arguments: Record<string, Binding>;
  confirm: boolean;
  result: {
    onSuccess: { notice?: string; refresh: boolean; receipt?: { key: string; label: string }[] };
    onRejected: { notice?: string };
  };
};
export type CapabilityDataSource = {
  type: "capability"; capabilityRef: string; input: Record<string, RecordValue>;
  /** Path of the record id in a result row, e.g. copy_id. */
  idField: string;
  /** Field key → dot path in a result row; a field without an entry reads the property of the same name. */
  fieldPaths?: Record<string, string>;
};

/** Runs capabilities for the current user; identity is restored server-side, never sent by the page. */
export interface CapabilityClient {
  execute(capabilityRef: string, input: Record<string, unknown>, options?: { phase?: Phase; idempotencyKey?: string }): Promise<CapabilityResult>;
  query(capabilityRef: string, input: Record<string, unknown>): Promise<CapabilityResult>;
  execution(requestId: string): Promise<CapabilityResult | null>;
}

export const statusLabels: Record<ResultStatus, string> = { SUCCEEDED: "成功", REJECTED: "已拒绝", FAILED: "失败", PENDING: "处理中" };

export function valueAt(source: unknown, path: string): unknown {
  let value: unknown = source;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Form bindings the user fills in, in declaration order. */
export const formBindings = (action: CommandAction) =>
  Object.entries(action.arguments).flatMap(([key, binding]) => (binding.from === "form" ? [{ key, ...binding }] : []));

/** Builds the capability input from the selected row and the form values; reports missing required values. */
export function resolveArguments(action: CommandAction, row: DataRecord, form: Record<string, string>): { input: Record<string, unknown>; missing: string[] } {
  const input: Record<string, unknown> = {}, missing: string[] = [];
  for (const [key, binding] of Object.entries(action.arguments)) {
    if (binding.from === "const") input[key] = binding.value;
    else if (binding.from === "row") input[key] = binding.field === "id" ? row.id : row[binding.field];
    else {
      const raw = (form[key] ?? "").trim();
      if (!raw) { if (binding.required) missing.push(binding.label); continue; }
      input[key] = binding.type === "number" ? Number(raw) : raw;
      if (binding.type === "number" && !Number.isFinite(input[key])) missing.push(binding.label);
    }
  }
  return { input, missing };
}

const toValue = (field: RecordField, value: unknown): RecordValue => {
  if (field.type === "number") { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  if (field.type === "boolean") return value === true || value === "true";
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value).slice(0, 1000) : String(value).slice(0, 1000);
};

/** Turns the rows a query capability returned into records of the page's fields. Accepts `rows`, `items` or a bare array. */
export function rowsFromResult(data: unknown, source: CapabilityDataSource, fields: RecordField[]): DataRecord[] {
  const list = Array.isArray(data) ? data : (["rows", "items", "data"].map(key => valueAt(data, key)).find(Array.isArray) ?? []);
  return list.flatMap((item): DataRecord[] => {
    const id = valueAt(item, source.idField);
    if (id === undefined || id === null || id === "") return [];
    const record: DataRecord = { id: String(id) };
    for (const field of fields) record[field.key] = toValue(field, valueAt(item, source.fieldPaths?.[field.key] ?? field.key));
    return [record];
  });
}

export const newIdempotencyKey = () => `idem_${crypto.randomUUID()}`;
