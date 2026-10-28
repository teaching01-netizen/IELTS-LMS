import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { createRunningSatSession } from "./support/satStudentSession";
import { stubScreenDetails } from "./support/studentUi";
import { closeDb } from "./support/db";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });
test.afterAll(closeDb);

test("staff QR recovers saved work into a completely clean browser after explicit Continue", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { studentContext, studentPage, studentName } = await createRunningSatSession(
    browser,
    page,
    { label: "staff-recovery" }
  );
  const replacement = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await studentPage.locator("label.sat-answer-choice").first().click();
    await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
      "data-sat-save-state",
      "idle",
      { timeout: 30_000 }
    );
    await page.getByRole("option", { name: new RegExp(`^Open ${studentName}`) }).click();
    await page.getByRole("button", { name: "ย้ายเครื่อง / ให้ทำต่อ" }).click();
    const dialog = page.getByRole("dialog", { name: "ย้ายเครื่อง / ให้ทำต่อ" });
    await dialog.getByLabel("ปรับส่วนหรือเวลาเอง").check();
    await dialog.getByLabel("กำหนดเวลาเหลือใหม่ (นาที:วินาที)").fill("08:00");
    await dialog.getByRole("button", { name: "สร้าง QR และรหัส" }).click();
    const link = dialog.locator('a[href*="/student/recover/"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    if (!href) throw new Error("Staff did not receive a recovery link.");
    const code = (await dialog.locator("strong").textContent())?.trim();
    expect(code).toMatch(/^\d{6}$/);
    await expect(dialog.getByAltText("QR สำหรับเปิดข้อสอบต่อบนเครื่องใหม่")).toBeVisible();

    // No cookies, localStorage capability, or student identity is copied.
    expect(await replacement.cookies()).toEqual([]);
    await stubScreenDetails(replacement);
    const recovered = await replacement.newPage();
    await recovered.goto(href);
    await expect(recovered.getByLabel("รหัส 6 หลัก")).toBeVisible();
    await expect(recovered.getByText(studentName)).toHaveCount(0);
    await expect(recovered.getByTestId("sat-exam-shell")).toHaveCount(0);
    await recovered.getByLabel("รหัส 6 หลัก").fill(code!);
    await recovered.getByRole("button", { name: "ตรวจสอบรหัส" }).click();
    await expect(recovered.getByText(studentName)).toBeVisible();
    await expect(recovered.getByTestId("sat-exam-shell")).toHaveCount(0);
    await expect(recovered.locator('input[type="radio"]')).toHaveCount(0);
    expect(new URL(recovered.url()).hash).toBe("");
    await recovered.getByRole("button", { name: "ทำข้อสอบต่อ" }).click();
    await expect(recovered.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
    await expect(recovered.locator('input[type="radio"]').first()).toBeChecked();
    await recovered.locator("label.sat-answer-choice").nth(1).click();
    await expect(recovered.getByTestId("sat-exam-shell")).toHaveAttribute(
      "data-sat-save-state",
      "idle",
      { timeout: 30_000 }
    );

    // The original browser's next write must be refused; the new browser
    // must remain authoritative after that refused write.
    if (await studentPage.getByTestId("sat-exam-shell").isVisible()) {
      await studentPage.locator("label.sat-answer-choice").nth(2).click();
    }
    await expect(
      studentPage.getByText(/another device|เครื่องอื่น|ย้ายเครื่อง/i).first()
    ).toBeVisible({ timeout: 30_000 });
    await recovered.reload();
    await expect(recovered.locator('input[type="radio"]').nth(1)).toBeChecked({ timeout: 45_000 });
  } finally {
    await replacement.close();
    await studentContext.close();
  }
});
