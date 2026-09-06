import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function waitForQueue(page: Page) {
  await page.goto("/admin/grading");
  await expect(page.getByRole("heading", { name: "Grading Queue" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });
}

async function openSession(page: Page, search: string) {
  await waitForQueue(page);
  await page.getByRole("textbox", { name: "Search sessions by exam or cohort" }).fill(search);
  const row = page.locator("tbody tr").filter({ hasText: search }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: /Open grading session/ }).click();
  await expect(page.getByRole("textbox", { name: "Search students" })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("Go-backed grading workflow", () => {
  test("loads the backend grading queue and exposes current session actions", async ({ page }) => {
    await waitForQueue(page);

    await expect(page.getByText(/sessions across exams and cohorts/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Next page" })).toBeVisible();
    await expect(
      page
        .locator("tbody tr")
        .first()
        .getByRole("button", { name: /Open grading session/ })
    ).toBeVisible();
  });

  test("server-searches sessions by exam or cohort and clears the result", async ({ page }) => {
    await waitForQueue(page);
    const search = page.getByRole("textbox", { name: "Search sessions by exam or cohort" });

    await search.fill("Backend E2E Lifecycle");
    const lifecycleRow = page
      .locator("tbody tr")
      .filter({ hasText: "Backend E2E Lifecycle" })
      .first();
    await expect(lifecycleRow).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("tbody tr")).toHaveCount(1);

    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });
  });

  test("changes queue page size without losing the server-backed rows", async ({ page }) => {
    await waitForQueue(page);
    const pageSize = page.locator("#grading-queue-page-size");
    await pageSize.selectOption("25");
    await expect(pageSize).toHaveValue("25");
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Showing 1–/)).toBeVisible();
  });

  test("exports the current grading queue as CSV", async ({ page }) => {
    await waitForQueue(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^grading-sessions-\d{4}-\d{2}-\d{2}\.csv$/);

    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream ?? []) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain('"Session ID","Exam","Cohort"');
    expect(csv).toContain("Backend E2E");
  });

  test("opens a backend session and renders the current student-submission surface", async ({
    page,
  }) => {
    await openSession(page, "Backend E2E Cohort");

    await expect(page.getByRole("heading", { name: "Student Backend E2E Delivery" })).toBeVisible();
    await expect(page.getByText(/students in this session/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search students" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Overall answer check" })).toBeVisible();
  });

  test("keeps an empty session explicit instead of exposing a broken review link", async ({
    page,
  }) => {
    await openSession(page, "Backend E2E Cohort");
    await expect(page.getByText("No student submissions found")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});
