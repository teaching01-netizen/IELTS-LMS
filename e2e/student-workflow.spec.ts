import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
  scanStudentTouchTargets,
} from './support/studentUi';

async function expectCompactTouchTargets(page: Parameters<typeof scanStudentTouchTargets>[0]) {
  expect(await scanStudentTouchTargets(page)).toEqual([]);
}


test.describe('Student LRW workflow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('registration page enforces required check-in fields', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/student/${manifest.studentSelfPaced.scheduleId}`);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(
      page.getByText(/wcode is required/i),
    ).toBeVisible();
    await expect(
      page.getByText('Email is required and must be valid'),
    ).toBeVisible();
    await expect(page.getByText('Name is required', { exact: true })).toBeVisible();
  });

  test('runtime-backed: student answers without direct submission controls', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext({
      ...testInfo.project.use,
    });
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: `E2E Candidate ${wcode}`,
    });
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    const showQuestions = page.getByRole('button', { name: 'Show questions' });
    if (await showQuestions.isVisible().catch(() => false)) {
      await showQuestions.click();
      await expect(showQuestions).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('Answer for question 1').fill('');
    await page.getByLabel('Answer for question 1').fill(manifest.student.expectedAnswer);
    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        if (await banner.getByText('Saved').isVisible().catch(() => false)) return 'saved';
        if (await banner.getByText(/Saving|Syncing/i).isVisible().catch(() => false)) return 'saving';
        return 'unknown';
      }, { timeout: 20_000 })
      .toBe('saved');
    await expect(page.getByRole('button', { name: 'Finish' })).toHaveCount(0);

    await context.close();
  });

  test('runtime-backed: compact shell fits 360px and keeps mobile controls usable', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'This narrow viewport acceptance belongs to mobile device profiles.');

    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 360, height: 800 },
    });
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: `E2E Candidate ${wcode}`,
    });
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);

    await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-layout-mode',
      'compact',
    );
    await expect(page.getByTestId('student-compact-header')).toBeVisible();
    await expect(page.getByTestId('student-compact-question-navigation')).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous question' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish' })).toHaveCount(0);

    await expectCompactTouchTargets(page);

    const geometry = await page.evaluate(() => {
      const targetRects = [...document.querySelectorAll<HTMLElement>('[data-student-primary-touch-target]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        targetRects,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.targetRects.length).toBeGreaterThan(0);
    expect(geometry.targetRects.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

    await page.getByRole('button', { name: 'Show questions' }).click();
    await expectCompactTouchTargets(page);
    const answerField = page.getByLabel('Answer for question 1');
    await answerField.fill('');
    await answerField.fill(manifest.student.expectedAnswer);
    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        const saved = banner.getByText('Saved');
        if (await saved.isVisible().catch(() => false)) return 'saved';
        const saving = banner.getByText(/Saving|Syncing/i);
        if (await saving.isVisible().catch(() => false)) return 'saving';
        return 'unknown';
      }, { timeout: 20_000 })
      .toBe('saved');

    await expect(page.getByLabel('Answer for question 1')).toHaveValue(manifest.student.expectedAnswer);
    await page.getByRole('button', { name: 'Show passage' }).click();
    await expect(page.getByTestId('listening-split-workspace')).toBeVisible();
    await expect(page.getByLabel('Answer for question 1')).toHaveCount(0);
    await expectCompactTouchTargets(page);
    await page.getByRole('button', { name: 'Show questions' }).click();
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(manifest.student.expectedAnswer);
    await expectCompactTouchTargets(page);

    await page.getByRole('button', { name: 'Show passage' }).click();
    await page.setViewportSize({ width: 800, height: 360 });
    await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-layout-mode',
      'medium',
    );
    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-layout-mode',
      'compact',
    );
    await page.getByRole('button', { name: 'Show questions' }).click();
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(manifest.student.expectedAnswer);

    await page.getByRole('button', { name: 'Open exam tools' }).click();
    const toolsDialog = page.getByRole('dialog', { name: 'Exam tools' });
    await expect(toolsDialog).toBeVisible();
    await expectCompactTouchTargets(page);
    const questionNavigatorButton = toolsDialog.getByRole('button', { name: 'Question navigator' });
    await expect(questionNavigatorButton).toBeVisible();
    await questionNavigatorButton.click();
    const questionNavigator = page.locator('dialog[aria-labelledby="question-navigator-title"]');
    await expect(questionNavigator).toBeVisible();
    await expectCompactTouchTargets(page);
    await questionNavigator.getByRole('button', { name: 'Close question navigator' }).click();
    await expect(questionNavigator).not.toBeVisible();

    await context.close();
  });

  test('runtime-backed: tablet device profiles preserve orientation and touch layout', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('tablet-'), 'This device-profile acceptance belongs to tablet projects.');

    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext({
      ...testInfo.project.use,
    });
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: `E2E Candidate ${wcode}`,
    });
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);
    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const isPortraitProject = testInfo.project.name === 'tablet-portrait';
    expect(testInfo.project.use.hasTouch).toBe(true);
    expect(viewport.width < viewport.height).toBe(isPortraitProject);
    await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-layout-mode',
      'medium',
    );
    await expect(page.getByTestId('student-compact-header')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Show questions' })).toHaveCount(0);
    await expectCompactTouchTargets(page);

    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

    await context.close();
  });
});
