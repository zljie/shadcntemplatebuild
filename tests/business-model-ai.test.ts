import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseBusinessModelYaml, type BusinessModel } from "../src/business-model/model";
import { parseScenarios, ruleBasedScenarios, uncoveredCommands, validateScenario, type ScenarioDraft } from "../src/business-model/sandbox";
import { appDesignPlanSchema, applyModule, checkPlan, ruleBasedPlan } from "../src/business-model/app-design";
import { toObjectType } from "../src/business-model/model";
import { MockProvider } from "../src/llm/providers/mock";

const yaml = readFileSync("docs/business-model/campus_library.yaml", "utf8");
const parsed = parseBusinessModelYaml(yaml);
if (!parsed.ok) throw new Error("fixture");
const model: BusinessModel = parsed.model;

const borrow: ScenarioDraft = parseScenarios({scenarios: [{
  id: "librarian_lends_copy", name: "馆员为读者借出副本", goal: "借出", trigger: "读者到柜台", actors: ["LIBRARIAN"],
  steps: [
    {actor: "LIBRARIAN", action: "library_available_copies", reads: ["book_copy"]},
    {actor: "LIBRARIAN", action: "library_loan_borrow", writes: ["loan", "book_copy"], stateChange: {entity: "book_copy", field: "status", from: "AVAILABLE", to: "ON_LOAN"}, events: ["BORROW"], rules: ["rule/unique_copy_loan"]},
  ],
  exceptions: [{when: "副本不可借", handling: "拒绝", rules: ["rule/copy_available"]}], metrics: ["open_loan_count"],
}]}).scenarios[0];

