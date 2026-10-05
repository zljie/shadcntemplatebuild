import { z } from "zod";
import { applyCommands } from "../core/agent-ops";
import type { Command } from "../core/commands";
import { pageProtocol } from "../core/page-protocol";
import { makeNode, registry } from "../core/registry";
import { validateDocument, type Issue } from "../core/validation";
import type { PageDocument } from "../core/schema";
import type { ChatMessage, LLMProvider, Usage } from "../llm/types";

/**
 * Chat-to-page agent. Provider-agnostic: it only sees LLMProvider.
 * The model answers with a JSON envelope; the result is always converted to editor
 * commands and validated by the same engine as human edits, then repaired in a loop
 * (validation errors are fed back to the model) up to `maxAttempts`.
 */
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; attempt: number; maxAttempts: number }
  | { type: "reasoning"; text: string }
  | { type: "progress"; characters: number }
  | { type: "issues"; attempt: number; errors: Issue[] };

export type AgentResult = {
  reply: string;
  mode: "commands" | "document" | "none";
  /** One batch to dispatch in the editor (undoable as a single step). Absent when mode is none. */
  command?: Command;
  document: PageDocument;
  attempts: number;
  usage: Usage;
  model: string;
};

export type RunAgentInput = {
  provider: LLMProvider;
  /** Conversation so far (user/assistant turns, newest last). The last one must be the user request. */
  messages: ChatMessage[];
  document: PageDocument;
  maxAttempts?: number;
  thinking?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

const envelopeSchema = z.object({
  reply: z.string().max(4000).default(""),
  mode: z.enum(["commands", "document", "none"]),
  commands: z.array(z.unknown()).max(100).optional(),
  document: z.unknown().optional(),
});

export class AgentError extends Error {
  constructor(
    message: string,
    readonly errors: Issue[] = [],
    readonly attempts = 0,
  ) {
    super(message);
  }
}

/** Minimal set of commands that turns `current` into `next` (shell nodes are kept; their children are replaced). */
export function documentToCommands(
  current: PageDocument,
  next: PageDocument,
): Command[] {
  const commands: Command[] = [];
  if (current.name !== next.name)
    commands.push({ type: "page.rename", name: next.name });
  if (
    JSON.stringify(current.listDetail ?? null) !==
    JSON.stringify(next.listDetail ?? null)
  )
    commands.push(
      next.listDetail
        ? { type: "page.listDetail", listDetail: next.listDetail }
        : { type: "page.listDetail" },
    );
  for (const [index, region] of current.root.entries()) {
    const target = next.root[index];
    if (JSON.stringify(region.props) !== JSON.stringify(target.props))
      commands.push({
        type: "node.update",
        nodeId: region.id,
        value: { props: target.props },
      });
    if (
      JSON.stringify(region.slots.children) ===
      JSON.stringify(target.slots.children)
    )
      continue;
    for (const child of [...region.slots.children].reverse())
      commands.push({ type: "node.remove", nodeId: child.id });
    target.slots.children.forEach((child, i) =>
      commands.push({
        type: "node.insert",
        node: child,
        target: { parentId: region.id, slot: "children", index: i },
      }),
    );
  }
  return commands;
}

export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("模型未返回 JSON");
  }
}

function compactSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

let cachedSystemPrompt: string | null = null;
export function buildSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const protocol = pageProtocol();
  const components = Object.entries(registry).map(([ref, d]) => ({
    componentRef: ref,
    name: d.name,
    description: d.description,
    internal: !!d.internal,
    props: compactSchema(d.schema),
    defaults: d.defaults,
    slots: Object.fromEntries(
      Object.entries(d.slots).map(([k, s]) => [
        k,
        { accepts: s.accepts, max: s.max },
      ]),
    ),
    parents: d.parents,
  }));
  const exampleNode = { ...makeNode("shadcn.button", "cta-button") };
  cachedSystemPrompt = [
    "你是 Shadcnplane 页面设计助手。用户在低代码编辑器里通过对话让你生成或修改页面。页面完全由一份 JSON DSL 描述，你只能使用下面登记的组件。",
    "",
    "## 输出格式（必须是单个 JSON 对象，不要 Markdown，不要额外文字）",
    '{"reply":"给用户的中文简短说明（做了什么、有什么限制）","mode":"commands|document|none","commands":[...],"document":{...}}',
    "- mode=commands：小范围修改（增删改移节点、改名、改业务字段），提供 commands 数组，按顺序原子执行。优先使用。",
    "- mode=document：新建页面或大幅重组时，返回完整 document。必须原样保留当前文档的 schemaVersion、id、shell、dependencies，root 必须仍是 [workspace(region.workspace), context(composite.context-panel)] 两个锁定节点，只改它们的 slots.children 与 context 的 props.title。业务数据写在 document.listDetail 里，不要另放 commands。",
    "- mode=none：只回答问题或需求无法用现有组件实现时，说明原因。",
    "",
    "## 命令",
    '- {"type":"node.insert","node":<完整节点>,"target":{"parentId":"<容器节点 id>","slot":"<slot 名>","index":<位置>}}',
    '- {"type":"node.move","nodeId":"...","target":{...}}   - {"type":"node.remove","nodeId":"..."}',
    '- {"type":"node.update","nodeId":"...","value":{"props":{...完整 props},"layout":{...},"tokens":{...},"responsive":{...}}}（value 中给出的键整体替换）',
    '- {"type":"page.rename","name":"..."}   - {"type":"page.listDetail","listDetail":{...完整配置}}（省略 listDetail 表示移除业务配置）',
    "新节点必须是完整结构，id 唯一（字母开头，仅字母数字 _ -），props 必须满足组件 props schema。节点示例：",
    JSON.stringify(exampleNode),
    "layout 可选键：direction(column|row)、gap/padding(space.0|space.2|space.3|space.4|space.6|space.8)、width(width.full|width.auto)、align(start|center|stretch)、hidden。tokens 可选键：surface、radius（取值见规则）。",
    "",
    "## 组件（唯一可用组件，parents 为允许的父组件，slots 为可放子组件的槽位）",
    JSON.stringify(components),
    "",
    "## 页面规则",
    ...protocol.rules.map((rule) => `- ${rule}`),
    "- 使用 Tabs 时子组件放在 slots tab-1/tab-2/tab-3；label 为空的页签不显示。",
    "- 业务列表／详情页（listDetail）需要恰好一个 pattern.page-header、composite.search-bar、composite.data-table（actions 为 row.select→context.open）以及 context 中的 composite.resource-details。不需要列表时可省略 listDetail，用 Card/Tabs/Badge/Button/Input/Stack 自由组合。",
    "- 示例数据 rows 用虚构内容，3–8 条即可；不要生成密码、URL 或真实个人信息。",
    "",
    "## listDetail 示例（带新增／编辑表单）",
    JSON.stringify(protocol.formTemplate.listDetail),
  ].join("\n");
  return cachedSystemPrompt;
}

