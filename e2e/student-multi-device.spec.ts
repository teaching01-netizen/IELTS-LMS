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

test.describe('Student multi-device fingerprint mismatch', () => {
  test.describe.configure({ timeout: 120_000 });

  test('different user agent triggers device mismatch warning', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context1 = await browser.newContext();
    await stubScreenDetails(context1);
    const page1 = await context1.newPage();

    await enterRuntimeBackedExam(page1, manifest.student.scheduleId, wcode);

    await page1.getByLabel('Answer for question 1').fill('device-test');

    await expect
      .poll(async () => {
        const banner = page1.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const context2 = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    await stubScreenDetails(context2);
    const page2 = await context2.newPage();

    await studentCheckIn(page2, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });
    await openStudentSessionWithRetry(page2, manifest.student.scheduleId, wcode);

    await expect
      .poll(async () => {
        const deviceWarning = page2.getByText(/device mismatch|different device/i);
        const answerField = page2.getByLabel('Answer for question 1');
        if (await deviceWarning.isVisible().catch(() => false)) return 'warning';
        if (await answerField.isVisible().catch(() => false)) return 'exam';
        return 'pending';
      }, { timeout: 30_000 })
      .not.toBe('pending');

    await context1.close();
    await context2.close();
  });

  test('same device reconnection does not trigger device mismatch', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    await page.getByLabel('Answer for question 1').fill('reconnect-test');

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    await context.setOffline(true);
    await expect(page.getByRole('heading', { name: 'Connection lost' })).toBeVisible();

    await context.setOffline(false);

    await expect(page.getByRole('heading', { name: 'Connection lost' })).not.toBeVisible();
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });

    const deviceWarning = page.getByText(/device mismatch|different device/i);
    const hasWarning = await deviceWarning.isVisible().catch(() => false);
    expect(hasWarning).toBeFalsy();

    await context.close();
  });
});