describe("sandbox scenarios", () => {
  it("accepts a scenario that only uses model elements", () => {
    expect(borrow).toBeDefined();
    expect(validateScenario(model, borrow)).toEqual([]);
  });
  it("flags unknown references, wrong roles and invalid state values", () => {
    const bad: ScenarioDraft = {...borrow, actors: ["GHOST"], steps: [
      {...borrow.steps[1], actor: "READER"},
      {...borrow.steps[1], action: "nope", rules: ["rule/missing"], stateChange: {entity: "book_copy", field: "status", to: "FLYING"}},
    ]};
    const messages = validateScenario(model, bad).map(i => `${i.path} ${i.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining("actors[0] 角色 GHOST 不存在"),
      expect.stringContaining("steps[0].actor READER 无权执行 library_loan_borrow"),
      expect.stringContaining("steps[1].action 操作 nope 不存在"),
      expect.stringContaining("steps[1].rules[0] 规则 rule/missing 不存在"),
      expect.stringContaining("steps[1].stateChange.to 状态值 FLYING"),
    ]));
  });
  it("drops malformed scenarios and reports them", () => {
    const result = parseScenarios({scenarios: [{id: "Bad Id", name: "x", steps: []}, {id: "ok_one", name: "好", steps: [{actor: "ADMIN", action: "library_role_grant"}]}]});
    expect(result.scenarios.map(s => s.id)).toEqual(["ok_one"]);
    expect(result.problems).toHaveLength(1);
    expect(parseScenarios({nothing: true}).problems).toEqual(["回复缺少 scenarios 数组"]);
  });
  it("rule-based drafts are valid against the model", () => {
    const drafts = ruleBasedScenarios(model, 20);
    expect(drafts.length).toBeGreaterThan(5);
    for (const draft of drafts) expect(validateScenario(model, draft).filter(i => i.severity === "error")).toEqual([]);
    expect(uncoveredCommands(model, drafts).length).toBeLessThan(model.actions.filter(a => a.kind === "command").length);
  });
});

describe("app design plan", () => {
  it("drops unknown entities and fields with issues", () => {
    const plan = appDesignPlanSchema.parse({appName: "图书馆", modules: [
      {entity: "loan", displayName: "借阅", icon: "calendar", titleField: "loan_id", listFields: ["status", "ghost"], fieldLabels: {due_at: "应还", nope: "x"}},
      {entity: "phantom", displayName: "幽灵"},
    ]});
    const {plan: checked, issues} = checkPlan(model, plan);
    expect(checked.modules.map(m => m.entity)).toEqual(["loan"]);
    expect(checked.modules[0].listFields).toEqual(["status"]);
    expect(checked.modules[0].fieldLabels).toEqual({due_at: "应还"});
    expect(issues.map(i => i.path)).toEqual(expect.arrayContaining(["modules[0].listFields", "modules[0].fieldLabels.nope", "modules[1].entity"]));
  });
  it("applies labels, title and list columns to the projected type", () => {
    const converted = toObjectType(model, "book_title");
    if (!converted.ok) throw new Error(converted.message);
    const type = applyModule(converted.type, {entity: "book_title", displayName: "书目", icon: "book", titleField: "title", listFields: ["author", "status"], fieldLabels: {author: "作者"}, samples: {}, reason: "", scenarios: []});
    expect(type).toMatchObject({displayName: "书目", icon: "book", titleProperty: "title"});
    expect(type.properties.slice(0, 3).map(p => p.apiName)).toEqual(["title_id", "author", "status"]);
    expect(type.properties.find(p => p.apiName === "author")).toMatchObject({displayName: "作者", showInList: true});
    expect(type.properties.find(p => p.apiName === "isbn")?.showInList).toBe(false);
    expect(type.properties.find(p => p.apiName === "title_id")?.showInList).toBe(false);
  });
  it("rule-based plan skips execution audit", () => {
    const plan = ruleBasedPlan(model);
    expect(plan.modules).toHaveLength(14);
    expect(plan.skipped.map(s => s.entity)).toEqual(["audit_event"]);
  });
});

describe("server: sandbox and one-click app design", () => {
  beforeAll(() => { process.env.DATABASE_PATH = ":memory:"; process.env.DATABASE_SEED = "off"; });

  it("stores AI scenarios as inferred, de-duplicates ids, and confirms via patch", async () => {
    const {importBusinessModel, updateBusinessModel} = await import("../src/server/business-model-store");
    const {runSandbox} = await import("../src/server/business-model-ai");
    const imported = importBusinessModel(yaml, "campus_library.yaml");
    if (!imported.ok) throw new Error("import");
    const llm = new MockProvider(() => JSON.stringify({scenarios: [borrow, {id: "broken"}]}), "mock-sandbox");
    const first = await runSandbox(imported.value.id, {llm, count: 2});
    if (!first.ok) throw new Error(first.message);
    expect(first.added.map(s => [s.id, s.status, s.source])).toEqual([["librarian_lends_copy", "inferred", "mock-sandbox"]]);
    expect(first.problems).toHaveLength(1);
    expect(llm.requests[0].json).toBe(true);
    expect(llm.requests[0].messages[1].content).toContain("library_loan_borrow");
    const second = await runSandbox(imported.value.id, {llm});
    if (!second.ok) throw new Error(second.message);
    expect(second.added[0].id).toBe("librarian_lends_copy_2");
    const confirmed = updateBusinessModel(imported.value.id, [{kind: "scenario", id: "librarian_lends_copy", status: "confirmed"}, {kind: "removeScenario", id: "librarian_lends_copy_2"}]);
    if (!confirmed.ok) throw new Error("patch");
    expect(confirmed.value.model.scenarios!.map(s => [s.id, s.status])).toEqual([["librarian_lends_copy", "confirmed"]]);
    expect(confirmed.value.counts.process).toBe(1);
  });

  it("falls back to rule-based drafts without a provider", async () => {
    const {importBusinessModel} = await import("../src/server/business-model-store");
    const {runSandbox} = await import("../src/server/business-model-ai");
    const imported = importBusinessModel(yaml, "b.yaml");
    if (!imported.ok) throw new Error("import");
    const result = await runSandbox(imported.value.id, {llm: null, count: 3});
    expect(result.ok && result.source).toBe("rule-based");
    expect(result.ok && result.added.length).toBe(3);
  });

  it("converts the whole model into linked object types, sample records and pages", async () => {
    const {importBusinessModel, getBusinessModel} = await import("../src/server/business-model-store");
    const {runAppDesign} = await import("../src/server/business-model-ai");
    const {getObjectType, listPages, runtimeConfig} = await import("../src/server/ontology-store");
    const imported = importBusinessModel(yaml.replace("name: campus_library", "name: campus_design"), "c.yaml");
    if (!imported.ok) throw new Error("import");
    const plan = {appName: "图书馆后台", modules: [
      {entity: "book_title", displayName: "书目", pluralDisplayName: "书目管理", icon: "book", titleField: "title", listFields: ["author"], fieldLabels: {title: "书名"}, samples: {title: ["三体", "活着", "围城"], ghost: ["x"]}},
      {entity: "book_copy", displayName: "副本", icon: "book", titleField: "barcode", listFields: ["status", "location"]},
      {entity: "loan", displayName: "借阅", icon: "calendar", listFields: ["status", "due_at"]},
    ], skipped: [{entity: "audit_event", reason: "审计"}]};
    const result = await runAppDesign(imported.value.id, {llm: new MockProvider(() => JSON.stringify(plan), "mock-design")});
    if (!result.ok) throw new Error(result.message);
    expect(result.design.source).toBe("mock-design");
    expect(result.design.modules.map(m => m.entity)).toEqual(["book_title", "book_copy", "loan"]);
    expect(result.design.modules.every(m => m.pages === 3 && m.records === 3)).toBe(true);
    const loan = getObjectType("campus-design-loan")!;
    expect(loan.displayName).toBe("借阅");
    expect(loan.properties.find(p => p.apiName === "copy_id")).toMatchObject({baseType: "link", target: "campus-design-book-copy"});
    expect(getObjectType("campus-design-book-title")!.pluralDisplayName).toBe("书目");
    expect(runtimeConfig("campus-design-book-title")!.rows.map(r => r.title)).toEqual(["三体", "活着", "围城"]);
    expect(result.design.issues.map(i => i.path)).toContain("modules[0].samples.ghost");
    const copy = runtimeConfig("campus-design-loan")!.rows[0];
    expect(copy.copy_id).toBe("BOOK-COPY-001");
    expect(listPages().filter(p => p.objectType.startsWith("campus-design-"))).toHaveLength(9);
    expect(Object.keys(getBusinessModel(imported.value.id)!.model.bindings).sort()).toEqual(["book_copy", "book_title", "loan"]);
    // the plan did not mention most entities: reported, not invented
    expect(result.design.issues.some(i => i.message.includes("library_user"))).toBe(true);
    // re-running keeps records and existing pages
    const again = await runAppDesign(imported.value.id, {llm: new MockProvider(() => JSON.stringify(plan), "mock-design")});
    expect(again.ok && again.design.modules.map(m => m.records)).toEqual([3, 3, 3]);
  });

  it("reports an AI reply that never matches the plan schema", async () => {
    const {importBusinessModel} = await import("../src/server/business-model-store");
    const {runAppDesign} = await import("../src/server/business-model-ai");
    const imported = importBusinessModel(yaml, "d.yaml");
    if (!imported.ok) throw new Error("import");
    const llm = new MockProvider(() => JSON.stringify({modules: []}));
    const result = await runAppDesign(imported.value.id, {llm});
    expect(result.ok).toBe(false);
    expect(llm.requests).toHaveLength(2);
  });
});
