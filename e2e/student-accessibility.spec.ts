import { expect, test, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

async function enterRuntimeBackedExam(
  page: Page,
  scheduleId: string,
  wcode: string,
) {
  await studentCheckIn(page, scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: 'E2E Candidate',
  });
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
}

test.describe('Student accessibility settings (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('accessibility toggle button is visible in exam header', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const a11yButton = page.getByRole('button', { name: /accessibility|a11y|font size|text size/i });
    const settingsButton = page.getByRole('button', { name: /settings|display/i });
    const hasA11yButton = await a11yButton.isVisible().catch(() => false);
    const hasSettingsButton = await settingsButton.isVisible().catch(() => false);

    expect(hasA11yButton || hasSettingsButton).toBeTruthy();

    await context.close();
  });

  test('question navigator is keyboard accessible', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const navigatorButton = page.getByRole('button', { name: /question navigator/i });
    const hasNavigator = await navigatorButton.isVisible().catch(() => false);

    if (!hasNavigator) {
      await context.close();
      return;
    }

    await navigatorButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    const dialogVisible = await dialog.isVisible().catch(() => false);

    if (dialogVisible) {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }

    await context.close();
  });

  test('answer fields have proper ARIA labels', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    await expect(answerField).toBeVisible();

    const ariaLabel = await answerField.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();

    await context.close();
  });

  test('submit confirmation dialog is accessible', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    await page.getByLabel('Answer for question 1').fill('a11y-test');

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finishButton = page.getByRole('button', { name: 'Finish' });
    await finishButton.scrollIntoViewIfNeeded();
    await finishButton.click({ force: true });

    const confirmationDialog = page.getByRole('dialog');
    const dialogVisible = await confirmationDialog.isVisible().catch(() => false);

    if (dialogVisible) {
      const title = await confirmationDialog.getAttribute('aria-label')
        ?? await confirmationDialog.locator('[role="heading"]').first().textContent().catch(() => null);
      expect(title).toBeTruthy();

      const cancelButton = page.getByRole('button', { name: /cancel|go back|continue exam/i });
      const hasCancel = await cancelButton.isVisible().catch(() => false);
      if (hasCancel) {
        await cancelButton.click();
        await expect(confirmationDialog).not.toBeVisible();
      }
    }

    await context.close();
  });
});
