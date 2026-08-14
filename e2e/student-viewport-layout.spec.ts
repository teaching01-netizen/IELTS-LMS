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
import {
  expectContainedExamLayout,
  expectPrimaryTouchTargets,
  measureVisualViewport,
  waitForStudentViewportHeight,
} from './support/studentViewportAssertions';
import { STUDENT_VIEWPORT_MATRIX } from './support/studentViewportMatrix';

async function openActiveStudentExam(page: Page, projectName: string) {
  const manifest = readBackendE2EManifest();
  const wcode = deterministicWcode(`${projectName}:student-viewport-layout`);

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
  }
}

async function waitForStudentAnswerSaved(page: Page) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole('banner');
        if (await banner.getByText('Saved').isVisible().catch(() => false)) return 'saved';
        if (await banner.getByText(/Saving|Syncing/i).isVisible().catch(() => false)) return 'saving';
        const diagnostic = await page.evaluate(() => {
          const status = document.querySelector<HTMLElement>('[data-testid="student-auto-save-status"]')?.textContent ?? null;
          const answer = document.querySelector<HTMLInputElement>('input[aria-label*="Answer for question"]')?.value ?? null;
          const body = document.body?.innerText ?? '';
          return `unknown status=${status ?? '<none>'} answer=${answer ?? '<unreadable>'} body=${body.slice(0, 240)}`;
        });
        console.log(`[student-viewport] ${diagnostic}`);
        return diagnostic;
      },
      { timeout: 20_000 },
    )
    .toBe('saved');
}

async function flagStudentQuestion(page: Page, zeroBasedIndex: number) {
  const flagButton = page.getByTitle('Flag question').nth(zeroBasedIndex);
  await expect(flagButton).toBeVisible();
  await flagButton.click();
  await expect(page.getByTitle('Unflag question')).toHaveCount(1);
}

async function selectStudentQuestion(page: Page, questionNumber: number) {
  const layoutMode = await page.getByTestId('student-exam-shell').getAttribute('data-student-layout-mode');
  if (layoutMode === 'compact') {
    const nextButton = page.getByRole('button', { name: 'Next question' });
    for (let currentQuestion = 1; currentQuestion < questionNumber; currentQuestion += 1) {
      await expect(nextButton).toBeEnabled();
      await nextButton.click();
    }
    await expect(
      page.getByRole('button', {
        name: `Open question navigator, question ${questionNumber} of 3`,
      }),
    ).toBeVisible();
    return;
  }

  const footer = page.getByRole('contentinfo', { name: 'Question navigation and progress' });
  const questionButton = footer.getByRole('button', {
    name: String(questionNumber),
    exact: true,
  });
  await expect(questionButton).toBeVisible();
  await questionButton.click();
  await expect(questionButton).toHaveClass(/bg-blue-800/);
}

async function expectNoStudentSubmissionControl(page: Page) {
  await expect(page.getByRole('button', { name: 'Finish' })).toHaveCount(0);
}

