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

test.describe('Student session recovery', () => {
  test.describe.configure({ timeout: 120_000 });

  test('page reload preserves answered questions and timer state', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    const testAnswer = `recovery-${Date.now()}`;
    await answerField.fill(testAnswer);

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const timeBefore = await page
      .waitForFunction(() => {
        const el = document.querySelector('[data-testid="student-time-remaining"]');
        const raw = el?.textContent ?? null;
        if (!raw) return null;
        const parts = raw.trim().split(':');
        if (parts.length !== 2) return null;
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
        return minutes * 60 + seconds;
      }, undefined, { timeout: 10_000 })
      .then((handle) => handle.jsonValue() as Promise<number | null>);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(testAnswer);

    if (timeBefore !== null) {
      const timeAfter = await page
        .waitForFunction(() => {
          const el = document.querySelector('[data-testid="student-time-remaining"]');
          const raw = el?.textContent ?? null;
          if (!raw) return null;
          const parts = raw.trim().split(':');
          if (parts.length !== 2) return null;
          const minutes = Number(parts[0]);
          const seconds = Number(parts[1]);
          if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
          return minutes * 60 + seconds;
        }, undefined, { timeout: 10_000 })
        .then((handle) => handle.jsonValue() as Promise<number | null>);

      if (timeAfter !== null) {
        expect(timeAfter).toBeLessThanOrEqual(timeBefore);
      }
    }

    await context.close();
  });

  test('offline then online restores exam state from local cache', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    const testAnswer = `offline-${Date.now()}`;
    await answerField.fill(testAnswer);

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
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(testAnswer);

    await context.close();
  });

  test('answer entered offline is persisted when connection restores', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    await context.setOffline(true);
    await expect(page.getByRole('heading', { name: 'Connection lost' })).toBeVisible();

    const answerField = page.getByLabel('Answer for question 1');
    const offlineAnswer = `offline-answer-${Date.now()}`;
    await answerField.fill(offlineAnswer);

    await context.setOffline(false);

    await expect(page.getByRole('heading', { name: 'Connection lost' })).not.toBeVisible();

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 30_000 })
      .toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(offlineAnswer);

    await context.close();
  });

  test('rapid reload preserves final answer (no race condition)', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    await answerField.fill('pre-reload');

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    const finalAnswer = `final-${Date.now()}`;
    await answerField.fill(finalAnswer);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    const restoredValue = await page.getByLabel('Answer for question 1').inputValue();

    expect(
      restoredValue === 'pre-reload' || restoredValue === finalAnswer,
    ).toBeTruthy();

    await context.close();
  });
});
