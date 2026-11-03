/**
 * SAT room zero-click scores — E2E acceptance (plan §3).
 *
 * SKELETON: these scenarios need a seeded room (Rank 4 Mock 1 fixture via the
 * `sat_classroom` helpers: one finished-scored attempt, one working attempt,
 * one invalidated attempt) plus a running API + Playwright. They are skipped
 * until that seed exists; the unit suites (`useRoomScores`, roster row/sort,
 * inspector link) already cover the view-model without a backend.
 *
 * DO NOT claim this file passes until `bunx playwright test
 * e2e/sat-room-scores.spec.ts` runs green against seeded data.
 */
import { expect, test } from "@playwright/test";

test.describe.skip("SAT room zero-click scores", () => {
  test("teacher sees per-student correct/total and percent without clicking", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    const firstRow = page.getByRole("option").first();
    await expect(firstRow.locator(".sat-room__row-score")).toContainText(/\d+\/\d+ · \d+%/);
  });

  test("sort Score high to low reorders the roster", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    await page.getByLabel("Sort").selectOption("score_desc");
    const names = await page.getByRole("listbox").getByRole("option").allTextContents();
    expect(names.length).toBeGreaterThan(1);
  });

  test("screen reader announces the score with the row name", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    await expect(page.getByRole("option", { name: /score \d+ of \d+, \d+ percent/ }).first()).toBeVisible();
  });

  test("running students show answered counts and no key text appears in the DOM", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    await expect(page.getByRole("option", { name: /answered/ }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("correctAnswer");
  });

  test("invalidated attempts show Not scored, never 0/total", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    const row = page.getByRole("option", { name: /not scored/i }).first();
    await expect(row).toBeVisible();
    await expect(row.locator(".sat-room__row-score-fraction")).toHaveCount(0);
  });

  test("inspector View answers returns to the room with selection and scroll kept", async ({ page }) => {
    await page.goto(`/sat/sessions/sched-seed-1`);
    await page.getByRole("option").first().click();
    await page.getByRole("link", { name: /View .*answers for/ }).click();
    await page.getByRole("button", { name: /Back/ }).click();
    await expect(page.getByTestId("sat-room-student-heading")).toBeFocused();
  });

  test("a failed results poll keeps the last score and dims instead of flashing zero", async ({ page }) => {
    await page.route("**/v1/results/sat/attempts?*", (route) => route.abort());
    await page.goto(`/sat/sessions/sched-seed-1`);
    await expect(page.getByRole("option").first()).toBeVisible();
  });
});
