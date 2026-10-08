import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Embedded SQLite (Node built-in `node:sqlite`, no native addon). One file per workspace,
 * default ./data/shadcnplane.db (os tmpdir on Vercel), override with DATABASE_PATH (":memory:" in tests).
 * Next.js: call `await connection()` before reading in Server Components (synchronous driver).
 */
const migrations = [
  `create table meta(key text primary key, value text not null);
   create table object_types(api_name text primary key, definition text not null, position integer not null, created_at text not null, updated_at text not null);
   create table objects(type text not null references object_types(api_name) on delete cascade, id text not null, pk text not null, data text not null, created_at text not null, updated_at text not null, primary key(type, id));
   create unique index objects_pk on objects(type, pk);
   create table pages(id text primary key, object_type text not null references object_types(api_name) on delete cascade, kind text not null, name text not null, document text, source text not null, updated_at text not null, unique(object_type, kind));
   create table operations(id text primary key, signature text not null, result text not null, created_at text not null);`,
  `create table business_models(id text primary key, name text not null, file_name text not null, document text not null, source_yaml text not null, created_at text not null, updated_at text not null);`,
];

export function databasePath(): string {
  const configured = process.env.DATABASE_PATH;
  if (configured === ":memory:") return configured;
  if (configured) return path.resolve(configured);
  // Serverless hosts (Vercel) only allow writes under /tmp: per-instance, reset on cold start.
  if (process.env.VERCEL) return path.join(tmpdir(), "shadcnplane.db");
  return path.join(process.cwd(), "data", "shadcnplane.db");
}

export function openDatabase(file = databasePath()): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec("pragma foreign_keys = on; pragma busy_timeout = 5000;");
  if (file !== ":memory:") db.exec("pragma journal_mode = wal;");
  const version = Number((db.prepare("pragma user_version").get() as {user_version: number}).user_version);
  for (let i = version; i < migrations.length; i++) {
    transaction(db, () => { db.exec(migrations[i]); db.exec(`pragma user_version = ${i + 1}`); });
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("begin immediate");
  try { const value = run(); db.exec("commit"); return value; }
  catch (error) { db.exec("rollback"); throw error; }
}

// Survive Next.js dev HMR without leaking handles.
const globalDb = globalThis as unknown as {__shadcnplaneDb?: {file: string; db: DatabaseSync}};
export function getDatabase(): DatabaseSync {
  const file = databasePath();
  if (globalDb.__shadcnplaneDb?.file !== file) globalDb.__shadcnplaneDb = {file, db: openDatabase(file)};
  return globalDb.__shadcnplaneDb.db;
}
