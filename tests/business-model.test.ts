import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  applyPatches, completeness, countModel, enumCandidate, inferEvents, inferRoles, inferStates, parseBusinessModelYaml,
  toObjectType, toRaw, toYaml, validateBusinessModel, type BusinessModel,
} from "../src/business-model/model";
import { validateObjectType } from "../src/ontology/model";

const fixture = readFileSync(path.resolve("docs/business-model/campus_library.yaml"), "utf8");
function load(text = fixture): {model: BusinessModel; issues: ReturnType<typeof validateBusinessModel>} {
  const result = parseBusinessModelYaml(text);
  if (!result.ok) throw new Error(result.issues.map(i => i.message).join("; "));
  return result;
}

describe("business model import (campus_library.yaml)", () => {
  it("parses the BMF views with the expected counts", () => {
    const {model} = load();
    expect(model.name).toBe("campus_library");
    expect(model.sourceVersion).toBe("0.1.2");
    const counts = countModel(model);
    expect(counts).toMatchObject({entity: 15, fields: 135, relationship: 28, metric: 12, action: 60, queries: 35, commands: 25, rule: 19, process: 0, document: 0});
  });

  it("keeps stable source ids and resolves YAML anchors", () => {
    const {model} = load();
    expect(model.entities.map(e => e.id)).toContain("book_copy");
    expect(model.actions.find(a => a.id === "library_loan_borrow")).toMatchObject({kind: "command", entity: "loan", roles: ["LIBRARIAN"]});
    expect(model.rules.map(r => r.id)).toContain("rule/unique_copy_loan");
    // to_columns: *id001 resolves to the loan_policy primary key
    expect(model.relationships.find(r => r.id === "library_user_to_loan_policy")?.toColumns).toEqual(["policy_id"]);
    // anchored allowed_roles (&id013) are shared by value, not by reference
    const [a, b] = model.actions;
    expect(a.roles).toEqual(b.roles);
    a.roles.push("X");
    expect(b.roles).not.toContain("X");
  });

  it("has no reference errors in the fixture and flags rules with an empty action scope", () => {
    const {issues} = load();
    expect(issues.filter(i => i.severity === "error")).toEqual([]);
    const empty = issues.filter(i => i.path.endsWith("when.action_ids"));
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every(i => i.severity === "warning" && i.element?.view === "rule")).toBe(true);
  });

  it("reports broken references with paths instead of fixing them", () => {
    const raw = parse(fixture, {maxAliasCount: -1});
    const semantic = raw.semantic_model[0];
    semantic.relationships[0].from_columns = ["no_such_column"];
    semantic.relationships[1].to = "ghost";
    semantic.behavior.actions[0].entity_name = "ghost_entity";
    semantic.behavior.rules[2].when.action_ids = ["missing_action"];
    semantic.behavior.rules[3].applies_to.dataset = "ghost";
    const {issues} = load(JSON.stringify(raw));
    const errors = issues.filter(i => i.severity === "error").map(i => i.path);
    expect(errors).toEqual(expect.arrayContaining([
      "semantic_model[0].relationships[0].from_columns[0]",
      "semantic_model[0].relationships[1].to",
      "semantic_model[0].behavior.actions[0].entity_name",
      "semantic_model[0].behavior.rules[2].when.action_ids[0]",
      "semantic_model[0].behavior.rules[3].applies_to.dataset",
    ]));
    const reparsed = load(JSON.stringify(raw)).model;
    expect(reparsed.relationships[0].fromColumns).toEqual(["no_such_column"]);
  });

  it("rejects invalid YAML and documents without a semantic model", () => {
    expect(parseBusinessModelYaml("a: [").ok).toBe(false);
    expect(parseBusinessModelYaml("version: 1").ok).toBe(false);
  });
});

