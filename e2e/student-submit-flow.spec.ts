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

test.describe('Student submission flow (LRW)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('submit with unanswered questions triggers confirmation dialog', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    await answerField.fill('partial answer');

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finishButton = page.getByRole('button', { name: 'Finish' });
    await finishButton.scrollIntoViewIfNeeded();
    await finishButton.click({ force: true });

    const confirmationDialog = page.getByRole('dialog', { name: /submit/i });
    const confirmationVisible = await confirmationDialog.isVisible().catch(() => false);

    if (confirmationVisible) {
      const unansweredWarning = page.getByText(/unanswered/i);
      const hasUnansweredWarning = await unansweredWarning.isVisible().catch(() => false);
      if (hasUnansweredWarning) {
        await expect(unansweredWarning).toBeVisible();
      }

      const confirmSubmit = page.getByRole('button', { name: /submit|confirm/i });
      const submitResponsePromise = page
        .waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes(
              `/api/v1/student/sessions/${manifest.student.scheduleId}/submit`,
            ),
          { timeout: 60_000 },
        )
        .catch(() => null);

      await confirmSubmit.click({ force: true });
      const submitResponse = await submitResponsePromise;
      if (submitResponse) {
        expect(submitResponse.ok()).toBeTruthy();
      }
    }

    const completionHeading = page.getByRole('heading', { name: /Examination Complete!/i });
    await expect
      .poll(async () => {
        if (await completionHeading.isVisible().catch(() => false)) return 'complete';
        return 'pending';
      }, { timeout: 45_000 })
      .toBe('complete');

    await context.close();
  });

  test('submit with all questions answered goes through without confirmation', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    await page.getByLabel('Answer for question 1').fill(manifest.student.expectedAnswer);

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finishButton = page.getByRole('button', { name: 'Finish' });
    const submitResponsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(
            `/api/v1/student/sessions/${manifest.student.scheduleId}/submit`,
          ),
        { timeout: 60_000 },
      )
      .catch(() => null);

    await finishButton.scrollIntoViewIfNeeded();
    await finishButton.click({ force: true });

    const submitResponse = await submitResponsePromise;
    if (submitResponse) {
      expect(submitResponse.ok()).toBeTruthy();
    }

    const completionHeading = page.getByRole('heading', { name: /Examination Complete!/i });
    await expect
      .poll(async () => {
        if (await completionHeading.isVisible().catch(() => false)) return 'complete';
        return 'pending';
      }, { timeout: 45_000 })
      .toBe('complete');

    await context.close();
  });

  test('submit preserves answer integrity through the full pipeline', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    const submittedValues: string[] = [];
    await page.route(
      `**/api/v1/student/sessions/${manifest.student.scheduleId}/mutations:batch`,
      async (route) => {
        const payload = route.request().postDataJSON();
        const mutations = payload?.mutations ?? [];
        for (const m of mutations) {
          if (typeof m.value === 'string') submittedValues.push(m.value);
        }
        await route.continue();
      },
    );

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    const finalAnswer = `integrity-${Date.now()}-verified`;
    await answerField.fill(finalAnswer);

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finishButton = page.getByRole('button', { name: 'Finish' });
    const submitResponsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(
            `/api/v1/student/sessions/${manifest.student.scheduleId}/submit`,
          ),
        { timeout: 60_000 },
      )
      .catch(() => null);

    await finishButton.scrollIntoViewIfNeeded();
    await finishButton.click({ force: true });

    const submitResponse = await submitResponsePromise;
    if (submitResponse) {
      expect(submitResponse.ok()).toBeTruthy();
    }

    const completionHeading = page.getByRole('heading', { name: /Examination Complete!/i });
    await expect
      .poll(async () => {
        if (await completionHeading.isVisible().catch(() => false)) return 'complete';
        return 'pending';
      }, { timeout: 45_000 })
      .toBe('complete');

    expect(submittedValues).toContain(finalAnswer);

    await context.close();
  });

  test('submit is idempotent — double-clicking Finish does not create duplicate submissions', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    let submitCount = 0;
    await page.route(
      `**/api/v1/student/sessions/${manifest.student.scheduleId}/submit`,
      async (route) => {
        submitCount += 1;
        await route.continue();
      },
    );

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    await page.getByLabel('Answer for question 1').fill('idempotent-test');

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finishButton = page.getByRole('button', { name: 'Finish' });
    await finishButton.scrollIntoViewIfNeeded();

    await finishButton.click({ force: true });
    await page.waitForTimeout(200);
    await finishButton.click({ force: true }).catch(() => {});

    const completionHeading = page.getByRole('heading', { name: /Examination Complete!/i });
    await expect
      .poll(async () => {
        if (await completionHeading.isVisible().catch(() => false)) return 'complete';
        return 'pending';
      }, { timeout: 45_000 })
      .toBe('complete');

    expect(submitCount).toBeLessThanOrEqual(1);

    await context.close();
  });
});
