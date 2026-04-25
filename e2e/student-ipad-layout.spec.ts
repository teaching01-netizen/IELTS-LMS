import { expect, test, type Page } from '@playwright/test';
import { BUILDER_STORAGE_STATE_PATH, readBackendE2EManifest } from './support/backendE2e';

async function openPreview(page: Page, module: 'reading' | 'writing') {
  const manifest = readBackendE2EManifest();
  await page.goto(`/builder/${manifest.builder.examId}/preview?module=${module}`);
  await page.waitForLoadState('domcontentloaded');
}

async function expectFooterInsideViewport(page: Page, label: RegExp) {
  const footer = page.getByRole('contentinfo', { name: label });
  await expect(footer).toBeVisible();
  const box = await footer.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.bottom).toBeLessThanOrEqual(viewport!.height);
}

test.describe('student exam iPad layout', () => {
  test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

  test('Reading stacks panes in iPad portrait and keeps controls visible', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, 'reading');

    const splitPane = page.getByTestId('reading-split-pane');
    const passagePane = page.getByTestId('reading-passage-pane');
    const questionPane = page.getByTestId('reading-question-pane');

    await expect(splitPane).toBeVisible();
    await expect(passagePane).toBeVisible();
    await expect(questionPane).toBeVisible();
    await expect(splitPane).toHaveCSS('flex-direction', 'column');
    await expectFooterInsideViewport(page, /question navigation and progress/i);

    const passageBox = await passagePane.boundingBox();
    const questionBox = await questionPane.boundingBox();
    expect(passageBox).not.toBeNull();
    expect(questionBox).not.toBeNull();
    expect(passageBox!.bottom).toBeLessThanOrEqual(questionBox!.y + 1);
  });

  test('Reading uses split panes in iPad landscape without hiding the footer', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPreview(page, 'reading');

    const splitPane = page.getByTestId('reading-split-pane');
    const passagePane = page.getByTestId('reading-passage-pane');
    const questionPane = page.getByTestId('reading-question-pane');

    await expect(splitPane).toBeVisible();
    await expect(splitPane).toHaveCSS('flex-direction', 'row');
    await expectFooterInsideViewport(page, /question navigation and progress/i);

    const passageBox = await passagePane.boundingBox();
    const questionBox = await questionPane.boundingBox();
    expect(passageBox).not.toBeNull();
    expect(questionBox).not.toBeNull();
    expect(passageBox!.right).toBeLessThanOrEqual(questionBox!.x + 20);
  });

  test('Writing remains usable in both iPad orientations', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, 'writing');

    const splitPane = page.getByTestId('writing-split-pane');
    const promptPane = page.getByTestId('writing-prompt-pane');
    const editorPane = page.getByTestId('writing-editor-pane');
    const editor = page.getByRole('textbox', { name: /writing response/i });

    await expect(splitPane).toHaveCSS('flex-direction', 'column');
    await expect(promptPane).toBeVisible();
    await expect(editorPane).toBeVisible();
    await expect(editor).toBeVisible();
    await expectFooterInsideViewport(page, /writing task navigation and submission/i);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();
    await expect(page.getByTestId('writing-split-pane')).toHaveCSS('flex-direction', 'row');
    await expect(page.getByRole('textbox', { name: /writing response/i })).toBeVisible();
    await expectFooterInsideViewport(page, /writing task navigation and submission/i);
  });
});