test.describe('student viewport layout acceptance', () => {
  test.describe.configure({ timeout: 120_000 });

  test('AC-04: iPad portrait keeps the active objective shell contained and usable', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 768, height: 1024 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, testInfo.project.name);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'medium',
      );
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expect(page.getByLabel('Answer for question 1')).toBeVisible();

      await expectContainedExamLayout(page);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      await answer.blur();
      await expect
        .poll(
          async () => {
            const banner = page.getByRole('banner');
            if (await banner.getByText('Saved').isVisible().catch(() => false)) return 'saved';
            if (await banner.getByText(/Saving|Syncing/i).isVisible().catch(() => false)) return 'saving';
            return 'unknown';
          },
          { timeout: 20_000 },
        )
        .toBe('saved');
    } finally {
      await context.close();
    }
  });
  test('AC-05: iPad landscape keeps the active objective shell contained and usable', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 1024, height: 768 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, testInfo.project.name);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'medium',
      );
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expect(page.locator('.student-exam-main')).toBeVisible();

      const diagnostics = await expectContainedExamLayout(page);
      expect(diagnostics.main.height).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });
  for (const viewportCase of STUDENT_VIEWPORT_MATRIX.filter(
    ({ category }) => category === 'tablet',
  )) {
    test(`AC-06: ${viewportCase.name} remains contained on a tablet profile`, async ({
      browser,
    }, testInfo) => {
      test.skip(
        !testInfo.project.name.startsWith('tablet-'),
        'Larger tablet acceptance belongs to tablet device profiles.',
      );
      const context = await browser.newContext({
        ...testInfo.project.use,
        viewport: { width: viewportCase.width, height: viewportCase.height },
      });

      try {
        await stubScreenDetails(context);
        const page = await context.newPage();

        await openActiveStudentExam(page, `${testInfo.project.name}:${viewportCase.name}`);
        await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
          'data-student-layout-mode',
          'medium',
        );
        await expectContainedExamLayout(page);
      } finally {
        await context.close();
      }
    });
  }

  test('AC-07: wide breakpoint preserves answer, flag, current question, and timer', async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Boundary transition acceptance runs once on the desktop Chromium profile.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 1199, height: 900 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:wide-breakpoint`);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'medium',
      );
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      await answer.blur();
      await waitForStudentAnswerSaved(page);
      await flagStudentQuestion(page, 1);
      await selectStudentQuestion(page, 3);

      await page.setViewportSize({ width: 1200, height: 900 });
      await waitForStudentViewportHeight(page);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'wide',
      );
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expect(page.getByTitle('Unflag question')).toHaveCount(1);
      await selectStudentQuestion(page, 3);
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expectNoStudentSubmissionControl(page);
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });

  test('AC-10: tablet orientation changes preserve answer, flag, and current question', async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'tablet-portrait',
      'Orientation state acceptance runs once on the tablet portrait profile.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 768, height: 1024 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:tablet-orientation`);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      await answer.blur();
      await waitForStudentAnswerSaved(page);
      await flagStudentQuestion(page, 1);
      await selectStudentQuestion(page, 3);

      await page.setViewportSize({ width: 1024, height: 768 });
      await waitForStudentViewportHeight(page);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'medium',
      );
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expect(page.getByTitle('Unflag question')).toHaveCount(1);
      await selectStudentQuestion(page, 3);
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expectNoStudentSubmissionControl(page);
      await expectContainedExamLayout(page);

      await page.setViewportSize({ width: 768, height: 1024 });
      await waitForStudentViewportHeight(page);
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expect(page.getByTitle('Unflag question')).toHaveCount(1);
      await selectStudentQuestion(page, 3);
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });

  test('AC-11: orientation changes preserve answer state and viewport ownership', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:orientation`);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await page.setViewportSize({ width: 844, height: 390 });
      await waitForStudentViewportHeight(page);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'medium',
      );
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      const landscape = await expectContainedExamLayout(page);
      expect(landscape.orientation).toBe('landscape');

      await page.setViewportSize({ width: 390, height: 844 });
      await waitForStudentViewportHeight(page);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        'compact',
      );
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });

  test('AC-12: dynamic visual viewport resize keeps the footer and workspace contained', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:dynamic-resize`);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      const initial = await expectContainedExamLayout(page);

      await page.setViewportSize({ width: 390, height: 620 });
      await waitForStudentViewportHeight(page);
      await expect
        .poll(async () => (await measureVisualViewport(page)).height, {
          timeout: 10_000,
        })
        .toBeLessThan(initial.viewport.height);
      const resized = await expectContainedExamLayout(page);
      expect(resized.viewport.height).toBeLessThan(initial.viewport.height);
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expect(page.locator('.student-exam-footer')).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await waitForStudentViewportHeight(page);
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });

  test('AC-13: short keyboard viewport preserves an answer target and usable footer', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:keyboard`);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);

      await page.setViewportSize({ width: 390, height: 360 });
      await waitForStudentViewportHeight(page);
      await answer.focus();
      await expect(answer).toBeFocused();
      const shortViewport = await expectContainedExamLayout(page);
      expect(shortViewport.main.height).toBeGreaterThan(0);
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      await expect(page.locator('.student-exam-footer')).toBeVisible();
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
    } finally {
      await context.close();
    }
  });
  test('AC-14: compact navigation boundaries never submit', async ({ browser }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile-'),
      'Navigation-boundary acceptance runs on true mobile profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, `${testInfo.project.name}:navigation-boundaries`);
      const previous = page.getByRole('button', { name: 'Previous question' });
      const next = page.getByRole('button', { name: 'Next question' });
      const current = page.getByRole('button', { name: /Open question navigator/ });

      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await expect(current).toHaveAttribute('aria-label', expect.stringContaining('question 1 of 3'));

      await next.click();
      await expect(current).toHaveAttribute('aria-label', expect.stringContaining('question 2 of 3'));
      await expect(previous).toBeEnabled();
      await expect(next).toBeEnabled();

      await next.click();
      await expect(current).toHaveAttribute('aria-label', expect.stringContaining('question 3 of 3'));
      await expect(next).toBeDisabled();
      await expectNoStudentSubmissionControl(page);
      await expectPrimaryTouchTargets(page);
    } finally {
      await context.close();
    }
  });

  test('AC-15: tools and navigator stay reachable through a presentation change', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile-'),
      'Overlay acceptance runs on true mobile profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, `${testInfo.project.name}:overlay-accessibility`);
      const toolsTrigger = page.getByRole('button', { name: 'Open exam tools' });
      await toolsTrigger.focus();
      await toolsTrigger.click();

      const toolsSheet = page.getByRole('dialog', { name: 'Exam tools' });
      await expect(toolsSheet).toBeVisible();
      await expect(toolsSheet.getByRole('button', { name: 'Question navigator' })).toBeVisible();
      await expect
        .poll(async () => toolsSheet.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true);

      await page.keyboard.press('Escape');
      await expect(toolsSheet).toBeHidden();
      await expect(toolsTrigger).toBeFocused();

      const navigatorTrigger = page.getByRole('button', { name: /Open question navigator/ });
      await navigatorTrigger.click();
      const navigator = page.getByRole('dialog', { name: 'Question Navigator' });
      await expect(navigator).toBeVisible();
      await expect
        .poll(async () => navigator.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true);

      await page.keyboard.press('Escape');
      await expect(navigator).toBeHidden();
      await expect(navigatorTrigger).toBeFocused();

      await navigatorTrigger.click();
      const resizedNavigator = page.getByRole('dialog', { name: 'Question Navigator' });
      await expect(resizedNavigator).toBeVisible();
      await page.setViewportSize({ width: 844, height: 390 });
      await waitForStudentViewportHeight(page);
      await expect(resizedNavigator).toBeVisible();
      const viewport = await measureVisualViewport(page);
      const navigatorBox = await resizedNavigator.boundingBox();
      expect(navigatorBox).not.toBeNull();
      expect(navigatorBox!.y).toBeGreaterThanOrEqual(viewport.offsetTop);
      expect(navigatorBox!.y + navigatorBox!.height).toBeLessThanOrEqual(viewport.offsetTop + viewport.height);

      await page.keyboard.press('Escape');
      await expect(resizedNavigator).toBeHidden();
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });
  test('AC-16: enabled touch-oriented controls satisfy the 44px target contract', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile-') && !testInfo.project.name.startsWith('tablet-'),
      'Touch-target acceptance runs on true mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, `${testInfo.project.name}:touch-targets`);
      await expectPrimaryTouchTargets(page);
      await expectNoStudentSubmissionControl(page);
    } finally {
      await context.close();
    }
  });

  test('AC-17: compact pane switching preserves answers and each pane scroll position', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile-'),
      'Compact pane acceptance runs on true mobile profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 620 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      const manifest = readBackendE2EManifest();

      await openActiveStudentExam(page, `${testInfo.project.name}:pane-switching`);
      const answer = page.getByLabel('Answer for question 1');
      await answer.fill(manifest.student.expectedAnswer);
      await answer.blur();
      await waitForStudentAnswerSaved(page);

      const questionScroll = page.getByTestId('listening-question-scroll');
      const questionScrollState = await questionScroll.evaluate((element) => {
        const scrollOwner = element as HTMLElement;
        const maxScrollTop = Math.max(0, scrollOwner.scrollHeight - scrollOwner.clientHeight);
        scrollOwner.scrollTop = Math.min(maxScrollTop, 96);
        return { maxScrollTop, scrollTop: scrollOwner.scrollTop };
      });
      expect(questionScrollState.maxScrollTop).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Show passage' }).click();
      const materialScroll = page.locator('[data-student-zoom-scroll]').first();
      const materialScrollState = await materialScroll.evaluate((element) => {
        const scrollOwner = element as HTMLElement;
        const maxScrollTop = Math.max(0, scrollOwner.scrollHeight - scrollOwner.clientHeight);
        scrollOwner.scrollTop = Math.min(maxScrollTop, 64);
        return { maxScrollTop, scrollTop: scrollOwner.scrollTop };
      });
      expect(materialScrollState.maxScrollTop).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Show questions' }).click();
      await expect(answer).toHaveValue(manifest.student.expectedAnswer);
      await expect
        .poll(async () => questionScroll.evaluate((element) => (element as HTMLElement).scrollTop))
        .toBe(questionScrollState.scrollTop);

      await page.getByRole('button', { name: 'Show passage' }).click();
      await expect
        .poll(async () => materialScroll.evaluate((element) => (element as HTMLElement).scrollTop))
        .toBe(materialScrollState.scrollTop);
      await expectContainedExamLayout(page);
    } finally {
      await context.close();
    }
  });

  test('AC-18: safe-area tokens preserve footer and tools-sheet clearance', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile-'),
      'Safe-area acceptance runs on true mobile profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 390, height: 844 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, `${testInfo.project.name}:safe-area`);
      const tokenMetrics = await page.evaluate(() => {
        document.documentElement.style.setProperty('--student-safe-top', '18px');
        document.documentElement.style.setProperty('--student-safe-bottom', '24px');

        const header = document.querySelector<HTMLElement>('[data-testid="student-compact-header"]');
        const footer = document.querySelector<HTMLElement>('.student-exam-footer');
        if (!header || !footer) throw new Error('Student safe-area boundaries are not mounted.');

        return {
          headerPaddingTop: Number.parseFloat(getComputedStyle(header).paddingTop),
          footerMarginBottom: Number.parseFloat(getComputedStyle(footer).marginBottom),
        };
      });
      expect(tokenMetrics.headerPaddingTop).toBeGreaterThanOrEqual(18);
      expect(tokenMetrics.footerMarginBottom).toBeGreaterThanOrEqual(24);
      await expectContainedExamLayout(page);

      await page.getByRole('button', { name: 'Open exam tools' }).click();
      const toolsSheet = page.getByRole('dialog', { name: 'Exam tools' });
      const toolsPaddingBottom = await toolsSheet.evaluate((dialog) =>
        Number.parseFloat(getComputedStyle(dialog).paddingBottom),
      );
      expect(toolsPaddingBottom).toBeGreaterThanOrEqual(24);
      const viewport = await measureVisualViewport(page);
      const toolsBox = await toolsSheet.boundingBox();
      expect(toolsBox).not.toBeNull();
      expect(toolsBox!.y + toolsBox!.height).toBeLessThanOrEqual(viewport.offsetTop + viewport.height);
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  });

for (const viewportCase of STUDENT_VIEWPORT_MATRIX.filter(
  ({ name }) => name === 'compact regression' || name === 'phone landscape' || name === 'desktop',
)) {
  test(`AC-03/08/09: ${viewportCase.name} remains contained`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: viewportCase.width, height: viewportCase.height },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await openActiveStudentExam(page, `${testInfo.project.name}:${viewportCase.name}`);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-layout-mode',
        viewportCase.expectedLayoutMode,
      );
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
      const diagnostics = await expectContainedExamLayout(page);

      if (viewportCase.name === 'compact regression') {
        await expectPrimaryTouchTargets(page);
      }
      if (viewportCase.name === 'phone landscape') {
        expect(diagnostics.main.height).toBeGreaterThan(100);
      }
    } finally {
      await context.close();
    }
  });
}
});
