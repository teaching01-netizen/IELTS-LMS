import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function openNewSession(page: Page) {
  await page.goto("/admin/scheduling");
  await expect(page.getByRole("heading", { name: "Exam Scheduler" })).toBeVisible();
  await page.getByRole("button", { name: "New Session" }).click();
  await expect(page.getByRole("heading", { name: "Schedule New Session" })).toBeVisible();
  await expect(page.getByLabel("Select exam")).toBeVisible();
}

test.describe("Go-backed scheduling workflow", () => {
  test("creates a schedule against a published exam version", async ({ page }) => {
    await openNewSession(page);

    await page.getByLabel("Select exam").selectOption({ index: 0 });
    await page.getByLabel("Select cohort").selectOption("Weekend Intensive");
    await page.getByLabel("Proctor display name").fill("E2E Proctor");
    await page.getByLabel("Grading display name").fill("E2E Grader");
    await page.getByRole("button", { name: "Create Schedule" }).click();

    await expect(page.getByRole("heading", { name: "Schedule New Session" })).toHaveCount(0);
    await expect(page.getByText("Weekend Intensive").last()).toBeVisible();
  });

  test("edits an existing schedule without changing its immutable version", async ({ page }) => {
    await page.goto("/admin/scheduling");
    await expect(page.getByRole("heading", { name: "Exam Scheduler" })).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByRole("heading", { name: "Edit Schedule" })).toBeVisible();
    const version = page.getByText(/v\d+ \([0-9a-f-]+\)/i).first();
    await expect(version).toBeVisible();
    const versionBefore = await version.textContent();

    await page.getByLabel("Select cohort").selectOption("Elite 2025-A");
    await page.getByLabel("Proctor display name").fill("Updated E2E Proctor");
    await page.getByLabel("Grading display name").fill("Updated E2E Grader");
    await page.getByRole("button", { name: "Update Schedule" }).click();

    await expect(page.getByRole("heading", { name: "Edit Schedule" })).toHaveCount(0);
    await expect(page.getByText("Elite 2025-A").last()).toBeVisible();
    expect(versionBefore).toMatch(/^v\d+ \(/);
  });
});
