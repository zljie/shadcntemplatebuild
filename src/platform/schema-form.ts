/**
 * A small form model for capability input JSON Schemas (the subset opc-platform publishes: object with
 * string / integer / number / boolean / enum properties, `["string","null"]` for nullable, required).
 * Anything else is edited as raw JSON.
 */
export type SchemaField = {
  key: string; kind: "string" | "integer" | "number" | "boolean" | "enum" | "json";
  required: boolean; nullable: boolean; options?: string[]; minimum?: number; maximum?: number; minLength?: number; description?: string;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export function schemaFields(schema: unknown): SchemaField[] {
  if (!isObject(schema) || !isObject(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).map(([key, raw]) => {
    const prop = isObject(raw) ? raw : {};
    const types = (Array.isArray(prop.type) ? prop.type : [prop.type]).filter((t): t is string => typeof t === "string");
    const nullable = types.includes("null"), type = types.find(t => t !== "null");
    const kind: SchemaField["kind"] = Array.isArray(prop.enum) ? "enum" : type === "string" || type === "integer" || type === "number" || type === "boolean" ? type : "json";
    return {
      key, kind, required: required.has(key), nullable,
      ...(Array.isArray(prop.enum) ? { options: prop.enum.map(String) } : {}),
      ...(typeof prop.minimum === "number" ? { minimum: prop.minimum } : {}),
      ...(typeof prop.maximum === "number" ? { maximum: prop.maximum } : {}),
      ...(typeof prop.minLength === "number" ? { minLength: prop.minLength } : {}),
      ...(typeof prop.description === "string" ? { description: prop.description } : {}),
    };
  });
}

/**
 * Form strings → capability input. Empty optional values are left out; an empty nullable value becomes null
 * when the field is required (e.g. clearing a location). Returns per-field errors instead of throwing.
 */
export function formToInput(fields: SchemaField[], values: Record<string, string>): { input: Json; errors: Record<string, string> } {
  const input: Json = {}, errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = (values[field.key] ?? "").trim();
    if (!raw) {
      if (field.required && field.nullable) input[field.key] = null;
      else if (field.required) errors[field.key] = "必填";
      continue;
    }
    switch (field.kind) {
      case "integer": case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n) || (field.kind === "integer" && !Number.isInteger(n))) errors[field.key] = field.kind === "integer" ? "应为整数" : "应为数字";
        else if (field.minimum !== undefined && n < field.minimum) errors[field.key] = `不能小于 ${field.minimum}`;
        else if (field.maximum !== undefined && n > field.maximum) errors[field.key] = `不能大于 ${field.maximum}`;
        else input[field.key] = n;
        break;
      }
      case "boolean": input[field.key] = raw === "true"; break;
      case "json": try { input[field.key] = JSON.parse(raw); } catch { errors[field.key] = "应为 JSON"; } break;
      default: input[field.key] = raw;
    }
  }
  return { input, errors };
}
