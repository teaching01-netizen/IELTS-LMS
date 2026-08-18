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
  waitForStudentViewportHeight,
} from './support/studentViewportAssertions';

/**
 * Executable acceptance specification (ATDD) for the student exam viewport
 * contract. The product rule:
 *
 *   The exam owns a stable layout viewport. The browser keyboard may reduce
 *   the visible area, but it must not resize/reflow the exam chrome.
 *
 * Scenario IDs map 1:1 to the acceptance criteria:
 *   AC-VP-01 entering the exam fills the viewport
 *   AC-VP-02 keyboard must not move the footer upward
 *   AC-VP-03 focused input remains usable
 *   AC-VP-04 closing the keyboard restores identical layout
 *   AC-VP-05 browser chrome resize is not mistaken for a keyboard
 *   AC-VP-06 orientation changes establish a new baseline
 *   AC-VP-07 safe areas remain respected
 *   AC-VP-08 desktop behavior does not regress
 */

const GEOMETRY_TOLERANCE_PX = 2;

interface ExamGeometrySnapshot {
  viewportWidth: number;
  viewportHeight: number;
  shell: { top: number; bottom: number; height: number };
  header: { top: number; bottom: number };
  footer: { top: number; bottom: number; height: number };
  documentScrollTop: number;
  documentScrollHeight: number;
  documentClientHeight: number;
  paneScrollTop: number;
  paneMaxScrollTop: number;
}

async function snapshotExamGeometry(page: Page): Promise<ExamGeometrySnapshot> {
  return page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        throw new Error(`Missing geometry element: ${selector}`);
      }
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const answerInput = document.querySelector<HTMLElement>(
      'input[aria-label="Answer for question 1"], textarea[aria-label="Answer for question 1"]',
    );
    const pane = answerInput?.closest<HTMLElement>('[data-student-zoom-scroll]') ?? null;
    const paneMaxScrollTop = pane
      ? Math.max(0, pane.scrollHeight - pane.clientHeight)
      : 0;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shell: measure('[data-testid="student-exam-shell"]'),
      header: measure('[data-testid="student-exam-shell"] [role="banner"]'),
      footer: measure('[data-testid="student-exam-shell"] .student-exam-footer'),
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      paneScrollTop: pane?.scrollTop ?? 0,
      paneMaxScrollTop: paneMaxScrollTop,
    };
  });
}

function expectClose(actual: number, expected: number, label: string): void {
  expect(
    Math.abs(actual - expected),
    `${label}: actual ${actual}, expected ${expected} (tolerance ${GEOMETRY_TOLERANCE_PX}px)`,
  ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}

function expectNoDocumentScroll(snapshot: ExamGeometrySnapshot): void {
  expect(snapshot.documentScrollTop, 'document.scrollingElement.scrollTop must stay zero').toBe(0);
}

async function openActiveStudentExam(page: Page, projectName: string) {
  const manifest = readBackendE2EManifest();
  const wcode = deterministicWcode(`${projectName}:student-exam-viewport-atdd`);

  await studentCheckIn(page, manifest.student.scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: `E2E Candidate ${wcode}`,
  });
  await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
  const questionsTab = page.getByRole('button', { name: 'Questions', exact: true });
  if (await questionsTab.isVisible().catch(() => false)) {
    await questionsTab.click();
  }
}

/**
 * Simulated software-keyboard height: a meaningful reduction (>= KEYBOARD_REDUCTION_PX)
 * of the current viewport that keeps a sane minimum for tiny landscape viewports.
 */
function keyboardReducedHeight(viewHeight: number): number {
  return Math.max(200, Math.round(viewHeight * 0.6));
}

async function enterExam(page: Page, projectName: string) {
  try {
    await openActiveStudentExam(page, projectName);
  } catch {
    // Check-in typing can race on slower desktop profiles; retry once.
    await openActiveStudentExam(page, projectName);
  }
  await expect(page.getByTestId('student-exam-shell')).toBeVisible();
  await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  await expect
    .poll(async () => (await snapshotExamGeometry(page)).shell.height)
    .toBeGreaterThan(0);
}

