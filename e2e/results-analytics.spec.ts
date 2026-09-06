import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("Go-backed results and analytics", () => {
  test("loads provider-backed result metrics and the recent-results state", async ({ page }) => {
    await page.goto("/admin/results");
    await expect(page.getByRole("heading", { name: "Results & Analytics" })).toBeVisible();
    await expect(page.getByText("Visible results")).toBeVisible();
    await expect(page.locator("p").filter({ hasText: /^Released$/ }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent results" })).toBeVisible();

    const rows = page.locator("[data-result-card]");
    const emptyState = page.getByText("No results yet");
    await expect(rows.first().or(emptyState)).toBeVisible();
  });

  test("filters current results by provider and search text", async ({ page }) => {
    await page.goto("/admin/results");
    await expect(page.getByRole("heading", { name: "Results & Analytics" })).toBeVisible();

    const provider = page.getByRole("combobox", { name: "Filter by provider" });
    await provider.selectOption("sat");
    await expect(provider).toHaveValue("sat");
    await page.getByRole("searchbox", { name: "Search results" }).fill("definitely-no-result");
    await expect(page.getByText("No matching results")).toBeVisible();

    await provider.selectOption("all");
    await expect(provider).toHaveValue("all");
  });

  test("refreshes the authoritative results query", async ({ page }) => {
    await page.goto("/admin/results");
    await expect(page.getByRole("heading", { name: "Results & Analytics" })).toBeVisible();
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/v1/results/dashboard")
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect((await responsePromise).status()).toBe(200);
  });

  test("opens a persisted result report when one is available", async ({ page }) => {
    await page.goto("/admin/results");
    await expect(page.getByRole("heading", { name: "Results & Analytics" })).toBeVisible();
    const firstResult = page.locator("[data-result-card]").first();

    if ((await firstResult.count()) === 0) {
      await expect(page.getByText("No results yet")).toBeVisible();
      return;
    }

    await firstResult.getByRole("button", { name: "View Report" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close result report" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
