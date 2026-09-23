import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * Executable acceptance specification (ATDD) — SAT exam-screen integrity.
 *
 * This is the SAT counterpart of `student-security.spec.ts`, and it asserts the
 * exact same acceptance contract through the other delivery branch:
 *
 *   AC-SAT-01 a real Page Visibility excursion warns the student on return
 *   AC-SAT-02 the same excursion records exactly one TAB_SWITCH delivery audit
 *   AC-SAT-03 blur/focus loss alone is never a violation
 *   AC-SAT-04 acknowledging the hold resumes the exam with answers intact
 *   AC-SAT-05 neither the hold nor the audit claims what the student opened
 *
 * The SAT branch is a separate route (`SatStudentSessionRoute` →
 * `useSatIntegrityControl`), so this contract cannot be inferred from the
 * IELTS/ACT spec passing.
 */

/**
 * Drives one Page Visibility transition on the student page. `visibilityState`
 * is the primitive the exam reads; `hidden` stays in sync with it.
 */
async function setDocumentVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => next === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);
}

test.describe('SAT exam-screen integrity (visibility excursion)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('warns on return, audits one TAB_SWITCH, and keeps the answer', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page, { label: 'integrity' });
    try {
      const firstOption = studentPage.locator('input[type="radio"]').first();
      await firstOption.check();
      await expect(firstOption).toBeChecked();

      // AC-SAT-02: watch for the delivery audit the excursion must produce.
      const auditRequest = studentPage.waitForRequest(
        (request) => request.method() === 'POST' && /\/audit$/.test(new URL(request.url()).pathname),
        { timeout: 30_000 },
      );

      // AC-SAT-01: a real excursion — hidden, then visible again.
      await studentPage.evaluate(() => window.dispatchEvent(new Event('blur')));
      await setDocumentVisibility(studentPage, 'hidden');
      await expect(studentPage.getByTestId('sat-integrity-warning')).toHaveCount(0);

      await setDocumentVisibility(studentPage, 'visible');

      const hold = studentPage.getByTestId('sat-integrity-warning');
      await expect(hold).toBeVisible({ timeout: 15_000 });
      await expect(hold).toContainText('Stay on the exam screen');
      await expect(hold).toContainText('You left the exam screen');
      // AC-SAT-05: the hold states the recorded fact, never a claim about what
      // was opened and never an accusation.
      await expect(hold).not.toContainText(/cheat|ChatGPT|other app/i);

      const audit = await auditRequest;
      const auditBody = JSON.stringify(audit.postDataJSON());
      expect(auditBody).toContain('TAB_SWITCH');
      expect(auditBody).toContain('page_visibility');

      // AC-SAT-04: continue resumes the exam; the module and answer are intact.
      await studentPage
        .getByRole('button', { name: 'Continue exam' })
        .click();
      await expect(hold).toHaveCount(0);
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible();
      await expect(firstOption).toBeChecked();
    } finally {
      await studentContext.close();
    }
  });

  test('does not warn when the page only loses focus', async ({ page, browser }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page, { label: 'integrity' });
    try {
      await studentPage.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      });
      await studentPage.waitForTimeout(1_000);

      await expect(studentPage.getByTestId('sat-integrity-warning')).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });
});
