import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-save-state', 'idle', {
    timeout: 30_000,
  });
}

async function readAttemptIdentity(page: Page, scheduleId: string, candidateId: string) {
  return page.evaluate(async ({ scheduleId, candidateId }) => {
    const query = new URLSearchParams({ candidateId });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(`/api/v1/student/sessions/${scheduleId}?${query}`, {
        credentials: 'include',
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Session lookup failed with ${response.status}`);
    const wire = await response.json() as { data?: { attempt?: { id?: string; deadlineAt?: string | null } | null }; attempt?: { id?: string; deadlineAt?: string | null } | null };
    const payload = wire.data ?? wire;
    if (!payload.attempt?.id) throw new Error('The authenticated session did not return an attempt id.');
    return { id: payload.attempt.id, deadlineAt: payload.attempt.deadlineAt ?? null };
  }, { scheduleId, candidateId });
}

test.describe('SAT automatic resume', () => {
  test.describe.configure({ timeout: 180_000 });

  test('recovers the same server attempt across a new tab, Student Link, and missing local storage', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId, joinHref } = await createRunningSatSession(
      browser,
      page,
      { label: 'auto-resume' },
    );
    try {
      const radios = studentPage.locator('input[type="radio"]');
      await studentPage.locator('label').filter({ has: radios.first() }).first().click();
      await waitForSatSaved(studentPage);
      const original = await readAttemptIdentity(studentPage, scheduleId, candidateId);

      // A new Page in the same context models closing the tab. It has a new
      // sessionStorage area while the server cookie and local resume locator survive.
      await studentPage.evaluate(() => window.sessionStorage.clear());
      await studentPage.close({ runBeforeUnload: false });
      const schedulePage = await studentContext.newPage();
      await schedulePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(schedulePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(schedulePage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });
      expect(await readAttemptIdentity(schedulePage, scheduleId, candidateId)).toEqual(original);

      // A manually edited candidate and attempt locator remain hints only;
      // the authenticated user's server identity supplies the canonical route.
      await schedulePage.evaluate(() => {
        const key = 'sat-resume-locator:v1';
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error('SAT resume locator was not written.');
        const locator = JSON.parse(raw) as Record<string, unknown>;
        locator.candidateId = 'tampered-candidate';
        locator.attemptId = 'tampered-attempt';
        window.localStorage.setItem(key, JSON.stringify(locator));
      });
      await schedulePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(schedulePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(schedulePage).toHaveURL(new RegExp(`/student/${scheduleId}/${encodeURIComponent(candidateId)}$`));
      expect(await readAttemptIdentity(schedulePage, scheduleId, candidateId)).toEqual(original);

      await schedulePage.close({ runBeforeUnload: false });
      const linkPage = await studentContext.newPage();
      await linkPage.goto(joinHref, { waitUntil: 'domcontentloaded' });
      await expect(linkPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(linkPage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });
      expect(await readAttemptIdentity(linkPage, scheduleId, candidateId)).toEqual(original);

      // The canonical student URL plus the HttpOnly cookie is sufficient even
      // after local discovery data has been removed.
      await linkPage.evaluate(() => window.localStorage.clear());
      await linkPage.goto(`/student/${scheduleId}/${encodeURIComponent(candidateId)}`, { waitUntil: 'domcontentloaded' });
      await expect(linkPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      expect(await readAttemptIdentity(linkPage, scheduleId, candidateId)).toEqual(original);

      // Restore only the non-secret locator, then remove the auth cookie. The
      // locator and cached attempt must not mount an exam on their own.
      await linkPage.evaluate(({ scheduleId, candidateId, attemptId }) => {
        window.localStorage.setItem('sat-resume-locator:v1', JSON.stringify({
          version: 1,
          providerKey: 'sat',
          scheduleId,
          candidateId,
          attemptId,
          updatedAt: new Date().toISOString(),
        }));
      }, { scheduleId, candidateId, attemptId: original.id });
      await studentContext.clearCookies();
      await linkPage.close();
      const unauthenticatedPage = await studentContext.newPage();
      await unauthenticatedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(unauthenticatedPage.getByRole('heading', { name: 'Exam Check-in' })).toBeVisible({ timeout: 30_000 });
      await expect(unauthenticatedPage.getByTestId('sat-exam-shell')).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });
});
