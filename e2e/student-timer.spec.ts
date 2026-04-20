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

test.describe('Student runtime timer (LRW)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('runtime-backed timer counts down during live section', async ({ browser }, testInfo) => {
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
        const trimmed = raw.trim();
        const parts = trimmed.split(':');
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
        const trimmed = raw.trim();
        const parts = trimmed.split(':');
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
});
