"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  BookmarkPlus,
  Bot,
  Brain,
  CircleAlert,
  Loader2,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  User,
  X,
} from "lucide-react";
import { useBuilder } from "@/core/store";
import type { Command } from "@/core/commands";

type ProviderStatus = {
  provider: string;
  label: string;
  model: string;
  configured: boolean;
  thinking: boolean;
};
type Issue = { path: string; message: string };
type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  status?: string;
  reasoning?: string;
  error?: { message: string; errors?: Issue[] };
  result?: {
    mode: string;
    attempts: number;
    model: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    applied: boolean;
    command?: Command;
  };
};

const suggestions = [
  "生成一个订单管理页面：订单号、客户、金额、状态（待支付/已支付/已取消），支持搜索订单号和客户、按状态筛选，可新增和编辑",
  "在页面标题下方加一个卡片，里面放两个页签：概览放一个“运行中”的徽标，帮助放一个“查看文档”按钮",
  "把表格改成紧凑行距，搜索框提示改为“输入关键字搜索…”",
];

/** Chat with the configured LLM to generate or modify the current page. Results are applied as one undoable command. */
export function AiChatPanel({
  onClose,
  onSaveTemplate,
}: {
  onClose: () => void;
  onSaveTemplate: () => void;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [thinking, setThinking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai/chat", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: ProviderStatus) => {
        setStatus(s);
        setThinking(s.thinking);
      })
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  const update = (
    id: string,
    patch: Partial<ChatEntry> | ((entry: ChatEntry) => Partial<ChatEntry>),
  ) =>
    setEntries((list) =>
      list.map((e) =>
        e.id === id
          ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) }
          : e,
      ),
    );

  async function send(text = input) {
    const content = text.trim();
    if (!content || busy) return;
    const store = useBuilder.getState();
    if (store.mode === "code") store.setMode("edit");
    const user: ChatEntry = { id: crypto.randomUUID(), role: "user", content };
    const assistant: ChatEntry = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
      status: "正在连接模型…",
    };
    const history = [
      ...entries.filter((e) => !e.pending && (e.role === "user" || e.content)),
      user,
    ]
      .slice(-12)
      .map((e) => ({
        role: e.role,
        content:
          e.role === "assistant" ? e.content || "（未修改页面）" : e.content,
      }));
    setEntries((list) => [...list, user, assistant]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const sentRevision = store.revision;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          document: store.document,
          thinking,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const error = await response
          .json()
          .catch(() => ({ error: `请求失败 ${response.status}` }));
        throw Object.assign(new Error(error.error ?? "请求失败"), {
          errors: error.errors,
        });
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) handle(assistant.id, JSON.parse(line), sentRevision);
        }
      }
      if (buffer.trim()) handle(assistant.id, JSON.parse(buffer), sentRevision);
      update(assistant.id, (e) =>
        e.pending
          ? {
              pending: false,
              error: e.error ?? { message: "连接意外结束，页面未改变" },
            }
          : {},
      );
    } catch (error) {
      const aborted = controller.signal.aborted;
      update(assistant.id, {
        pending: false,
        error: {
          message: aborted
            ? "已停止生成，页面未改变"
            : error instanceof Error
              ? error.message
              : "请求失败",
          errors: (error as { errors?: Issue[] }).errors,
        },
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function handle(
    id: string,
    event: Record<string, unknown>,
    sentRevision: number,
  ) {
    switch (event.type) {
      case "status":
        update(id, { status: String(event.message) });
        break;
      case "progress":
        update(id, (e) => ({
          status: `${e.status?.split(" · 已输出")[0] ?? "生成中"} · 已输出 ${event.characters} 字符`,
        }));
        break;
      case "reasoning":
        update(id, (e) => ({
          reasoning: (e.reasoning ?? "") + String(event.text),
        }));
        break;
      case "issues":
        update(id, {
          status: `第 ${event.attempt} 次输出未通过校验（${(event.errors as Issue[]).length} 处），自动修正中…`,
        });
        break;
      case "error":
        update(id, {
          pending: false,
          error: {
            message: String(event.message),
            errors: event.errors as Issue[] | undefined,
          },
        });
        break;
      case "result": {
        const command = event.command as Command | undefined;
        const store = useBuilder.getState();
        let applied = false;
        let note = "";
        if (command) {
          applied = store.dispatch(command);
          if (!applied)
            note = `\n\n⚠️ 无法应用到当前画布：${useBuilder.getState().message}${store.revision !== sentRevision ? "（生成期间页面已被修改，请重新发送）" : ""}`;
          else useBuilder.getState().notify("AI 修改已应用 · ⌘Z 可撤销");
        }
        update(id, {
          pending: false,
          content: String(event.reply ?? "") + note,
          result: {
            mode: String(event.mode),
            attempts: Number(event.attempts),
            model: String(event.model),
            usage: event.usage as
              { inputTokens?: number; outputTokens?: number } | undefined,
            applied,
            command,
          },
        });
        break;
      }
    }
  }

  function undo(entry: ChatEntry) {
    const store = useBuilder.getState();
    if (store.undo.at(-1)?.command !== entry.result?.command) {
      store.notify("之后已有其他修改；请使用工具栏撤销按钮逐步撤销");
      return;
    }
    store.undoOnce();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  }

  const undoStack = useBuilder((s) => s.undo);
  const active = (entry: ChatEntry) =>
    !!entry.result?.command &&
    undoStack.some((h) => h.command === entry.result!.command);
  const lastApplied = [...entries].reverse().find(active);
  return (
    <aside className="ai-panel" aria-label="AI 助手">
      <header className="ai-header">
        <span className="ai-title">
          <Sparkles size={15} />
          AI 助手
        </span>
        <span
          className="ai-model"
          title={status ? `${status.label} · ${status.model}` : ""}
        >
          {status
            ? status.configured
              ? `${status.label} · ${status.model}`
              : `${status.label} 未配置`
            : "…"}
        </span>
        <button
          className="icon-button"
          aria-label="清空对话"
          title="清空对话"
          disabled={busy || !entries.length}
          onClick={() => setEntries([])}
        >
          <Trash2 size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="关闭 AI 助手"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <div className="ai-messages" ref={scroller} aria-live="polite">
        {!entries.length && (
          <div className="ai-empty">
            <Bot size={26} />
            <p>
              描述你想要的页面，AI
              会用已登记的组件生成或修改当前画布。每次结果都经过校验，可一键撤销。
            </p>
            {status && !status.configured && (
              <p className="ai-warning">
                <CircleAlert size={13} />
                服务端未配置模型。在 .env.local 设置 DEEPSEEK_API_KEY 后重启。
              </p>
            )}
            {suggestions.map((s) => (
              <button
                key={s}
                className="ai-suggestion"
                disabled={busy}
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {entries.map((entry) => (
          <article key={entry.id} className={`ai-message ${entry.role}`}>
            <span className="ai-avatar">
              {entry.role === "user" ? <User size={13} /> : <Bot size={13} />}
            </span>
            <div className="ai-bubble">
              {entry.pending && (
                <p className="ai-status">
                  <Loader2 size={13} className="spin" />
                  {entry.status}
                </p>
              )}
              {entry.reasoning && (
                <details className="ai-reasoning">
                  <summary>
                    <Brain size={12} />
                    思考过程
                  </summary>
                  <pre>{entry.reasoning}</pre>
                </details>
              )}
              {entry.content && <p className="ai-text">{entry.content}</p>}
              {entry.error && (
                <div className="ai-error" role="alert">
                  <strong>{entry.error.message}</strong>
                  {entry.error.errors?.length ? (
                    <ul>
                      {entry.error.errors.slice(0, 8).map((e, i) => (
                        <li key={i}>
                          <code>{e.path}</code> {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              {entry.result && (
                <footer className="ai-meta">
                  <span>
                    {entry.result.mode === "none"
                      ? "未修改页面"
                      : !entry.result.applied
                        ? "未应用"
                        : active(entry)
                          ? "已应用到画布"
                          : "已撤销"}
                  </span>
                  <span>
                    · {entry.result.model}
                    {entry.result.attempts > 1
                      ? ` · 修正 ${entry.result.attempts - 1} 次`
                      : ""}
                    {entry.result.usage?.outputTokens
                      ? ` · ${entry.result.usage.outputTokens} tokens`
                      : ""}
                  </span>
                  {active(entry) && (
                    <button onClick={() => undo(entry)}>
                      <Undo2 size={12} />
                      撤销
                    </button>
                  )}
                </footer>
              )}
            </div>
          </article>
        ))}
      </div>
      {lastApplied && !busy && (
        <button className="ai-save-template" onClick={onSaveTemplate}>
          <BookmarkPlus size={13} />
          满意？保存为模板
        </button>
      )}
      <div className="ai-composer">
        <textarea
          value={input}
          rows={3}
          maxLength={4000}
          placeholder="例如：做一个客户管理页，字段有姓名、电话、等级…（Enter 发送，Shift+Enter 换行）"
          aria-label="给 AI 的指令"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!status?.configured && status !== null}
        />
        <div className="ai-composer-bar">
          <label
            className="ai-thinking"
            title="启用模型思考模式：更慢，复杂页面更可靠"
          >
            <input
              type="checkbox"
              checked={thinking}
              onChange={(e) => setThinking(e.target.checked)}
              disabled={busy}
            />
            深度思考
          </label>
          {busy ? (
            <button
              className="ai-send stop"
              onClick={() => abort.current?.abort()}
              aria-label="停止生成"
            >
              <Square size={13} />
              停止
            </button>
          ) : (
            <button
              className="ai-send"
              disabled={
                !input.trim() || (status !== null && !status.configured)
              }
              onClick={() => void send()}
              aria-label="发送"
            >
              <SendHorizontal size={14} />
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
