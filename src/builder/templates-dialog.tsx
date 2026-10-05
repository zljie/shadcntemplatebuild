"use client";
import { useEffect, useState } from "react";
import {
  FolderOpen,
  LayoutTemplate,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBuilder } from "@/core/store";
import type { Template, TemplateMeta } from "@/core/templates";

export type TemplateRef = {
  id: string;
  name: string;
  description: string;
  tags: string[];
};
async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? `请求失败 ${response.status}`);
  return value as T;
}
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

/** Browse the shared file-backed template library and open one into the canvas. */
export function TemplateLibraryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTemplate: (template: Template) => void;
}) {
  return props.open ? <TemplateLibrary {...props} /> : null;
}
function TemplateLibrary({
  open,
  onOpenChange,
  onOpenTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTemplate: (template: Template) => void;
}) {
  const [templates, setTemplates] = useState<TemplateMeta[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function refresh() {
    try {
      const list = (
        await json<{ templates: TemplateMeta[] }>(
          await fetch("/api/templates", { cache: "no-store" }),
        )
      ).templates;
      setTemplates(list);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "模板库加载失败");
    }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/templates", { cache: "no-store" })
      .then((r) => json<{ templates: TemplateMeta[] }>(r))
      .then((r) => {
        if (active) setTemplates(r.templates);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "模板库加载失败");
      });
    return () => {
      active = false;
    };
  }, []);
  async function openTemplate(id: string) {
    setBusy(id);
    try {
      onOpenTemplate(
        (
          await json<{ template: Template }>(
            await fetch(`/api/templates/${id}`, { cache: "no-store" }),
          )
        ).template,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "模板打开失败");
    } finally {
      setBusy("");
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm(`删除模板「${id}」？此操作会删除 templates/${id}.json。`)
    )
      return;
    setBusy(id);
    try {
      await json(await fetch(`/api/templates/${id}`, { method: "DELETE" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy("");
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="template-dialog">
        <DialogTitle>模板库</DialogTitle>
        <DialogDescription>
          模板保存在项目的 templates/ 目录，编辑器、MCP（list_templates /
          get_template）与 shadcn registry 共用同一份。
        </DialogDescription>
        {error && (
          <p className="template-error" role="alert">
            {error}
          </p>
        )}
        <div className="template-list" aria-busy={templates === null}>
          {templates === null && !error && (
            <p className="template-empty">正在加载…</p>
          )}
          {templates?.length === 0 && (
            <p className="template-empty">
              还没有模板。设计页面后点击“保存为模板”。
            </p>
          )}
          {templates?.map((t) => (
            <article key={t.id} className="template-item">
              <LayoutTemplate size={18} />
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.id} · {t.source} · {new Date(t.updatedAt).toLocaleString()}
                </small>
                {t.description && <p>{t.description}</p>}
                {t.tags.length > 0 && (
                  <span className="template-tags">
                    {t.tags.map((tag) => (
                      <i key={tag}>{tag}</i>
                    ))}
                  </span>
                )}
              </div>
              <span className="template-actions">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={() => openTemplate(t.id)}
                >
                  <FolderOpen size={13} />
                  打开
                </Button>
                <button
                  className="icon-button"
                  aria-label={`删除模板 ${t.name}`}
                  disabled={!!busy}
                  onClick={() => remove(t.id)}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </article>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw size={13} />
            刷新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Save the current canvas into the template library (overwrites a template with the same id). */
type SaveProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: TemplateRef | null;
  onSaved: (ref: TemplateRef) => void;
};
export function SaveTemplateDialog(props: SaveProps) {
  return props.open ? <SaveTemplate {...props} /> : null;
}
function SaveTemplate({ open, onOpenChange, current, onSaved }: SaveProps) {
  const document = useBuilder((s) => s.document);
  const [form, setForm] = useState<TemplateRef>(
    () =>
      current ?? {
        id: slug(document.id) || "page",
        name: document.name,
        description: "",
        tags: [],
      },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await json(
        await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, document }),
        }),
      );
      onSaved(form);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>保存为模板</DialogTitle>
        <DialogDescription>
          保存到 templates/{form.id || "<id>"}.json。相同 ID 会覆盖原模板。其他
          AI 可通过 MCP 读取。
        </DialogDescription>
        <label className="inspector-field">
          模板 ID
          <input
            value={form.id}
            maxLength={63}
            placeholder="例如 order-list"
            onChange={(e) =>
              setForm({
                ...form,
                id: slug(e.target.value) || e.target.value.toLowerCase(),
              })
            }
          />
        </label>
        <label className="inspector-field">
          名称
          <input
            value={form.name}
            maxLength={80}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="inspector-field">
          说明
          <textarea
            value={form.description}
            maxLength={500}
            rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="inspector-field">
          标签（逗号分隔）
          <input
            value={form.tags.join(",")}
            onChange={(e) =>
              setForm({
                ...form,
                tags: e.target.value
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .slice(0, 10),
              })
            }
          />
        </label>
        {error && (
          <p className="template-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={saving || !form.id || !form.name.trim()}
            onClick={save}
          >
            <Save size={13} />
            {saving ? "保存中…" : "保存模板"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
