import type { DataRecord, ListDetail } from "@/runtime/data";

/** One query or command of the business model, the contract a backend implementation must honour. */
export type ActionContract = {id: string; name: string; kind: string; operation: string; roles: string[]; rules: string[]; input?: unknown; output?: unknown};
export type AppModule = {
  /** Route segment: /<key>, /<key>/<id>, /<key>/new, /<key>/<id>/edit. */
  key: string; title: string; entity: string; objectType: string;
  /** Runtime configuration without rows; rows come from the repository. */
  config: ListDetail;
  /** Link fields → target module key; options are rebuilt from the target's current records. */
  links: Record<string, string>;
  seed: DataRecord[];
  actions: ActionContract[];
};
export type AppManifest = {appName: string; workspaceName: string; model: {name: string; sourceVersion: string; exportedAt: string}; modules: AppModule[]};