async function simulateKeyboardOpen(page: Page) {
  const answer = page.getByLabel('Answer for question 1');
  await answer.focus();
  await expect(answer).toBeFocused();

  const current = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.setViewportSize({
    width: current.width,
    height: keyboardReducedHeight(current.height),
  });

  await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
    'data-student-keyboard-open',
    'true',
    { timeout: 10_000 },
  );
}

async function waitForExamShellSettled(page: Page) {
  // The shell animates height changes (transition-all), so wait for the
  // frozen/measured height to settle before taking geometry snapshots.
  await expect
    .poll(
      async () => {
        const geometry = await snapshotExamGeometry(page);
        return Math.abs(geometry.shell.bottom - geometry.viewportHeight);
      },
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}

async function simulateKeyboardClose(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const answer = page.getByLabel('Answer for question 1');
  await answer.blur().catch(() => {});
  await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
    'data-student-keyboard-open',
    'false',
    { timeout: 10_000 },
  );
}

function isMobileOrTabletProject(projectName: string): boolean {
  return (
    projectName.startsWith('tablet-') ||
    projectName.startsWith('mobile-')
  );
}

test.describe('student exam viewport ATDD contract', () => {
  test.describe.configure({ timeout: 120_000 });

  test('AC-VP-01: entering the exam fills the viewport and the document does not scroll', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-01`);
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-keyboard-open',
        'false',
      );
      await expect(page.locator('[data-testid="student-exam-shell"] .student-exam-footer')).toBeVisible();

      const geometry = await snapshotExamGeometry(page);
      expectClose(
        geometry.shell.bottom,
        geometry.viewportHeight,
        'shell.bottom vs layout viewport bottom',
      );
      expectNoDocumentScroll(geometry);
      expect(geometry.documentScrollHeight).toBeLessThanOrEqual(
        geometry.viewportHeight + GEOMETRY_TOLERANCE_PX,
      );
      expect(geometry.footer.bottom).toBeLessThanOrEqual(
        geometry.shell.bottom + GEOMETRY_TOLERANCE_PX,
      );
      expect(geometry.shell.height).toBeGreaterThan(0);

      const contained = await expectContainedExamLayout(page);
      expect(contained.footer.height).toBeGreaterThan(1);
    } finally {
      await context.close();
    }
  });

  test('AC-VP-02: keyboard must not move the footer upward', async ({ browser }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name),
      'Keyboard inference acceptance runs on mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-02`);

      const answer = page.getByLabel('Answer for question 1');
      const before = await snapshotExamGeometry(page);
      expect(before.footer.bottom).toBeLessThanOrEqual(
        before.shell.bottom + GEOMETRY_TOLERANCE_PX,
      );

      await simulateKeyboardOpen(page);

      const open = await snapshotExamGeometry(page);
      expectClose(open.shell.height, before.shell.height, 'shell height frozen');
      expectClose(open.footer.top, before.footer.top, 'footer layout top unchanged');
      expectClose(open.footer.bottom, before.footer.bottom, 'footer layout bottom unchanged');
      expectNoDocumentScroll(open);
      expect(open.documentScrollTop).toBe(0);
      await expect(
        page.locator('[data-testid="student-exam-shell"] .student-exam-footer'),
      ).toBeHidden();
      await expect(answer).toBeFocused();
      await expect(answer).toHaveValue('');
    } finally {
      await context.close();
    }
  });

  test('AC-VP-03: focused input remains usable while only the question pane scrolls', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name),
      'Keyboard reveal acceptance runs on mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-03`);

      const answer = page.getByLabel('Answer for question 1');
      const pane = answer.locator('xpath=ancestor::*[@data-student-zoom-scroll][1]');
      const paneScroll = await pane.evaluate((element) => {
        const owner = element as HTMLElement;
        const maxScrollTop = Math.max(0, owner.scrollHeight - owner.clientHeight);
        owner.scrollTop = maxScrollTop;
        return { maxScrollTop, scrollTop: owner.scrollTop };
      });
      await answer.focus();

      const before = await snapshotExamGeometry(page);
      const answerBefore = await answer.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
      // Only when the focused control is genuinely outside the reduced visible
      // region (the simulated keyboard area) does the pane have to move.
      const reducedVisibleBottom = Math.round(before.viewportHeight * 0.6);
      const requiresReveal =
        answerBefore.bottom > reducedVisibleBottom - 12 || answerBefore.top < 12;

      await simulateKeyboardOpen(page);

      const visibleBottom = await page.evaluate(() => {
        const visualViewport = window.visualViewport;
        return (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight);
      });
      const answerBottom = await answer.evaluate((element) =>
        element.getBoundingClientRect().bottom,
      );
      expect(answerBottom).toBeLessThanOrEqual(visibleBottom - 12);

      const after = await snapshotExamGeometry(page);
      expectNoDocumentScroll(after);
      expectClose(after.shell.top, before.shell.top, 'shell position unchanged');
      expectClose(after.shell.height, before.shell.height, 'shell height unchanged');
      expectClose(after.header.top, before.header.top, 'header position unchanged');
      expectClose(after.header.bottom, before.header.bottom, 'header size unchanged');

      if (requiresReveal && paneScroll.maxScrollTop > 0) {
        const revealScroll = await pane.evaluate((element) => (element as HTMLElement).scrollTop);
        expect(
          revealScroll,
          'the question pane must scroll internally to reveal the focused answer field',
        ).not.toBe(paneScroll.scrollTop);
      }
    } finally {
      await context.close();
    }
  });

  test('AC-VP-04: closing the keyboard restores identical layout and preserves the answer', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name),
      'Keyboard restore acceptance runs on mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-04`);

      const answer = page.getByLabel('Answer for question 1');
      const before = await snapshotExamGeometry(page);

      await simulateKeyboardOpen(page);
      await answer.fill('typed-answer');
      await expect(answer).toHaveValue('typed-answer');

      await simulateKeyboardClose(page, before.viewportWidth, before.viewportHeight);

      const footer = page.locator('[data-testid="student-exam-shell"] .student-exam-footer');
      await expect(footer).toBeVisible();

      const restored = await snapshotExamGeometry(page);
      expectClose(restored.footer.top, before.footer.top, 'footer top restored');
      expectClose(restored.footer.bottom, before.footer.bottom, 'footer bottom restored');
      expect(restored.footer.bottom).toBeLessThanOrEqual(
        restored.shell.bottom + GEOMETRY_TOLERANCE_PX,
      );
      expectNoDocumentScroll(restored);
      await expect(answer).toHaveValue('typed-answer');
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-keyboard-open',
        'false',
      );
    } finally {
      await context.close();
    }
  });

  test('AC-VP-05: browser chrome resize is not mistaken for a keyboard', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name) &&
        testInfo.project.name !== 'webkit' &&
        testInfo.project.name !== 'chromium',
      'Chrome-resize acceptance runs on tablet, mobile, and desktop Safari/Chromium profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-05`);

      const shell = page.getByTestId('student-exam-shell');
      await expect(shell).toHaveAttribute('data-student-keyboard-open', 'false');
      await expect(
        page.locator('[data-testid="student-exam-shell"] .student-exam-footer'),
      ).toBeVisible();

      const current = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      await page.setViewportSize({
        width: current.width,
        height: current.height - 124,
      });

      await waitForStudentViewportHeight(page);
      await waitForExamShellSettled(page);

      const chrome = await snapshotExamGeometry(page);
      expectClose(chrome.shell.bottom, chrome.viewportHeight, 'baseline follows chrome resize');
      await expect(shell).toHaveAttribute('data-student-keyboard-open', 'false');
      await expect(
        page.locator('[data-testid="student-exam-shell"] .student-exam-footer'),
      ).toBeVisible();
      expectNoDocumentScroll(chrome);
    } finally {
      await context.close();
    }
  });

  test('AC-VP-06: orientation changes establish a new baseline without stale heights', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name),
      'Orientation acceptance runs on mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-06`);

      const portrait = await snapshotExamGeometry(page);
      expectClose(portrait.shell.bottom, portrait.viewportHeight, 'portrait shell fills viewport');

      const landscapeSize = { width: portrait.viewportHeight, height: portrait.viewportWidth };
      await page.setViewportSize(landscapeSize);
      await waitForStudentViewportHeight(page);
      await waitForExamShellSettled(page);

      const landscape = await snapshotExamGeometry(page);
      expectClose(landscape.shell.bottom, landscape.viewportHeight, 'landscape shell fills viewport');
      expect(landscape.footer.bottom).toBeLessThanOrEqual(
        landscape.shell.bottom + GEOMETRY_TOLERANCE_PX,
      );
      expectNoDocumentScroll(landscape);

      // Orientation change while an input was active: baseline re-established,
      // keyboard state recalculated, no stale portrait height retained.
      const answer = page.getByLabel('Answer for question 1');
      await answer.focus();
      await page.setViewportSize({
        width: landscapeSize.width,
        height: keyboardReducedHeight(landscape.viewportHeight),
      });
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-keyboard-open',
        'true',
        { timeout: 10_000 },
      );

      await page.setViewportSize({ width: portrait.viewportWidth, height: portrait.viewportHeight });
      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-keyboard-open',
        'false',
        { timeout: 10_000 },
      );
      await waitForStudentViewportHeight(page);
      await waitForExamShellSettled(page);
      const rotatedBack = await snapshotExamGeometry(page);
      expectClose(
        rotatedBack.shell.bottom,
        rotatedBack.viewportHeight,
        'portrait baseline restored after keyboard-while-rotated',
      );
      expectNoDocumentScroll(rotatedBack);
    } finally {
      await context.close();
    }
  });

  test('AC-VP-07: safe areas remain respected without document overflow', async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isMobileOrTabletProject(testInfo.project.name),
      'Safe-area acceptance runs on mobile and tablet profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-07`);

      const tokenMetrics = await page.evaluate(() => {
        document.documentElement.style.setProperty('--student-safe-top', '18px');
        document.documentElement.style.setProperty('--student-safe-bottom', '24px');
        document.documentElement.style.setProperty('--student-safe-left', '12px');
        document.documentElement.style.setProperty('--student-safe-right', '12px');

        const compactHeader = document.querySelector<HTMLElement>(
          '[data-testid="student-exam-shell"] [data-testid="student-compact-header"]',
        );
        const footer = document.querySelector<HTMLElement>(
          '[data-testid="student-exam-shell"] .student-exam-footer',
        );
        if (!footer) {
          throw new Error('Safe-area boundaries are not mounted.');
        }

        return {
          footerMarginBottom: Number.parseFloat(getComputedStyle(footer).marginBottom),
          headerPaddingTop: compactHeader
            ? Number.parseFloat(getComputedStyle(compactHeader).paddingTop)
            : null,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        };
      });

      // Bottom navigation avoids the bottom inset on every layout.
      expect(tokenMetrics.footerMarginBottom).toBeGreaterThanOrEqual(24);
      // The compact header consumes the top inset; the medium/wide header is a
      // full-width bar with no top inset on iPad portrait by design.
      if (tokenMetrics.headerPaddingTop !== null) {
        expect(tokenMetrics.headerPaddingTop).toBeGreaterThanOrEqual(18);
      }
      // No safe-area padding may create document overflow.
      expect(tokenMetrics.scrollWidth).toBeLessThanOrEqual(
        tokenMetrics.clientWidth + GEOMETRY_TOLERANCE_PX,
      );
      expect(tokenMetrics.scrollHeight).toBeLessThanOrEqual(
        tokenMetrics.clientHeight + GEOMETRY_TOLERANCE_PX,
      );
    } finally {
      await context.close();
    }
  });

  test('AC-VP-08: desktop behavior does not regress', async ({ browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium' && testInfo.project.name !== 'webkit',
      'Desktop fallback acceptance runs on Chromium and WebKit desktop profiles.',
    );
    const context = await browser.newContext({
      ...testInfo.project.use,
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();

      await enterExam(page, `${testInfo.project.name}:ac-vp-08`);

      await expect(page.getByTestId('student-exam-shell')).toHaveAttribute(
        'data-student-keyboard-open',
        'false',
      );
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.locator('.student-exam-main')).toBeVisible();
      await expect(
        page.locator('[data-testid="student-exam-shell"] .student-exam-footer'),
      ).toBeVisible();

      const geometry = await snapshotExamGeometry(page);
      expectClose(geometry.shell.bottom, geometry.viewportHeight, 'desktop shell fills viewport');
      expectNoDocumentScroll(geometry);
      const contained = await expectContainedExamLayout(page);
      expect(contained.main.height).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });
});
