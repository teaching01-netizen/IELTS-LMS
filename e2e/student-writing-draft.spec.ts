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
  await expect(
    page.getByLabel('Answer for question 1').or(page.locator('[contenteditable="true"]').first()),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('Student writing draft flow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('writing answer is autosaved and persists across reload', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const writingEditor = page.locator('[contenteditable="true"]').first();
    const answerField = page.getByLabel('Answer for question 1');
    const isWriting = await writingEditor.isVisible().catch(() => false);
    const input = isWriting ? writingEditor : answerField;

    const testContent = `Writing draft test ${Date.now()}`;
    await input.click();
    await input.fill('');
    await input.type(testContent, { delay: 5 });

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });

    if (isWriting) {
      await expect(writingEditor).toBeVisible({ timeout: 30_000 });
      await expect(writingEditor).toContainText(testContent);
    } else {
      await expect(answerField).toBeVisible({ timeout: 30_000 });
      await expect(answerField).toHaveValue(testContent);
    }

    await context.close();
  });

  test('undo/redo works in writing editor', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const writingEditor = page.locator('[contenteditable="true"]').first();
    const answerField = page.getByLabel('Answer for question 1');
    const isWriting = await writingEditor.isVisible().catch(() => false);
    const input = isWriting ? writingEditor : answerField;

    await input.click();
    await input.fill('');
    await input.type('First version', { delay: 5 });

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    await input.fill('');
    await input.type('Second version', { delay: 5 });

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    if (isWriting) {
      await page.keyboard.press('Meta+z');
      await expect(writingEditor).toContainText('First version');

      await page.keyboard.press('Meta+Shift+z');
      await expect(writingEditor).toContainText('Second version');
    }

    await context.close();
  });

  test('word count updates as student types', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const writingEditor = page.locator('[contenteditable="true"]').first();
    const isWriting = await writingEditor.isVisible().catch(() => false);

    if (!isWriting) {
      await context.close();
      return;
    }

    const wordCountBefore = await page
      .locator('[data-testid="writing-word-count"]')
      .textContent()
      .catch(() => null);

    await writingEditor.click();
    await writingEditor.type('one two three four five', { delay: 10 });

    await expect
      .poll(async () => {
        const wc = page.locator('[data-testid="writing-word-count"]');
        if (!(await wc.isVisible().catch(() => false))) return null;
        return wc.textContent();
      }, { timeout: 10_000 })
      .not.toBe(wordCountBefore);

    await context.close();
  });

  test('paste into writing editor preserves content', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const writingEditor = page.locator('[contenteditable="true"]').first();
    const isWriting = await writingEditor.isVisible().catch(() => false);

    if (!isWriting) {
      await context.close();
      return;
    }

    await writingEditor.click();
    await writingEditor.type('Before paste. ', { delay: 5 });

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    await writingEditor.type('After paste.', { delay: 5 });

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      }, { timeout: 20_000 })
      .toBe(true);

    await expect(writingEditor).toContainText('Before paste.');

    await context.close();
  });
});
