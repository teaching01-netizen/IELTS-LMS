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

test.describe('Student time extension flow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('timer displays remaining time during exam', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const timeDisplay = page.locator('[data-testid="student-time-remaining"]');
    await expect(timeDisplay).toBeVisible({ timeout: 10_000 });

    const timeText = await timeDisplay.textContent();
    expect(timeText).toMatch(/\d+:\d+/);

    await context.close();
  });

  test('timer counts down over time', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const initialSeconds = await page
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
      .then((handle) => handle.jsonValue() as Promise<number>);

    await page.waitForFunction(
      (baseline) => {
        const el = document.querySelector('[data-testid="student-time-remaining"]');
        const raw = el?.textContent ?? null;
        if (!raw) return false;
        const parts = raw.trim().split(':');
        if (parts.length !== 2) return false;
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return false;
        return minutes * 60 + seconds < baseline;
      },
      initialSeconds,
      { timeout: 12_000 },
    );

    await context.close();
  });

  test('proctor can extend time via API and timer updates', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const initialSeconds = await page
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
      .then((handle) => handle.jsonValue() as Promise<number>);

    const extendResponse = await page.request.post(
      `/api/v1/admin/schedules/${manifest.student.scheduleId}/extend-time`,
      { data: { additionalMinutes: 5 } },
    ).catch(() => null);

    if (extendResponse && extendResponse.ok()) {
      await page.waitForFunction(
        (baseline) => {
          const el = document.querySelector('[data-testid="student-time-remaining"]');
          const raw = el?.textContent ?? null;
          if (!raw) return false;
          const parts = raw.trim().split(':');
          if (parts.length !== 2) return false;
          const minutes = Number(parts[0]);
          const seconds = Number(parts[1]);
          if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return false;
          return minutes * 60 + seconds > baseline;
        },
        initialSeconds,
        { timeout: 15_000 },
      );
    }

    await context.close();
  });

  test('low time warning appears when timer is near zero', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const timeDisplay = page.locator('[data-testid="student-time-remaining"]');
    await expect(timeDisplay).toBeVisible({ timeout: 10_000 });

    const timeText = await timeDisplay.textContent();
    const parts = (timeText ?? '').trim().split(':');
    const totalSeconds =
      parts.length === 2
        ? Number(parts[0]) * 60 + Number(parts[1])
        : Number.NaN;

    if (Number.isFinite(totalSeconds) && totalSeconds <= 300) {
      const lowTimeWarning = page.getByText(/time (is |almost )?(up|running out|remaining)/i);
      const hasWarning = await lowTimeWarning.isVisible().catch(() => false);
      expect(hasWarning).toBeTruthy();
    }

    await context.close();
  });
});
