import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";

test.describe("Error recovery", () => {
  test.describe.configure({ timeout: 120_000 });

  test.describe("admin surfaces", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

    test("exam list exposes a retry surface after an API failure", async ({ page }) => {
      await page.route("**/api/v1/exams*", (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Simulated exam API failure" } }),
        })
      );
      await page.goto("/admin/exams");

      await expect(page.getByRole("heading", { name: "Unable to load exams" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("heading", { name: "Exam Library" })).toBeVisible();
    });

    test("proctor loading recovers after the session API is restored", async ({ page }) => {
      await page.route("**/api/v1/proctor/sessions*", (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Simulated proctor API failure" } }),
        })
      );
      await page.goto("/proctor");

      await expect(page.getByRole("heading", { name: "Loading Error" })).toBeVisible({
        timeout: 30_000,
      });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("heading", { name: "Cohorts and students" })).toBeVisible();
    });

    test("unknown paths render the active route-not-found surface", async ({ page }) => {
      await page.goto("/admin/route-that-does-not-exist");

      await expect(page.getByRole("heading", { name: "Route Not Found" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Home" })).toBeEnabled();
    });
  });
});
