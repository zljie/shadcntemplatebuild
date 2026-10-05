// Seeds the template library from the built-in document and the AI-generated examples.
// Usage: npx tsx scripts/seed-templates.mts   (existing templates with the same id are replaced)
import { readFile } from "node:fs/promises";
import { createDocument } from "../src/core/document";
import { saveTemplate } from "../src/core/templates";

const seeds = [
  {
    id: "resource-center",
    name: "资源中心",
    description: "默认列表／详情页：技能、MCP、文档资源的搜索、筛选与详情。",
    tags: ["列表", "详情"],
    document: createDocument(),
  },
  {
    id: "books",
    name: "图书管理",
    description: "图书列表／详情，含新增与编辑表单（示例数据）。",
    tags: ["列表", "表单", "CRUD"],
    document: JSON.parse(await readFile("examples/books.dsl.json", "utf8")),
  },
  {
    id: "users",
    name: "用户管理",
    description:
      "用户列表／详情，角色与启用状态筛选，新增与编辑表单（示例数据）。",
    tags: ["列表", "表单", "CRUD"],
    document: JSON.parse(await readFile("examples/users.dsl.json", "utf8")),
  },
];
for (const seed of seeds) {
  const result = await saveTemplate({ ...seed, source: "seed" });
  if (!result.ok)
    throw new Error(
      `${seed.id}: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  console.log("seeded", seed.id);
}
