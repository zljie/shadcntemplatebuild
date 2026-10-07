import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  Stack,
  StackSlot,
  TabsBlock,
  TabsSlot,
} from "../src/runtime/components";
import { makeNode } from "../src/core/registry";
import { createDocument } from "../src/core/document";
import { PageRenderer } from "../src/runtime/renderer";
import { generateReact } from "../src/core/generator";

it("keeps the same Stack layout for named slots and legacy children, without a single-slot wrapper", () => {
  const widths = { children: "fill", "slot-1": "auto" } as const;
  const slots = {
    children: createElement("span", null, "Left"),
    "slot-1": createElement("span", null, "Right"),
  };
  const current = renderToStaticMarkup(
    createElement(Stack, { slots, slotWidths: widths }),
  );
  const legacy = renderToStaticMarkup(
    createElement(
      Stack,
      null,
      ...Object.entries(slots).map(([name, content]) =>
        createElement(
          StackSlot,
          { name, width: widths[name as keyof typeof widths], key: name },
          content,
        ),
      ),
    ),
  );
  expect(current).toEqual(legacy);
  expect(
    renderToStaticMarkup(createElement(Stack, { slots: { children: "Only" } })),
  ).not.toContain("stack-slot");
});

it("keeps legacy Tabs content and hides empty labels in both editing and preview", () => {
  for (const editing of [true, false]) {
    const props = {
      label1: "Overview",
      label2: "Details",
      label3: "",
      editing,
    };
    const named = renderToStaticMarkup(
      createElement(TabsBlock, {
        ...props,
        slots: { "tab-1": "First", "tab-2": "Second", "tab-3": "Hidden" },
      }),
    );
    const legacy = renderToStaticMarkup(
      createElement(
        TabsBlock,
        props,
        ...["First", "Second", "Hidden"].map((text, i) =>
          createElement(TabsSlot, { name: `tab-${i + 1}`, key: i }, text),
        ),
      ),
    );
    expect(named).toEqual(legacy);
    expect(named).toContain("First");
    if (editing) expect(named).toContain("Second");
    expect(named).not.toContain("Hidden");
  }
});

it("passes editor decorations through nested slots and generates the same named-slot contract", async () => {
  const document = createDocument(true);
  const stack = makeNode("layout.stack", "stack");
  const tabs = makeNode("shadcn.tabs", "tabs");
  const card = makeNode("shadcn.card", "card");
  card.slots.children = [makeNode("shadcn.badge", "badge")];
  tabs.slots["tab-1"] = [card];
  stack.slots = {
    children: [tabs],
    "slot-1": [makeNode("shadcn.button", "button")],
  };
  document.root[0].slots.children = [stack];
  const html = renderToStaticMarkup(
    createElement(PageRenderer, {
      document,
      editing: true,
      slot: (_node, name, children) =>
        createElement("section", { "data-editor-slot": name }, children),
    }),
  );
  expect(html).toContain('data-editor-slot="tab-1"');
  expect(html).toContain('data-slot="slot-1"');
  expect(html).toContain("内容卡片");
  const source = await generateReact(document);
  expect(source).toContain("slots={{");
  expect(source).toContain('"tab-1": (');
  expect(source).not.toContain("TabsSlot");
  expect(source).not.toContain("StackSlot");
});
