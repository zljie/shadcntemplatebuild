// Browser check for the template library and the AI chat panel.
// The /api/ai/chat response is produced by the real page agent with a scripted MockProvider,
// so the UI path (stream parsing → dispatch → undo → save template) is exercised without a model key.
// Usage: COMPOSER_URL=http://127.0.0.1:3100 npx tsx scripts/verify-ai-chat.mts
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { runPageAgent } from "../src/ai/page-agent";
import { MockProvider } from "../src/llm/providers/mock";
import { makeNode } from "../src/core/registry";
import type { PageDocument } from "../src/core/schema";

const base = process.env.COMPOSER_URL ?? "http://127.0.0.1:3100";
const out = "test-results/ai-chat";
await mkdir(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (ok: unknown, label: string) => {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log("✓", label);
};

await page.route("**/api/ai/chat", async (route) => {
  if (route.request().method() === "GET")
    return route.fulfill({
      json: {
        provider: "deepseek",
        label: "DeepSeek",
        model: "deepseek-flash",
        configured: true,
        thinking: false,
      },
    });
  const body = route.request().postDataJSON() as {
    messages: { role: "user"; content: string }[];
    document: PageDocument;
  };
  const card = makeNode("shadcn.card", "ai-card");
  card.props = { title: "运行概况" };
  const tabs = makeNode("shadcn.tabs", "ai-tabs");
  const badge = makeNode("shadcn.badge", "ai-badge");
  badge.props = { text: "运行中", variant: "default" };
  const provider = new MockProvider((_r, call) =>
    call === 1
      ? "oops"
      : JSON.stringify({
          reply: "已在标题下方加入带页签的卡片。",
          mode: "commands",
          commands: [
            {
              type: "node.insert",
              node: card,
              target: { parentId: "workspace", slot: "children", index: 1 },
            },
            {
              type: "node.insert",
              node: tabs,
              target: { parentId: "ai-card", slot: "children", index: 0 },
            },
            {
              type: "node.insert",
              node: badge,
              target: { parentId: "ai-tabs", slot: "tab-1", index: 0 },
            },
          ],
        }),
  );
  const lines: string[] = [];
  const result = await runPageAgent({
    provider,
    messages: body.messages,
    document: body.document,
    onEvent: (e) => lines.push(JSON.stringify(e)),
  });
  lines.push(JSON.stringify({ type: "result", ...result }));
  await route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
    body: lines.join("\n") + "\n",
  });
});

await page.goto(base);
await page.getByRole("button", { name: "模板库" }).click();
await page.getByText("图书管理").waitFor();
check(
  (await page.locator(".template-item").count()) >= 3,
  "template library lists seeded templates",
);
await page
  .locator(".template-item", { hasText: "图书管理" })
  .getByRole("button", { name: "打开" })
  .click();
await page.waitForTimeout(400);
check(
  (await page.locator(".page-name").innerText()).includes("图书管理"),
  "opening a template replaces the canvas",
);
await page.screenshot({ path: `${out}/01-template-opened.png` });

await page.getByRole("button", { name: "AI 助手" }).click();
await page.getByText("DeepSeek · deepseek-flash").waitFor();
await page.screenshot({ path: `${out}/02-chat-empty.png` });
await page
  .getByLabel("给 AI 的指令")
  .fill("在标题下方加一个卡片，放两个页签，概览里放运行中徽标");
await page.keyboard.press("Enter");
await page.getByText("已在标题下方加入带页签的卡片。").waitFor();
check(
  (await page.getByText("修正 1 次").count()) === 1,
  "validation repair loop reported",
);
check(
  (await page.locator(".runtime-tabs").count()) === 1,
  "AI change applied to canvas (tabs rendered)",
);
check(
  (await page.getByText("运行中", { exact: true }).count()) >= 1,
  "badge rendered inside tab panel",
);
await page.screenshot({ path: `${out}/03-ai-applied.png` });

await page.locator(".ai-meta").getByRole("button", { name: "撤销" }).click();
check(
  (await page.locator(".runtime-tabs").count()) === 0,
  "undo from chat removes the whole AI change in one step",
);
await page.getByRole("button", { name: "重做" }).click();
check((await page.locator(".runtime-tabs").count()) === 1, "redo restores it");

await page.getByRole("button", { name: "预览" }).click();
await page.getByRole("tab", { name: "详情" }).click();
check(
  (await page
    .getByRole("tab", { name: "详情" })
    .getAttribute("aria-selected")) === "true",
  "tabs switch in preview mode",
);
await page.screenshot({ path: `${out}/04-preview-tabs.png` });
await page.getByRole("button", { name: "设计" }).click();

await page.getByRole("button", { name: "满意？保存为模板" }).click();
await page.getByLabel("模板 ID").fill("books-with-tabs");
await page.getByLabel("名称").fill("图书管理（带概况）");
await page.getByRole("button", { name: "保存模板" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/05-save-template.png` });
console.log(
  "status:",
  await page.locator(".status-message").innerText(),
  "|",
  await page.locator(".template-error").allInnerTexts(),
);
await page.getByText("已保存模板「图书管理（带概况）」").waitFor();
const saved = await (
  await fetch(`${base}/api/templates/books-with-tabs`)
).json();
check(
  JSON.stringify(saved.template.document).includes("ai-tabs"),
  "saved template persisted to the shared library",
);
const item = await (
  await fetch(`${base}/r/template-books-with-tabs.json`)
).json();
check(
  item.files[0].content.includes("TabsBlock"),
  "saved template is immediately installable from the shadcn registry",
);

check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
