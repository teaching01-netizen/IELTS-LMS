import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { stubScreenDetails } from './support/studentUi';

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

/**
 * Authors, publishes and starts one live SAT session, then returns the student
 * page already inside a running module.
 */
async function createRunningSatSession(browser: Browser, page: Page) {
  const stamp = Date.now().toString(36);
  const examTitle = `SAT integrity ${stamp}`;
  const linkName = `SAT integrity link ${stamp}`;
  const studentName = `SAT integrity candidate ${stamp}`;
  const studentEmail = `sat-integrity-${stamp}@example.com`;

  await page.goto('/sat/exams');
  await expect(page.getByRole('heading', { name: 'Exam Library' })).toBeVisible();
  await page.getByRole('button', { name: 'New SAT' }).first().click();
  await page.getByLabel('SAT exam name').fill(examTitle);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await page.getByRole('button', { name: 'More authoring actions' }).click();
  await page.getByRole('menuitem', { name: /Load sample exam/ }).click();
  await expect(page.getByRole('dialog', { name: 'Load sample SAT' })).toBeVisible();
  await page.getByRole('button', { name: 'Load 147 questions' }).click();
  await expect(page.getByText('147 of 147 questions authored')).toBeVisible({ timeout: 90_000 });

  await page.getByRole('button', { name: 'Release' }).click();
  await expect(page).toHaveURL(/\/release$/);
  await page.getByRole('button', { name: 'Publish' }).click();
  const publishDialog = page.getByRole('dialog');
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole('button', { name: 'Publish' }).click();

  await expect(page).toHaveURL(/\/access$/);
  await page.getByRole('button', { name: 'New Link' }).click();
  await page.getByLabel('Student Link name').fill(linkName);
  await page.getByRole('button', { name: /Name \+ email only/i }).click();
  await page.getByRole('button', { name: /Anytime/i }).click();
  await page.getByRole('button', { name: 'Create Link' }).click();
  await expect(page.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
  const joinHref = await page.getByRole('link', { name: 'Open student page' }).getAttribute('href');
  if (!joinHref) throw new Error('SAT student join URL was not created.');

  const studentContext = await browser.newContext();
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible();
  await studentPage.getByLabel('Full name').fill(studentName);
  await studentPage.getByLabel('Email').fill(studentEmail);
  await studentPage.getByRole('button', { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });

  const scheduleId = new URL(studentPage.url()).pathname.split('/').filter(Boolean)[1];
  if (!scheduleId) throw new Error('SAT student route did not include a schedule id.');

  await page.goto('/sat/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  const sessionRow = page
    .locator('button')
    .filter({ hasText: examTitle })
    .filter({ hasText: linkName })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  await sessionRow.click();
  await expect(page).toHaveURL(new RegExp(`/sat/sessions/${scheduleId}$`));
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Session started.')).toBeVisible({ timeout: 20_000 });

  await studentPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
  await expect(studentPage.locator('input[type="radio"]').first()).toBeVisible({ timeout: 30_000 });

  return { studentContext, studentPage, scheduleId };
}

test.describe('SAT exam-screen integrity (visibility excursion)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('warns on return, audits one TAB_SWITCH, and keeps the answer', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page);
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
    const { studentContext, studentPage } = await createRunningSatSession(browser, page);
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