function issuesText(errors: Issue[]) {
  return errors
    .slice(0, 30)
    .map((e) => `- ${e.path}: ${e.message}`)
    .join("\n");
}

export async function runPageAgent({
  provider,
  messages,
  document,
  maxAttempts = 3,
  thinking,
  signal,
  onEvent,
}: RunAgentInput): Promise<AgentResult> {
  const history = messages.slice(-12);
  const last = history.at(-1);
  if (!last || last.role !== "user") throw new AgentError("缺少用户消息");
  const conversation: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.slice(0, -1),
    {
      role: "user",
      content: `${last.content}\n\n当前页面 DSL（json）：\n${JSON.stringify(document)}`,
    },
  ];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let lastErrors: Issue[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onEvent?.({ type: "attempt", attempt, maxAttempts });
    onEvent?.({
      type: "status",
      message:
        attempt === 1
          ? `${provider.label} · ${provider.model} 正在生成…`
          : `校验未通过，正在第 ${attempt} 次修正…`,
    });
    let text = "";
    for await (const chunk of provider.stream({
      messages: conversation,
      json: true,
      temperature: 0.2,
      maxTokens: 16384,
      thinking,
      signal,
    })) {
      if (chunk.type === "text") {
        text += chunk.text;
        onEvent?.({ type: "progress", characters: text.length });
      } else if (chunk.type === "reasoning")
        onEvent?.({ type: "reasoning", text: chunk.text });
      else if (chunk.usage) {
        usage.inputTokens =
          (usage.inputTokens ?? 0) + (chunk.usage.inputTokens ?? 0);
        usage.outputTokens =
          (usage.outputTokens ?? 0) + (chunk.usage.outputTokens ?? 0);
      }
    }
    let errors: Issue[];
    try {
      const envelope = envelopeSchema.parse(extractJson(text));
      if (envelope.mode === "none")
        return {
          reply: envelope.reply || "未修改页面。",
          mode: "none",
          document,
          attempts: attempt,
          usage,
          model: provider.model,
        };
      let commands: unknown[];
      if (envelope.mode === "document") {
        const documentErrors = validateDocument(envelope.document);
        if (documentErrors.length)
          throw new IssueList(
            documentErrors.map((e) => ({ ...e, path: `document.${e.path}` })),
          );
        const next = envelope.document as PageDocument;
        if (
          next.id !== document.id ||
          JSON.stringify(next.shell) !== JSON.stringify(document.shell)
        )
          throw new IssueList([
            { path: "document", message: "必须保留当前文档的 id 与 shell" },
          ]);
        // Models sometimes return a document plus extra commands (e.g. page.listDetail); apply both, document first.
        commands = [
          ...documentToCommands(document, next),
          ...(envelope.commands ?? []),
        ];
        if (!commands.length)
          return {
            reply: envelope.reply || "页面无变化。",
            mode: "none",
            document,
            attempts: attempt,
            usage,
            model: provider.model,
          };
      } else {
        commands = envelope.commands ?? [];
        if (!commands.length)
          throw new IssueList([
            { path: "commands", message: "mode=commands 时 commands 不能为空" },
          ]);
      }
      const applied = applyCommands(document, commands);
      if (!applied.ok) throw new IssueList(applied.errors);
      const command: Command =
        commands.length === 1
          ? (commands[0] as Command)
          : { type: "batch", commands: commands as Command[] };
      return {
        reply: envelope.reply || "已更新页面。",
        mode: envelope.mode,
        command,
        document: applied.document,
        attempts: attempt,
        usage,
        model: provider.model,
      };
    } catch (error) {
      errors =
        error instanceof IssueList
          ? error.errors
          : [
              {
                path: "output",
                message:
                  error instanceof Error ? error.message : "无法解析输出",
              },
            ];
    }
    lastErrors = errors;
    onEvent?.({ type: "issues", attempt, errors });
    conversation.push({ role: "assistant", content: text.slice(0, 60_000) });
    conversation.push({
      role: "user",
      content: `上一次输出未通过校验，页面未改变：\n${issuesText(errors)}\n请基于同一份当前页面 DSL 修正，并只返回完整 JSON 对象。`,
    });
  }
  throw new AgentError(
    `连续 ${maxAttempts} 次未生成合法页面，页面未改变。`,
    lastErrors,
    maxAttempts,
  );
}

class IssueList extends Error {
  constructor(readonly errors: Issue[]) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join("；"));
  }
}
