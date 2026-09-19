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

async function hasViolation(
  page: Page,
  scheduleId: string,
  violationType: string,
) {
  return (await countViolations(page, scheduleId, violationType)) > 0;
}

async function countViolations(
  page: Page,
  scheduleId: string,
  violationType: string,
) {
  return page.evaluate(async ({ scheduleId, violationType }) => {
    try {
      const response = await fetch(`/api/v1/student/sessions/${scheduleId}`);
      if (!response.ok) {
        return 0;
      }
      const json = (await response.json()) as any;
      const violations = json?.attempt?.violationsSnapshot;
      if (!Array.isArray(violations)) {
        return 0;
      }
      return violations.filter((violation: any) => violation?.type === violationType).length;
    } catch {
      return 0;
    }
  }, { scheduleId, violationType });
}

/**
 * Drives one real Page Visibility transition. `visibilityState` is the
 * primitive the exam reads; `hidden` is kept in sync with it so the whole
 * page agrees about what the browser is reporting.
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

test.describe('Student security guardrails (LRW)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('records clipboard-blocked violation', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    const answerField = page.getByLabel('Answer for question 1');
    await answerField.click();
    await page.evaluate(() => {
      const target = document.activeElement;
      if (!target) {
        return;
      }
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    });

    await expect
      .poll(
        () =>
          hasViolation(
            page,
            manifest.student.scheduleId,
            'CLIPBOARD_BLOCKED',
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await context.close();
  });

  test('records context-menu-blocked violation', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    const answerField = page.getByLabel('Answer for question 1');

    // Firefox can be finicky about right-click synthesis; Shift+F10 is a consistent way to trigger
    // `contextmenu` from the focused element.
    await answerField.click();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => {
      document.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    await page.waitForTimeout(250);

    await expect
      .poll(
        () =>
          hasViolation(
            page,
            manifest.student.scheduleId,
            'CONTEXT_MENU_BLOCKED',
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await context.close();
  });

  test('warns and records exactly one violation for one leave/return excursion', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    const answerField = page.getByLabel('Answer for question 1');
    await answerField.fill('answer before leaving');
    await expect(answerField).toHaveValue('answer before leaving');

    // Headless browsers don't emit real tab-switch signals, so the student's
    // leave/return is modeled as the Page Visibility excursion the exam reads:
    // visible -> hidden -> visible, plus the blur noise a real switch carries.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await setDocumentVisibility(page, 'hidden');

    // Nothing is shown while the student is away: the browser is not drawing
    // the exam then, and a background timer is what iOS suspends.
    const hold = page.getByText(/Stay on the exam screen/i);
    await expect(hold).toHaveCount(0);
    await expect
      .poll(() => countViolations(page, manifest.student.scheduleId, 'TAB_SWITCH'), {
        timeout: 3_000,
      })
      .toBe(0);

    await setDocumentVisibility(page, 'visible');

    await expect(hold).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/You left the exam screen/i)).toBeVisible();
    // The warning states the recorded fact and nothing the browser cannot know.
    await expect(page.getByText(/Stay on the exam screen/i)).not.toHaveText(/cheat|ChatGPT/i);

    await page.getByRole('button', { name: 'Continue exam' }).click();
    await expect(hold).toBeHidden({ timeout: 10_000 });

    // The excursion was recorded once, and the exam resumed untouched.
    await expect
      .poll(() => countViolations(page, manifest.student.scheduleId, 'TAB_SWITCH'), {
        timeout: 12_000,
      })
      .toBe(1);
    await expect(answerField).toHaveValue('answer before leaving');

    await context.close();
  });

  test('does not warn when the exam only loses focus (blur, popups, keyboard)', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await page.waitForTimeout(1_000);

    await expect(page.getByText(/Stay on the exam screen/i)).toHaveCount(0);
    expect(await countViolations(page, manifest.student.scheduleId, 'TAB_SWITCH')).toBe(0);

    await context.close();
  });

  test('shows screenshot blackout overlay and records screenshot-attempt violation', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'PrintScreen',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const screenshotOverlay = page.getByText(/screen capture blocked/i);
    await expect(screenshotOverlay).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /continue exam/i }).click();
    await expect(screenshotOverlay).toBeHidden({ timeout: 10_000 });

    await expect
      .poll(
        () =>
          hasViolation(
            page,
            manifest.student.scheduleId,
            'SCREENSHOT_ATTEMPT',
          ),
        { timeout: 12_000 },
      )
      .toBe(true);

    await context.close();
  });
});
