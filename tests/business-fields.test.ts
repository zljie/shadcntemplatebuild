import { describe, expect, it } from "vitest";
import {
  addBusinessField,
  changeBusinessFieldType,
  removeBusinessField,
  updateBusinessField,
} from "../src/core/business-fields";
import { pageProtocol } from "../src/core/page-protocol";
import { execute, type Command } from "../src/core/commands";
import { validateDocument } from "../src/core/validation";
import { exportProject } from "../src/core/export-project";
import type { PageDocument } from "../src/core/schema";
import type { ListDetail } from "../src/runtime/data";

describe("business field editing", () => {
  it("renames references and fixtures together, preserves input, and reverses/exports one edit", async () => {
    const document = pageProtocol().formTemplate;
    const original = structuredClone(document);
    const config = document.listDetail as ListDetail;
    let next = updateBusinessField(config, "name", {
      ...config.fields[0],
      key: "title",
      label: "标题",
    });
    next = addBusinessField(next, "boolean");
    next = removeBusinessField(next, "category");
    const run = (doc: PageDocument, command: Command, revision: number) =>
      execute(doc, revision, {
        id: "test",
        timestamp: "",
        actor: { type: "human", id: "test" },
        pageId: doc.id,
        baseRevision: revision,
        command,
      });
    const result = run(
      document,
      { type: "page.listDetail", listDetail: next },
      0,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.errors));
    expect(document).toEqual(original);
    expect(validateDocument(result.document)).toEqual([]);
    expect(next).toMatchObject({
      titleField: "title",
      form: { uniqueField: "title", fields: ["title", "quantity", "field1"] },
      searchFields: ["title"],
      filters: [],
    });
    expect(next.rows[0]).toEqual({
      id: "example-01",
      title: "示例记录",
      quantity: 0,
      field1: false,
    });
    const restored = run(result.document, result.inverseCommand, 1);
    expect(restored.success && restored.document).toEqual(original);
    const files = await exportProject(result.document);
    expect(JSON.parse(files["page.dsl.json"])).toEqual(result.document);
    expect(files["src/app/page.tsx"]).toContain("标题");
  });
  it("converts compatible values and rejects data loss, collisions and protected keys", () => {
    const config = pageProtocol().formTemplate.listDetail as ListDetail;
    expect(
      changeBusinessFieldType(config, "quantity", "boolean").rows[0].quantity,
    ).toBe(false);
    expect(
      changeBusinessFieldType(config, "quantity", "text").rows[0].quantity,
    ).toBe("0");
    expect(() => changeBusinessFieldType(config, "category", "number")).toThrow(
      "无法转换",
    );
    expect(() => removeBusinessField(config, "name")).toThrow("不能删除");
    for (const key of ["quantity", "__proto__", "id", "invalid-key"])
      expect(() =>
        updateBusinessField(config, "name", { ...config.fields[0], key }),
      ).toThrow();
    const next = structuredClone(config);
    next.fields[2].min = 10;
    expect(
      validateDocument({ ...pageProtocol().formTemplate, listDetail: next })
        .length,
    ).toBeGreaterThan(0);
  });
});
