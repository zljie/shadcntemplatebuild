/**
 * Data migrations for stored Page DSL (templates, database pages, drafts, imports, AI/MCP input).
 * Document steps upgrade `schemaVersion`; component steps rewrite one component's props and bump
 * its `componentVersion`. Steps run in order until no step matches, then the strict validator decides.
 * Input is never mutated; unknown shapes are passed through for the validator to report.
 */
type Json = Record<string, unknown>;
export type DocumentMigration = {
  from: string;
  to: string;
  migrate: (document: Json) => Json;
};
export type ComponentMigration = {
  componentRef: string;
  from: string;
  to: string;
  transformProps: (props: Json) => Json;
};
export type Migrations = {
  document: DocumentMigration[];
  component: ComponentMigration[];
};

// Add a step here whenever pageSchema or a component's props change shape, then bump the version in schema.ts.
export const migrations: Migrations = { document: [], component: [] };

export type MigrationResult = { document: unknown; applied: string[] };
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function migrateDocument(
  input: unknown,
  steps: Migrations = migrations,
): MigrationResult {
  if (!isObject(input)) return { document: input, applied: [] };
  const applied: string[] = [];
  let document: Json = input;
  for (let guard = 0; guard < 100; guard++) {
    const step = steps.document.find((s) => s.from === document.schemaVersion);
    if (!step || step.from === step.to) break;
    const next = step.migrate(structuredClone(document));
    document = {
      ...next,
      schemaVersion: step.to,
      ...(isObject(next.dependencies)
        ? { dependencies: { ...next.dependencies, pageSchema: step.to } }
        : {}),
    };
    applied.push(`document ${step.from} → ${step.to}`);
  }
  if (steps.component.length && Array.isArray(document.root)) {
    let changed = false;
    const visit = (node: unknown): unknown => {
      if (!isObject(node)) return node;
      let next: Json = node;
      for (let guard = 0; guard < 100; guard++) {
        const step = steps.component.find(
          (s) =>
            s.componentRef === next.componentRef &&
            s.from === next.componentVersion,
        );
        if (!step) break;
        next = {
          ...next,
          props: step.transformProps(
            structuredClone(isObject(next.props) ? next.props : {}),
          ),
          componentVersion: step.to,
        };
        applied.push(`${step.componentRef} ${step.from} → ${step.to}`);
        changed = true;
      }
      if (!isObject(next.slots)) return next;
      const slots = Object.fromEntries(
        Object.entries(next.slots).map(([key, children]) => [
          key,
          Array.isArray(children) ? children.map(visit) : children,
        ]),
      );
      return { ...next, slots };
    };
    const root = document.root.map(visit);
    if (changed) document = { ...document, root };
  }
  return { document: applied.length ? document : input, applied };
}

/** Convenience for load paths that only need the upgraded value. */
export const upgradeDocument = (input: unknown): unknown =>
  migrateDocument(input).document;