describe("inferred views", () => {
  const {model} = load();
  it("derives enum candidates from descriptions", () => {
    const status = model.entities.find(e => e.id === "library_user")!.fields.find(f => f.id === "status")!;
    expect(enumCandidate(status)).toEqual({values: ["ACTIVE", "SUSPENDED", "CLOSED"], nullable: false, inferred: true});
    const condition = model.entities.find(e => e.id === "loan_event")!.fields.find(f => f.id === "condition")!;
    expect(enumCandidate(condition)).toMatchObject({values: ["NORMAL", "DAMAGED", "LOST"], nullable: true});
    expect(enumCandidate(model.entities[0].fields[0])).toBeUndefined();
  });
  it("derives roles from allowed_roles and marks them inferred", () => {
    const roles = inferRoles(model);
    expect(roles.map(r => r.id).sort()).toEqual(["ADMIN", "APPROVER", "BUYER", "LIBRARIAN", "READER"]);
    expect(roles.every(r => r.inferred)).toBe(true);
    expect(roles.find(r => r.id === "LIBRARIAN")!.actions).toContain("library_loan_borrow");
  });
  it("derives state candidates from status fields and events from loan_event", () => {
    const states = inferStates(model);
    expect(states.find(s => s.id === "state/book_copy.status")?.values).toEqual(["AVAILABLE", "ON_LOAN", "DAMAGED", "LOST", "WITHDRAWN"]);
    expect(states.every(s => s.inferred)).toBe(true);
    const events = inferEvents(model);
    expect(events.map(e => e.name)).toEqual(["BORROW", "RETURN", "RENEW", "REPORT_LOST", "REPORT_DAMAGE"]);
    expect(events.find(e => e.name === "BORROW")!.producedBy).toContain("library_loan_borrow");
    expect(events.some(e => e.entity === "audit_event")).toBe(false);
  });
});

describe("round trip and edits", () => {
  it("exports YAML that parses back to the same document", () => {
    const {model} = load();
    expect(parse(toYaml(model))).toEqual(parse(fixture, {maxAliasCount: -1}));
    // a second import of the export is stable
    expect(toYaml(load(toYaml(model)).model)).toBe(toYaml(model));
  });

  it("survives JSON persistence", () => {
    const {model} = load();
    expect(toRaw(JSON.parse(JSON.stringify(model)))).toEqual(toRaw(model));
  });

  it("applies edits without touching ids and writes them to the export", () => {
    const {model} = load();
    const result = applyPatches(model, [
      {kind: "entity", id: "loan", displayName: "借阅记录"},
      {kind: "field", entity: "loan", id: "due_at", description: "应还时间（含续借）", constraints: {required: true}},
      {kind: "field", entity: "loan", id: "status", constraints: {enum: ["OPEN", "RETURNED", "LOST"]}},
      {kind: "rule", id: "rule/unique_copy_loan", message: "同一副本同时只能有一笔在借"},
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(model.entities.find(e => e.id === "loan")!.displayName).toBeUndefined();
    const exported = parse(toYaml(result.model)).semantic_model[0];
    const loan = exported.datasets.find((d: {name: string}) => d.name === "loan");
    expect(loan.display_name).toBe("借阅记录");
    const due = loan.fields.find((f: {name: string}) => f.name === "due_at");
    expect(due).toMatchObject({name: "due_at", description: "应还时间（含续借）", constraints: {required: true}});
    expect(exported.behavior.rules.find((r: {id: string}) => r.id === "rule/unique_copy_loan").message).toBe("同一副本同时只能有一笔在借");
    expect(load(toYaml(result.model)).model.entities.find(e => e.id === "loan")!.fields.find(f => f.id === "status")!.constraints.enum).toEqual(["OPEN", "RETURNED", "LOST"]);
  });

  it("rejects unknown targets and unknown patch keys", () => {
    const {model} = load();
    expect(applyPatches(model, [{kind: "field", entity: "loan", id: "nope", description: "x"}]).ok).toBe(false);
    expect(applyPatches(model, [{kind: "entity", id: "loan", name: "renamed"}]).ok).toBe(false);
  });
});

describe("completeness and bridge to app design", () => {
  const {model, issues} = load();
  it("tracks defined / validated / bound / verified per element", () => {
    expect(completeness(model, "entity", "loan", issues)).toEqual({defined: true, validation: "validated", bound: false, verified: false});
    const bound = {...model, bindings: {loan: {objectType: "campus-library-loan", boundAt: "2026-10-08T00:00:00.000Z"}}};
    expect(completeness(bound, "entity", "loan", issues).bound).toBe(true);
  });

  it("converts loan and book_copy into valid ontology object types", () => {
    const copy = toObjectType(model, "book_copy");
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.type.apiName).toBe("campus-library-book-copy");
    expect(validateObjectType(copy.type, [])).toMatchObject({ok: true});
    const loan = toObjectType(model, "loan", {book_copy: copy.type.apiName});
    expect(loan.ok).toBe(true);
    if (!loan.ok) return;
    expect(loan.type.properties.find(p => p.apiName === "copy_id")).toMatchObject({baseType: "link", target: "campus-library-book-copy"});
    expect(loan.type.properties.find(p => p.apiName === "status")).toMatchObject({baseType: "enum", options: ["OPEN", "RETURNED", "LOST"]});
    expect(validateObjectType(loan.type, [copy.type.apiName])).toMatchObject({ok: true});
  });
});
