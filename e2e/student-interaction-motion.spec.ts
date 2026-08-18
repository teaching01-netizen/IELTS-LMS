import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { GENERATED_DIR, readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

const WC = 'student-interaction-motion';

fs.mkdirSync(GENERATED_DIR, { recursive: true });

function screenshotPath(name: string) {
  return path.join(GENERATED_DIR, name);
}

async function openActiveStudentExam(page: Page) {
  const manifest = readBackendE2EManifest();
  const wcode = deterministicWcode(WC);

  await studentCheckIn(page, manifest.student.scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: `E2E Candidate ${wcode}`,
  });
  await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
}

test.describe('student exam interaction motion', () => {
  test.describe.configure({ timeout: 180_000 });

  test('wide exam: recipe transitions, press feedback, navigator entrance, chip state preserved', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'computed-style sampling runs in Chromium');

    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 1280, height: 800 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      await openActiveStudentExam(page);

      const questionsButton = page.getByRole('button', { name: 'Open question navigator' });
      await expect(questionsButton).toBeVisible();

      // MI-1: every header control carries the shared press recipe (150ms, scale + colors).
      const motion = await questionsButton.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          transitionDuration: style.transitionDuration,
          transitionProperty: style.transitionProperty,
          scale: style.scale,
          transform: style.transform,
        };
      });
      expect(motion.transitionDuration).toBe('0.15s');
      expect(motion.transitionProperty).toContain('scale');
      expect(motion.transitionProperty).toContain('background-color');

      // Press feedback: :active scales the control down to 0.96, release restores it.
      await questionsButton.hover();
      await page.mouse.down();
      await expect
        .poll(
          async () =>
            questionsButton.evaluate(
              (element) =>
                `${window.getComputedStyle(element).scale}|${window.getComputedStyle(element).transform}`,
            ),
          { timeout: 5_000 },
        )
        .toMatch(/0\.96|matrix\(0\.96/);
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            questionsButton.evaluate(
              (element) =>
                `${window.getComputedStyle(element).scale}|${window.getComputedStyle(element).transform}`,
            ),
          { timeout: 5_000 },
        )
        .not.toMatch(/0\.96|matrix\(0\.96/);

      // MI-1 regression guard: the footer current-chip state colors are untouched.
      const footer = page.getByRole('contentinfo', { name: /question navigation and progress/i });
      const currentChip = footer.getByRole('button', { name: '1', exact: true }).first();
      await expect(currentChip).toBeVisible();
      expect(await currentChip.evaluate((element) => window.getComputedStyle(element).backgroundColor)).toBe(
        'rgb(0, 82, 204)', // themed bg-blue-800 (#0052CC)
      );
      expect(
        await currentChip.evaluate((element) => window.getComputedStyle(element).transitionDuration),
      ).toBe('0.15s');

      // MI-3: the navigator dialog and its backdrop animate in.
      await questionsButton.click();
      const dialog = page.getByRole('dialog', { name: 'Question Navigator' });
      await expect(dialog).toBeVisible();
      await expect
        .poll(async () =>
          dialog.evaluate(
            (element) =>
              `${window.getComputedStyle(element).animationName}|${window
                .getComputedStyle(element, '::backdrop')
                .animationName}`,
          ),
        )
        .toBe('student-surface-in|student-backdrop-in');
      await page.screenshot({ path: screenshotPath('ds-motion-navigator.png') });
      await page.getByRole('button', { name: 'Close question navigator' }).click();

      await page.screenshot({ path: screenshotPath('ds-motion-wide.png') });
    } finally {
      await context.close();
    }
  });

  test('prefers-reduced-motion collapses the recipe transitions to near-zero', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'computed-style sampling runs in Chromium');

    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 1280, height: 800 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openActiveStudentExam(page);

      const questionsButton = page.getByRole('button', { name: 'Open question navigator' });
      await expect(questionsButton).toBeVisible();

      const duration = await questionsButton.evaluate(
        (element) => window.getComputedStyle(element).transitionDuration,
      );
      expect(parseFloat(duration)).toBeLessThan(0.001);
    } finally {
      await context.close();
    }
  });

  test('compact exam: pressed tab state is visible and swaps on selection', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'computed-style sampling runs in Chromium');

    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      await openActiveStudentExam(page);

      const shell = page.getByTestId('student-exam-shell');
      await expect(shell).toHaveAttribute('data-student-layout-mode', 'compact');

      const passageTab = page.getByRole('button', { name: 'Passage', exact: true });
      const questionsTab = page.getByRole('button', { name: 'Questions', exact: true });
      await expect(passageTab).toBeVisible();

      // MI-2: the pressed tab renders themed blue-700 border, the unpressed one themed gray-300.
      const border = async (tab: ReturnType<Page['getByRole']>) =>
        tab.evaluate((element) => window.getComputedStyle(element).borderColor);
      expect(await border(passageTab)).toBe('rgb(0, 101, 255)'); // themed border-blue-700 (#0065FF)
      expect(await border(questionsTab)).toBe('rgb(165, 173, 186)'); // themed border-gray-300 (#A5ADBA)
      expect(await passageTab.evaluate((element) => window.getComputedStyle(element).transitionDuration)).toBe(
        '0.15s',
      );

      await questionsTab.click();
      await expect(questionsTab).toHaveAttribute('aria-pressed', 'true');
      // Border-color transitions over 150ms, so poll until the paint settles.
      await expect
        .poll(async () => border(questionsTab), { timeout: 5_000 })
        .toBe('rgb(0, 101, 255)');
      await expect
        .poll(async () => border(passageTab), { timeout: 5_000 })
        .toBe('rgb(165, 173, 186)');

      // Compact timer pill transitions its state colors.
      const pill = page.getByTestId('student-header-timer-slot');
      const pillMotion = await pill.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return { duration: style.transitionDuration, property: style.transitionProperty };
      });
      expect(pillMotion.duration).toBe('0.15s');
      expect(pillMotion.property).toContain('background-color');

      await page.screenshot({ path: screenshotPath('ds-motion-compact.png') });
    } finally {
      await context.close();
    }
  });
});
