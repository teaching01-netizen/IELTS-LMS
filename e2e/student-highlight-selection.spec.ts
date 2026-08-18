import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

// Palette values from src/components/student/highlightPalette.ts rendered as rgb().
const TINT_BY_COLOR: Record<string, string> = {
  yellow: 'rgb(253, 230, 138)', // #fde68a
  purple: 'rgb(221, 214, 254)', // #ddd6fe
};

interface SelectionSample {
  surface: string;
  inner: string;
  varValue: string;
}

async function openActiveStudentExam(page: Page) {
  const manifest = readBackendE2EManifest();
  const wcode = deterministicWcode('student-highlight-selection');

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

function materialSurface(page: Page): Locator {
  return page.locator('.student-exam-viewport [data-student-highlightable="true"]').first();
}

async function sampleSelection(page: Page, surface: Locator): Promise<SelectionSample> {
  return surface.evaluate((element) => {
    const surfaceElement = element as HTMLElement;
    const textParent =
      surfaceElement.querySelector('p, span, div') ?? surfaceElement;
    const range = document.createRange();
    range.selectNodeContents(textParent);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const read = (target: Element) =>
      window.getComputedStyle(target, '::selection').backgroundColor;
    return {
      surface: read(surfaceElement),
      inner: read(textParent),
      varValue: window
        .getComputedStyle(surfaceElement)
        .getPropertyValue('--student-highlight-selection-color')
        .trim(),
    };
  });
}

function expectTinted(sample: SelectionSample, color: string) {
  const tint = TINT_BY_COLOR[color];
  expect(tint, `missing expected rgb for ${color}`).toBeTruthy();
  expect(sample.varValue).toBe(
    color === 'yellow' ? '#fde68a' : color === 'purple' ? '#ddd6fe' : '',
  );
  const tinted = sample.surface === tint || sample.inner === tint;
  expect(tinted, `expected selection to be tinted ${tint} but got surface=${sample.surface} inner=${sample.inner}`).toBe(true);
}

function expectUntinted(sample: SelectionSample) {
  expect(sample.varValue).toBe('');
  const tints = Object.values(TINT_BY_COLOR);
  expect(tints).not.toContain(sample.surface);
  expect(tints).not.toContain(sample.inner);
}

test.describe('highlight tool selection tint', () => {
  test.describe.configure({ timeout: 120_000 });

  test('selection previews the active highlight color and clears when the tool turns off', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'sampled via Chromium ::selection computed styles');

    const context: BrowserContext = await browser.newContext({
      ...testInfo.project.use,
      viewport: { width: 1280, height: 800 },
    });

    try {
      await stubScreenDetails(context);
      const page = await context.newPage();
      await openActiveStudentExam(page);

      const surface = materialSurface(page);
      await expect(surface).toBeVisible();

      // Baseline: no tint while the highlight tool is off.
      expectUntinted(await sampleSelection(page, surface));

      // Activate the highlight tool; default color is yellow.
      await page.getByRole('button', { name: 'Highlight', exact: true }).click();
      expectTinted(await sampleSelection(page, surface), 'yellow');

      // Every highlightable surface in the viewport carries the tint in highlight mode.
      const marked = await page
        .locator('.student-exam-viewport [data-student-highlight-selection="true"]')
        .count();
      const highlightable = await page
        .locator('.student-exam-viewport [data-student-highlightable="true"]')
        .count();
      expect(marked).toBe(highlightable);
      expect(marked).toBeGreaterThan(0);

      // Switching the color mid-session re-tints the selection.
      await page.getByRole('button', { name: 'Choose highlight color' }).click();
      await page.locator('button[data-highlight-color="purple"]').click();
      expectTinted(await sampleSelection(page, surface), 'purple');

      // Turning the tool off restores the native selection appearance.
      await page.getByRole('button', { name: 'Highlighting', exact: true }).click();
      expectUntinted(await sampleSelection(page, surface));

      // Erase mode must not preview a paint color.
      await page.getByRole('button', { name: 'Highlight', exact: true }).click();
      await page.getByRole('button', { name: 'Erase highlights' }).click();
      expectUntinted(await sampleSelection(page, surface));
    } finally {
      await context.close();
    }
  });
});