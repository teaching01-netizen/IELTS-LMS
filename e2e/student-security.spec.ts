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
  return page.evaluate(async ({ scheduleId, violationType }) => {
    try {
      const response = await fetch(`/api/v1/student/sessions/${scheduleId}`);
      if (!response.ok) {
        return false;
      }
      const json = (await response.json()) as any;
      const violations = json?.attempt?.violationsSnapshot;
      if (!Array.isArray(violations)) {
        return false;
      }
      return violations.some((violation: any) => violation?.type === violationType);
    } catch {
      return false;
    }
  }, { scheduleId, violationType });
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

  test('records tab-switch violation on window blur', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    await page.waitForTimeout(1_500);

    // Headless browsers don't always emit real tab-switch signals consistently.
    // The runtime intentionally ignores blur-only browser/UI transitions, so
    // model the hidden-document signal that represents an actual tab switch.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      const safeDispatch = (target: EventTarget, type: string) => {
        try {
          target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        } catch {
          // Ignore
        }
      };

      safeDispatch(document, 'visibilitychange');
      safeDispatch(window, 'blur');
    });

    const tabSwitchOverlay = page.getByText(/Tab switching detected/i);
    await expect(tabSwitchOverlay).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'I Understand' }).click();
    await expect(tabSwitchOverlay).toBeHidden({ timeout: 10_000 });

    await expect
      .poll(
        () =>
          hasViolation(
            page,
            manifest.student.scheduleId,
            'TAB_SWITCH',
          ),
        { timeout: 12_000 },
      )
      .toBe(true);

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
