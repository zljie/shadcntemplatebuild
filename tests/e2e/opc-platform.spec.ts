import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test, type Page } from "@playwright/test";

/**
 * G3 against the live local opc-platform (meta-data 4100, db-connect 4200, BFF 4000 with an active
 * campus_library release, see docs/opc-platform-集成.md). Skipped when the BFF has no active release.
 * Borrowing writes to the library tables, so the opc-platform sample data is reloaded first.
 */
const bff = (process.env.OPC_BFF_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const platformDir = path.resolve(process.env.OPC_PLATFORM_DIR ?? "../opcadminmonorepo/opc-platform");
const shots = "test-results/opc-platform";
const isLive = () => fetch(`${bff}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()).then((h: { release?: string | null }) => !!h.release).catch(() => false);

function reseed() {
  if (!existsSync(path.join(platformDir, "executors/library/src/seed.ts"))) return;
  execFileSync(process.execPath, ["--import", path.join(platformDir, "node_modules/tsx/dist/loader.mjs"), "executors/library/src/seed.ts"],
    { cwd: platformDir, env: { ...process.env, DATABASE_URL: process.env.OPC_DATABASE_URL ?? "postgres://opc:opc@127.0.0.1:5432/opc" }, stdio: "pipe" });
}
async function borrowFlow(page: Page, copy: string, shot: string) {
  await page.getByRole("button", { name: copy, exact: true }).first().click({ timeout: 10_000 });
  const details = page.locator(".context-panel");
  await details.getByRole("button", { name: "办理借出" }).click();
  const dialog = page.getByRole("dialog", { name: "办理借出" });
  await expect(dialog.getByText("copyId")).toBeVisible();
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByRole("alert")).toContainText("请填写：readerId");
  await dialog.getByLabel("readerId").fill("u_reader");
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByText("预览成功")).toBeVisible();
  await page.screenshot({ path: `${shots}/${shot}-1-preview.png` });
  await dialog.getByRole("button", { name: "确认办理借出" }).click();
  await expect(dialog.getByText("执行成功")).toBeVisible();
  const receipt = dialog.locator(".command-receipt");
  await expect(receipt).toContainText("loanId");
  await expect(receipt.locator("dd").first()).toContainText("loan_");
  await page.screenshot({ path: `${shots}/${shot}-2-receipt.png` });
  await dialog.getByRole("button", { name: "完成" }).click();
}

test.describe.configure({ mode: "serial" });
test.describe("opc-platform integration (live backend)", () => {
  test.beforeAll(async ({ request }) => {
    test.skip(!(await isLive()), `no active release at ${bff}`);
    reseed();
    const yaml = readFileSync("docs/business-model/campus_library.yaml", "utf8");
    const imported = await request.post("/api/business-models", { data: { yaml, fileName: "campus_library.yaml" } });
    expect([201, 409]).toContain(imported.status());
    const pages = await request.post("/api/business-models/campus_library/pages", { data: { entity: "book_copy" } });
    expect(pages.ok()).toBeTruthy();
  });

  test("release center, mappings, operation catalog and page binding", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/platform\/releases$/);
    await expect(page.getByRole("heading", { name: "发布中心", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "能力平台" })).toHaveAttribute("aria-current", "page");
    const detail = page.getByRole("region", { name: "发布详情" });
    await expect(detail.getByText("已启用").first()).toBeVisible();
    await expect(detail.getByText("Library.Borrow")).toBeVisible();
    await page.screenshot({ path: `${shots}/01-releases.png` });

    const binding = page.getByRole("region", { name: "页面能力绑定" });
    const row = binding.getByRole("row", { name: /book_copy/ });
    await expect(row).toContainText("BookCopy.List");
    await expect(row).toContainText("Library.Borrow");
    await row.getByRole("button", { name: "绑定" }).click();
    await expect(page.getByRole("status").first()).toContainText("已绑定当前发布的能力");
    await expect(binding.getByRole("row", { name: /book_copy/ }).getByRole("button", { name: "解除" })).toBeVisible();
    await page.screenshot({ path: `${shots}/02-bound.png` });

    await page.getByRole("link", { name: "数据映射" }).click();
    await expect(page.getByRole("heading", { name: "数据映射", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /library\.book_copy/ })).toContainText("BookCopy.UpdateLocation");
    await page.getByRole("button", { name: "检查 Hasura 同步" }).click();
    await expect(page.getByText("元数据与发布一致").first()).toBeVisible();
    await page.screenshot({ path: `${shots}/03-mappings.png` });

    await page.getByRole("link", { name: "Operation 目录" }).click();
    await page.getByRole("button", { name: "BookCopy.List", exact: true }).click();
    const op = page.getByRole("region", { name: "Operation BookCopy.List" });
    await expect(op).toContainText("query BookCopyList");
    await expect(op).toContainText("LIBRARIAN");
    await page.screenshot({ path: `${shots}/04-operations.png` });
    expect(errors).toEqual([]);
  });

  test("capability try-run: auto form, identities, SUCCEEDED / REJECTED / 401", async ({ page }) => {
    await page.goto("/platform/try");
    await page.getByRole("button", { name: "BookCopy.List", exact: true }).click();
    const form = page.getByRole("form", { name: "试运行 BookCopy.List" });
    await form.getByLabel("limit").fill("99");
    await form.getByRole("button", { name: "执行" }).click();
    await expect(form.getByText("不能大于 50")).toBeVisible();
    await form.getByLabel("limit").fill("3");
    await form.getByRole("button", { name: "执行" }).click();
    const result = page.getByRole("region", { name: "调用结果" });
    await expect(result).toContainText("执行 · SUCCEEDED");
    await expect(result).toContainText("c_sicp_1");
    await form.getByRole("button", { name: "用 GraphQL 读取" }).click();
    await expect(result).toContainText("GraphQL");

    await page.getByRole("button", { name: "Library.Borrow", exact: true }).click();
    const borrow = page.getByRole("form", { name: "试运行 Library.Borrow" });
    await borrow.getByLabel("readerId").fill("u_suspended");
    await borrow.getByLabel("copyId").fill("c_sicp_3");
    await borrow.getByRole("button", { name: "预览" }).click();
    await expect(result).toContainText("预览 · REJECTED");
    await page.screenshot({ path: `${shots}/05-try-rejected.png` });
    await borrow.getByLabel("readerId").fill("u_reader");
    await borrow.getByRole("button", { name: "预览" }).click();
    await expect(result).toContainText("预览 · SUCCEEDED");
    await borrow.getByLabel(/身份/).selectOption({ label: "未登录" });
    await borrow.getByRole("button", { name: "执行" }).click();
    await expect(result).toContainText("HTTP 401");
    await borrow.getByLabel(/身份/).selectOption({ label: "李同学 · READER" });
    await borrow.getByRole("button", { name: "预览" }).click();
    await expect(result).toContainText("REJECTED");
    await page.screenshot({ path: `${shots}/06-try.png` });
  });

  test("bound prototype page reads BookCopy.List and borrows: preview → confirm → receipt", async ({ page }) => {
    await page.goto("/apps/campus-library-book-copy");
    await expect(page.locator(".runtime-topbar")).toContainText("BFF · BookCopy.List");
    await expect(page.getByRole("button", { name: "B0002", exact: true })).toBeVisible();
    await borrowFlow(page, "B0002", "07-apps-borrow");
    await expect(page.getByRole("row", { name: /B0002/ })).toContainText("ON_LOAN");
  });

  test("exported app: local mode by default, BFF mode with DATA_MODE=bff", async ({ page, request }) => {
    test.slow();
    const zip = await request.get("/api/business-models/campus_library/export-app");
    expect(zip.ok()).toBeTruthy();
    // Outside the checkout: the composer's tsconfig would otherwise type-check the exported project too.
    const dir = mkdtempSync(path.join(tmpdir(), "opc-export-"));
    for (const [name, content] of Object.entries(unzipSync(new Uint8Array(await zip.body())))) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), strFromU8(content));
    }
    const contract = JSON.parse(readFileSync(path.join(dir, "contract.json"), "utf8"));
    expect(contract.modules.find((m: { key: string }) => m.key === "book-copy").capabilities).toEqual({ list: "BookCopy.List", commands: ["Library.Borrow", "BookCopy.UpdateLocation"] });
    expect(readFileSync(path.join(dir, "dsl/book-copy.dsl.json"), "utf8")).toContain('"schemaVersion":"0.2.0"');
    execFileSync("cp", ["-cR", path.resolve("node_modules"), path.join(dir, "node_modules")]);
    const bin = (name: string) => path.join(dir, "node_modules/.bin", name);
    execFileSync(bin("tsc"), ["--noEmit"], { cwd: dir, stdio: "pipe" });
    execFileSync(bin("next"), ["build"], { cwd: dir, stdio: "pipe", env: { ...process.env, NODE_ENV: "production" } });

    const start = (env: Record<string, string>): ChildProcess => spawn(bin("next"), ["start", "--hostname", "127.0.0.1", "--port", "3124"], { cwd: dir, env: { ...process.env, ...env }, stdio: "ignore" });
    const ready = async () => { for (let i = 0; i < 60; i++) { if (await fetch("http://127.0.0.1:3124/api/opc/mode").then(r => r.ok).catch(() => false)) return; await new Promise(r => setTimeout(r, 500)); } throw new Error("exported app did not start"); };
    const stop = (child: ChildProcess) => new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });

    let server = start({ DATA_MODE: "local" });
    try {
      await ready();
      // Local mode reads seed JSON plus browser storage; the e2e database has no book_copy records, so store one.
      const appName = JSON.parse(readFileSync(path.join(dir, "app-design.json"), "utf8")).appName;
      await page.addInitScript(([key, row]) => localStorage.setItem(key, JSON.stringify([row])),
        [`app-data:${appName}:book-copy`, { id: "c_local", copy_id: "c_local", barcode: "L0001", title_id: "t_local", location: "", status: "AVAILABLE" }] as const);
      await page.goto("http://127.0.0.1:3124/book-copy");
      await expect(page.locator(".runtime-topbar")).toContainText("本地数据");
      await page.getByRole("button", { name: "L0001", exact: true }).click({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "办理借出" })).toBeDisabled();
      await page.screenshot({ path: `${shots}/08-export-local.png` });
    } finally { await stop(server); }

    server = start({ DATA_MODE: "bff", OPC_BFF_URL: bff, OPC_DEV_IDENTITY: "1", OPC_DEV_ACTOR: "u_librarian", OPC_DEV_ROLES: "LIBRARIAN" });
    try {
      await ready();
      await page.goto("http://127.0.0.1:3124/book-copy");
      await expect(page.locator(".runtime-topbar")).toContainText("BFF（opc-platform）");
      await expect(page.getByRole("button", { name: "B0001", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /新增/ })).toHaveCount(0);
      await borrowFlow(page, "B0001", "09-export-bff-borrow");
      await expect(page.getByRole("row", { name: /B0001/ })).toContainText("ON_LOAN");
    } finally { await stop(server); }
  });
});
