import { expect, it } from "vitest";
import { runPageAgent } from "../src/ai/page-agent";
import { MockProvider } from "../src/llm/providers/mock";
import { pageProtocol } from "../src/core/page-protocol";
import { addBusinessField } from "../src/core/business-fields";
import { execute } from "../src/core/commands";
import { validateDocument } from "../src/core/validation";

it("supplies field guidance to the model and applies a business-field edit as one reversible command", async () => {
  const document = pageProtocol().formTemplate;
  const config = addBusinessField(document.listDetail, "number");
  const provider = new MockProvider((request) => {
    const system = request.messages.find(
      (message) => message.role === "system",
    )!.content;
    const components = JSON.parse(
      system.split("\n").find((line) => line.startsWith('[{"componentRef":'))!,
    );
    expect(
      components.find(
        (c: { componentRef: string }) =>
          c.componentRef === "composite.data-table",
      ).ai.instructions,
    ).toContain("document.listDetail");
    expect(
      components.find(
        (c: { componentRef: string }) => c.componentRef === "shadcn.button",
      ).ai.fields.message,
    ).toContain("真实业务操作");
    return JSON.stringify({
      mode: "commands",
      reply: "已添加数字字段",
      commands: [{ type: "page.listDetail", listDetail: config }],
    });
  });
  const result = await runPageAgent({
    provider,
    document,
    messages: [{ role: "user", content: "给列表、详情和表单增加一个数字字段" }],
  });
  expect(result.attempts).toBe(1);
  expect(validateDocument(result.document)).toEqual([]);
  const applied = execute(document, 0, {
    id: "ai",
    timestamp: "",
    actor: { type: "agent", id: "test" },
    pageId: document.id,
    baseRevision: 0,
    command: result.command!,
  });
  expect(applied.success && applied.document).toEqual(result.document);
  if (!applied.success) throw new Error(JSON.stringify(applied.errors));
  const undone = execute(applied.document, 1, {
    id: "undo",
    timestamp: "",
    actor: { type: "human", id: "test" },
    pageId: document.id,
    baseRevision: 1,
    command: applied.inverseCommand,
  });
  expect(undone.success && undone.document).toEqual(document);
});
