import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = path.resolve("docs/business-model/campus_library.yaml");
const shots = "test-results/business-model";
async function openTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("data-state", "active");
  await page.waitForTimeout(250); // let the trigger's background transition settle before screenshots
}

test("upload ontology YAML, edit a loan field and keep it after reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Tall viewport instead of fullPage captures: the sticky top bar would be stitched mid-page.
  await page.setViewportSize({ width: 1440, height: 1800 });

  await page.goto("/business-models");
  await expect(page.getByRole("heading", { name: "业务建模", exact: true })).toBeVisible();
  await page.getByTestId("yaml-upload").setInputFiles(fixture);

  await expect(page).toHaveURL(/\/business-models\/campus_library$/);
  for (const [view, count] of [["entity", 15], ["relationship", 28], ["action", 60], ["rule", 19], ["metric", 12], ["role", 5]] as const)
    await expect(page.getByTestId(`count-${view}`)).toHaveText(String(count));
  await expect(page.getByText("35 查询 · 25 命令")).toBeVisible();
  await expect(page.getByText("135 个字段")).toBeVisible();
  await page.screenshot({ path: `${shots}/01-overview.png` });

  await openTab(page, /^对象/);
  await page.getByRole("navigation", { name: "业务对象" }).locator("button", { has: page.locator("code", { hasText: /^loan$/ }) }).click();
  await expect(page.getByRole("heading", { name: /借阅\s*loan/ })).toBeVisible();
  const description = page.getByLabel("due_at 描述", { exact: true });
  await expect(description).toHaveValue("当前应还时间");
  await description.fill("应还时间（续借后为新的到期时间）");
  await page.getByRole("button", { name: /^保存/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.screenshot({ path: `${shots}/02-entity-loan.png` });

  await page.reload();
  await expect(page.getByLabel("due_at 描述", { exact: true })).toHaveValue("应还时间（续借后为新的到期时间）");

  const exported = await request.get("/api/business-models/campus_library/export");
  expect(await exported.text()).toContain("应还时间（续借后为新的到期时间）");

  // Bridge to app design: book_copy first, then loan links to it.
  for (const entity of ["book_copy", "loan"]) {
    await page.getByRole("navigation", { name: "业务对象" }).locator("button", { has: page.locator("code", { hasText: new RegExp(`^${entity}$`) }) }).click();
    await page.getByRole("button", { name: "创建页面" }).click();
    await expect(page.getByRole("status")).toContainText(`campus-library-${entity.replace("_", "-")}`);
  }
  await expect(page.getByRole("link", { name: "打开页面" })).toHaveAttribute("href", "/apps/campus-library-loan");
  await page.screenshot({ path: `${shots}/03-entity-bound.png` });

  await openTab(page, /^关系/);
  await expect(page.getByRole("img", { name: "对象关系图" })).toBeVisible();
  await page.screenshot({ path: `${shots}/04-relationships.png` });
  await openTab(page, /^行为/);
  await page.getByText("library_loan_borrow", { exact: true }).click();
  await expect(page.getByText("preview → authorize", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${shots}/05-actions.png` });
  await openTab(page, /^角色/);
  await page.screenshot({ path: `${shots}/06-roles.png` });
  await openTab(page, /^规则/);
  await page.screenshot({ path: `${shots}/07-rules.png` });
  await openTab(page, "状态与事件");
  await page.screenshot({ path: `${shots}/08-lifecycle.png` });

  await page.goto("/apps/campus-library-loan");
  await expect(page.getByRole("heading", { name: /借阅/ }).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/09-generated-loan-page.png` });
  await page.goto("/business-models");
  await page.screenshot({ path: `${shots}/10-model-list.png` });
  expect(errors).toEqual([]);
});
