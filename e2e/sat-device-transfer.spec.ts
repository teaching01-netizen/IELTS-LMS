import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { createRunningSatSession } from "./support/satStudentSession";
import { stubScreenDetails } from "./support/studentUi";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * SAT session ownership (docs/superpowers/plans/2026-10-06-sat-session-
 * ownership-and-device-transfer.md): the same student entering from a second
 * browser is blocked before any exam content, a proctor-approved device change
 * moves the exam with its server-saved answers, and the old browser stops
 * saving.
 */
async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId("sat-exam-shell")).toHaveAttribute("data-sat-save-state", "idle", {
    timeout: 30_000,
  });
}

test.describe("SAT device transfer", () => {
  test.describe.configure({ timeout: 300_000 });

  test("blocks a second browser, transfers after proctor approval, and fences the old browser", async ({
    page,
    browser,
  }) => {
    const session = await createRunningSatSession(browser, page, { label: "device-transfer" });
    const { studentContext, studentPage, joinHref, studentName, studentEmail } = session;
    const otherContext = await browser.newContext();
    try {
      // Device A answers and the answer reaches the server.
      await studentPage.locator("label.sat-answer-choice").first().click();
      await expect(studentPage.locator('input[type="radio"]').first()).toBeChecked();
      await waitForSatSaved(studentPage);

      // A duplicate tab of device A never mounts a second writer.
      const duplicateTab = await studentContext.newPage();
      await duplicateTab.goto(studentPage.url());
      await expect(
        duplicateTab.getByRole("heading", { name: "This exam is already open in another tab" })
      ).toBeVisible({ timeout: 30_000 });
      await expect(duplicateTab.getByTestId("sat-exam-shell")).toHaveCount(0);
      await duplicateTab.close();

      // Device B checks in with the same identity: blocked, no exam content.
      otherContext.setDefaultTimeout(30_000);
      await stubScreenDetails(otherContext);
      const otherPage = await otherContext.newPage();
      await otherPage.goto(joinHref);
      await otherPage.getByLabel("Full name").fill(studentName);
      await otherPage.getByLabel("Email").fill(studentEmail);
      await otherPage.getByRole("button", { name: /Continue/i }).click();
      await expect(
        otherPage.getByRole("heading", { name: "This exam is open on another device" })
      ).toBeVisible({ timeout: 45_000 });
      await expect(otherPage.getByTestId("sat-exam-shell")).toHaveCount(0);
      await expect(otherPage.locator('input[type="radio"]')).toHaveCount(0);

      // B requests; the exam has started, so a proctor must approve.
      await otherPage.getByRole("button", { name: "Request device change" }).click();
      await expect(otherPage.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

      await expect(page.getByText(/Device change requests \(1\)/)).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Review" }).click();
      const approve = page.getByRole("button", { name: "Approve device change" });
      await expect(approve).toBeDisabled();
      await page.getByLabel(/answers the old device had not saved/).check();
      await approve.click();
      await expect(page.getByText(/Device change approved for/)).toBeVisible({ timeout: 20_000 });

      // B redeems the approval and resumes with A's server-saved answer.
      await expect(otherPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
      await expect(otherPage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });

      // A no longer owns the attempt: its next answer is refused as
      // superseded (kept on the device), never saved or retried.
      await studentPage.locator("label.sat-answer-choice").nth(1).click();
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute("data-sat-save-state", "superseded", {
        timeout: 30_000,
      });
      await expect(studentPage.getByText(/another device/i).first()).toBeVisible();

      // B keeps saving under its new lease.
      await otherPage.locator("label.sat-answer-choice").nth(2).click();
      await waitForSatSaved(otherPage);
    } finally {
      await otherContext.close();
      await studentContext.close();
    }
  });

  test("before the exam starts, the current device can allow the move without a proctor", async ({
    page,
    browser,
  }) => {
    const session = await createRunningSatSession(browser, page, { label: "device-prestart", startRuntime: false });
    const { studentContext, studentPage, joinHref, studentName, studentEmail } = session;
    const otherContext = await browser.newContext();
    try {
      await expect(studentPage.getByRole("heading", { name: /Waiting for your proctor/ })).toBeVisible({ timeout: 45_000 });

      otherContext.setDefaultTimeout(30_000);
      await stubScreenDetails(otherContext);
      const otherPage = await otherContext.newPage();
      await otherPage.goto(joinHref);
      await otherPage.getByLabel("Full name").fill(studentName);
      await otherPage.getByLabel("Email").fill(studentEmail);
      await otherPage.getByRole("button", { name: /Continue/i }).click();
      await expect(
        otherPage.getByRole("heading", { name: "This exam is open on another device" })
      ).toBeVisible({ timeout: 45_000 });
      await otherPage.getByRole("button", { name: "Request device change" }).click();
      await expect(otherPage.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

      // The original device confirms; no proctor is involved before start.
      await studentPage.getByRole("button", { name: "Move this exam to another device" }).click();
      await expect(studentPage.getByText("Another device asked to continue this exam")).toBeVisible();
      await studentPage.getByRole("button", { name: "Allow on another device" }).click();
      await expect(studentPage.getByText("Allowed. Continue on the other device.")).toBeVisible();

      await expect(otherPage.getByRole("heading", { name: /Waiting for your proctor/ })).toBeVisible({ timeout: 45_000 });
      // The staff queue refreshes every 10 seconds after device-only approval.
      await expect(page.getByTestId("sat-device-transfer-requests")).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await otherContext.close();
      await studentContext.close();
    }
  });
});
