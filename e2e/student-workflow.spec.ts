import { expect, test } from '@playwright/test';
import {
  readBackendE2EManifest,
} from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

test.describe('Student LRW workflow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('registration page enforces required check-in fields', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/student/${manifest.studentSelfPaced.scheduleId}`);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(
      page.getByText('Wcode is required and must be in format W followed by 6 digits'),
    ).toBeVisible();
    await expect(
      page.getByText('Email is required and must be valid'),
    ).toBeVisible();
    await expect(page.getByText('Name is required')).toBeVisible();
  });

  test('runtime-backed: student checks in and submits through Finish', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();

    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('Answer for question 1').fill(manifest.student.expectedAnswer);
    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        const saved = banner.getByText('Saved');
        if (await saved.isVisible().catch(() => false)) {
          return 'saved';
        }
        const saving = banner.getByText(/Saving|Syncing/i);
        if (await saving.isVisible().catch(() => false)) {
          return 'saving';
        }
        return 'unknown';
      }, { timeout: 20_000 })
      .toBe('saved');
    const finishButton = page.getByRole('button', { name: 'Finish' });
    const submitResponsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/v1/student/sessions/${manifest.student.scheduleId}/submit`),
        { timeout: 60_000 },
      )
      .catch(() => null);

    await finishButton.scrollIntoViewIfNeeded();
    await finishButton.click().catch(async () => {
      await finishButton.click({ force: true });
    });

    const submitResponse = await submitResponsePromise;
    if (!submitResponse) {
      throw new Error('Did not observe a submit network request.');
    }
    expect(submitResponse.ok()).toBeTruthy();

    const completionHeading = page.getByRole('heading', { name: /Examination Complete!/i });
    await expect
      .poll(async () => {
        if (await completionHeading.isVisible().catch(() => false)) {
          return 'complete';
        }
        const stillInExam = await finishButton.isVisible().catch(() => false);
        return stillInExam ? 'exam' : 'pending';
      }, { timeout: 45_000 })
      .toBe('complete');
    await context.close();
  });
});
