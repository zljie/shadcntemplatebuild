"use client";
import { useState } from "react";
import {
  addBusinessField,
  changeBusinessFieldType,
  removeBusinessField,
  updateBusinessField,
} from "@/core/business-fields";
import { useBuilder } from "@/core/store";
import { validateDocument } from "@/core/validation";
import {
  resourceListDetail,
  type ListDetail,
  type RecordField,
} from "@/runtime/data";

export function BusinessFields() {
  const config = useBuilder((s) => s.document.listDetail);
  const [newType, setNewType] = useState<RecordField["type"]>("text");
  const [draft, setDraft] = useState<ListDetail | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [error, setError] = useState("");
  function edit(update: () => ListDetail) {
    try {
      setDraft(update());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "字段修改失败");
    }
  }
  function apply() {
    if (!draft) return;
    const state = useBuilder.getState();
    if (state.revision !== baseRevision) {
      setError("页面已变化，请取消后重新编辑字段配置。");
      return;
    }
    const issues = validateDocument({ ...state.document, listDetail: draft });
    if (issues.length) {
      setError(issues.map((e) => `${e.path}：${e.message}`).join("；"));
      return;
    }
    if (state.dispatch({ type: "page.listDetail", listDetail: draft })) {
      setDraft(null);
      setError("");
    }
  }
  function move(index: number, direction: number) {
    if (!draft) return;
    const next = structuredClone(draft);
    [next.fields[index], next.fields[index + direction]] = [
      next.fields[index + direction],
      next.fields[index],
    ];
    const order = new Map(next.fields.map((f, i) => [f.key, i]));
    next.columns.sort((a, b) => order.get(a.field)! - order.get(b.field)!);
    next.detailFields.sort((a, b) => order.get(a)! - order.get(b)!);
    next.form?.fields.sort((a, b) => order.get(a)! - order.get(b)!);
    setDraft(next);
  }
  return (
    <section className="inspector-section business-fields">
      <h3>业务字段</h3>
      {!draft ? (
        <>
          <p className="inspector-note">列表、详情和表单共用字段配置。</p>
          <button
            onClick={() => {
              setBaseRevision(useBuilder.getState().revision);
              setDraft(structuredClone(config ?? resourceListDetail));
              setError("");
            }}
          >
            编辑业务字段
          </button>
        </>
      ) : (
        <>
          <p className="inspector-note">
            修改后点击应用。删除字段也会移除其示例数据；标题和唯一字段保留。
          </p>
          {draft.fields.map((field, index) => (
            <fieldset key={field.key} className="business-field">
              <legend>{field.label || field.key}</legend>
              <FieldSettings
                field={field}
                form={!!draft.form}
                unique={draft.form?.uniqueField === field.key}
                onChange={(value) =>
                  edit(() => updateBusinessField(draft, field.key, value))
                }
                onType={(type) =>
                  edit(() => changeBusinessFieldType(draft, field.key, type))
                }
              />
              <div className="business-field-actions">
                <button
                  aria-label={`上移 ${field.label}`}
                  disabled={!index}
                  onClick={() => move(index, -1)}
                >
                  上移
                </button>
                <button
                  aria-label={`下移 ${field.label}`}
                  disabled={index === draft.fields.length - 1}
                  onClick={() => move(index, 1)}
                >
                  下移
                </button>
                <button
                  aria-label={`删除字段 ${field.label}`}
                  disabled={
                    draft.titleField === field.key ||
                    draft.form?.uniqueField === field.key
                  }
                  onClick={() =>
                    edit(() => removeBusinessField(draft, field.key))
                  }
                >
                  删除
                </button>
              </div>
            </fieldset>
          ))}
          {error && (
            <p role="alert" className="business-field-error">
              {error}
            </p>
          )}
          <label className="inspector-field">
            <span>新字段类型</span>
            <select
              value={newType}
              onChange={(e) =>
                setNewType(e.target.value as RecordField["type"])
              }
            >
              <option value="text">文本</option>
              <option value="number">数字</option>
              <option value="boolean">布尔</option>
            </select>
          </label>
          <div className="business-field-actions">
            <button
              disabled={draft.fields.length >= 20}
              onClick={() => edit(() => addBusinessField(draft, newType))}
            >
              添加字段
            </button>
            <button onClick={apply}>应用字段配置</button>
            <button
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              取消
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function FieldSettings({
  field,
  form,
  unique,
  onChange,
  onType,
}: {
  field: RecordField;
  form: boolean;
  unique: boolean;
  onChange: (field: RecordField) => void;
  onType: (type: RecordField["type"]) => void;
}) {
  const [key, setKey] = useState(field.key);
  function number(
    property: "min" | "max" | "minLength" | "maxLength",
    value: string,
  ) {
    const next = { ...field };
    if (value === "") delete next[property];
    else next[property] = Number(value);
    onChange(next);
  }
  return (
    <>
      <label className="inspector-field">
        <span>字段标识</span>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => {
            if (key !== field.key) onChange({ ...field, key });
          }}
          maxLength={40}
        />
      </label>
      <label className="inspector-field">
        <span>显示名称</span>
        <input
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          maxLength={40}
        />
      </label>
      <label className="inspector-field">
        <span>字段类型</span>
        <select
          value={field.type}
          disabled={unique}
          onChange={(e) => onType(e.target.value as RecordField["type"])}
        >
          <option value="text">文本</option>
          <option value="number">数字</option>
          <option value="boolean">布尔</option>
        </select>
      </label>
      {field.type === "boolean" && (
        <>
          {(["trueLabel", "falseLabel"] as const).map((property) => (
            <label className="inspector-field" key={property}>
              <span>
                {property === "trueLabel" ? "是的显示文案" : "否的显示文案"}
              </span>
              <input
                value={
                  field[property] ??
                  field.options?.find(
                    (option) => option.value === (property === "trueLabel"),
                  )?.label ??
                  (property === "trueLabel" ? "是" : "否")
                }
                onChange={(e) =>
                  onChange({
                    ...field,
                    [property]: e.target.value,
                    ...(field.options
                      ? {
                          options: field.options.map((option) =>
                            option.value === (property === "trueLabel")
                              ? { ...option, label: e.target.value }
                              : option,
                          ),
                        }
                      : {}),
                  })
                }
                maxLength={40}
              />
            </label>
          ))}
        </>
      )}
      {form && (
        <>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={!!field.required}
              disabled={unique}
              onChange={(e) =>
                onChange({ ...field, required: e.target.checked })
              }
            />
            必填
          </label>
          <label className="inspector-field">
            <span>默认值</span>
            {field.options ? (
              <select
                value={String(field.default ?? "")}
                onChange={(e) =>
                  onChange({
                    ...field,
                    default:
                      field.options!.find(
                        (option) => String(option.value) === e.target.value,
                      )?.value ?? "",
                  })
                }
              >
                {field.type === "text" && <option value="">空值</option>}
                {field.options.map((option) => (
                  <option
                    key={String(option.value)}
                    value={String(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <select
                value={String(field.default ?? false)}
                onChange={(e) =>
                  onChange({ ...field, default: e.target.value === "true" })
                }
              >
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : (
              <input
                type={field.type === "number" ? "number" : "text"}
                value={String(field.default ?? "")}
                onChange={(e) =>
                  onChange({
                    ...field,
                    default:
                      field.type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
          </label>
          {field.type !== "boolean" &&
            (field.type === "number"
              ? (["min", "max"] as const)
              : (["minLength", "maxLength"] as const)
            ).map((property) => (
              <label className="inspector-field" key={property}>
                <span>
                  {
                    {
                      min: "最小值",
                      max: "最大值",
                      minLength: "最小长度",
                      maxLength: "最大长度",
                    }[property]
                  }
                </span>
                <input
                  type="number"
                  value={field[property] ?? ""}
                  onChange={(e) => number(property, e.target.value)}
                />
              </label>
            ))}
          {field.type === "number" && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={!!field.integer}
                onChange={(e) =>
                  onChange({ ...field, integer: e.target.checked })
                }
              />
              仅限整数
            </label>
          )}
        </>
      )}
    </>
  );
}
