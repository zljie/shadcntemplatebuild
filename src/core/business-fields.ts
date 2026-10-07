import type { ListDetail, RecordField, RecordValue } from "../runtime/data";

function convert(value: RecordValue, type: RecordField["type"]): RecordValue {
  if (type === "text") return String(value);
  if (
    type === "number" &&
    (typeof value === "number" ||
      typeof value === "boolean" ||
      (value.trim() && Number.isFinite(Number(value))))
  )
    return Number(value);
  if (type === "boolean") {
    if ([true, 1, "true", "1"].includes(value)) return true;
    if ([false, 0, "false", "0"].includes(value)) return false;
  }
  throw new Error(
    `值“${value}”无法转换为${type === "number" ? "数字" : "布尔值"}，请保留原类型。`,
  );
}

/** Update references and fixtures together; the page command validates the result atomically. */
export function updateBusinessField(
  config: ListDetail,
  key: string,
  field: RecordField,
): ListDetail {
  if (
    !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.key) ||
    ["id", "__proto__", "constructor", "prototype"].includes(field.key)
  )
    throw new Error(
      "字段标识须以字母开头，仅含字母、数字和下划线，且不能使用保留名称。",
    );
  if (field.key !== key && config.fields.some((f) => f.key === field.key))
    throw new Error("字段标识已存在。");
  if (
    config.form?.uniqueField === key &&
    (field.type !== "text" || !field.required)
  )
    throw new Error("唯一字段必须保留为必填文本。");
  const old = config.fields.find((f) => f.key === key)!;
  const next = structuredClone(config);
  const ref = (value: string) => (value === key ? field.key : value);
  next.fields = next.fields.map((f) => (f.key === key ? field : f));
  next.titleField = ref(next.titleField);
  if (next.descriptionField) next.descriptionField = ref(next.descriptionField);
  next.columns = next.columns.map((c) =>
    c.field === key
      ? {
          field: field.key,
          title: c.title === old.label ? field.label : c.title,
        }
      : c,
  );
  for (const name of ["searchFields", "filters", "detailFields"] as const)
    next[name] = next[name].map(ref);
  if (next.form) {
    next.form.fields = next.form.fields.map(ref);
    next.form.uniqueField = ref(next.form.uniqueField);
  }
  next.rows = next.rows.map((row) => {
    const value =
      old.type === field.type ? row[key] : convert(row[key], field.type);
    const copy = { ...row };
    delete copy[key];
    return { ...copy, [field.key]: value };
  });
  return next;
}

export function changeBusinessFieldType(
  config: ListDetail,
  key: string,
  type: RecordField["type"],
): ListDetail {
  const old = config.fields.find((f) => f.key === key)!;
  if (old.type === type) return config;
  const field: RecordField = { key, label: old.label, type };
  if (config.form) {
    field.required = old.required;
    field.default =
      old.default === undefined
        ? type === "text"
          ? ""
          : type === "number"
            ? 0
            : false
        : convert(old.default, type);
    if (type === "boolean")
      field.options = [
        { label: "是", value: true },
        { label: "否", value: false },
      ];
  }
  return updateBusinessField(config, key, field);
}

export function addBusinessField(
  config: ListDetail,
  type: RecordField["type"] = "text",
): ListDetail {
  if (config.fields.length >= 20) throw new Error("最多支持 20 个字段。");
  const next = structuredClone(config);
  let index = 1;
  while (next.fields.some((f) => f.key === `field${index}`)) index++;
  const key = `field${index}`;
  const value = type === "text" ? "" : type === "number" ? 0 : false;
  next.fields.push({
    key,
    label: `字段 ${index}`,
    type,
    ...(next.form
      ? {
          default: value,
          ...(type === "boolean"
            ? {
                options: [
                  { label: "是", value: true },
                  { label: "否", value: false },
                ],
              }
            : {}),
        }
      : {}),
  });
  if (next.columns.length < 10)
    next.columns.push({ field: key, title: `字段 ${index}` });
  next.detailFields.push(key);
  next.form?.fields.push(key);
  next.rows.forEach((row) => {
    row[key] = value;
  });
  return next;
}

export function removeBusinessField(
  config: ListDetail,
  key: string,
): ListDetail {
  if (config.titleField === key || config.form?.uniqueField === key)
    throw new Error("标题字段和表单唯一字段不能删除。");
  const next = structuredClone(config);
  next.fields = next.fields.filter((f) => f.key !== key);
  next.columns = next.columns.filter((c) => c.field !== key);
  for (const name of ["searchFields", "filters", "detailFields"] as const) {
    next[name] = next[name].filter((value) => value !== key);
    if (name !== "filters" && !next[name].length)
      next[name] = [next.titleField];
  }
  if (next.descriptionField === key) delete next.descriptionField;
  if (next.form)
    next.form.fields = next.form.fields.filter((value) => value !== key);
  next.rows.forEach((row) => {
    delete row[key];
  });
  return next;
}
