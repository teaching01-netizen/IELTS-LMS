import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function expectThinTabletResizer(page: Page, testId: string) {
  const resizer = page.getByTestId(testId);
  await expect(resizer).toBeVisible();
  const box = await resizer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(32);
}

async function expectCenteredInViewport(page: Page, label: RegExp) {
  const dialog = page.getByRole('dialog', { name: label });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y + box!.height / 2 - viewport!.height / 2)).toBeLessThanOrEqual(1);
}

async function completeHighlightSelection(surface: Locator, start: number, end: number) {
  await surface.evaluate((surface, { start, end }) => {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let startNode: Node | null = null;
    let endNode: Node | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!startNode && start <= cursor + length) {
        startNode = node;
        startOffset = Math.max(0, start - cursor);
      }
      if (end <= cursor + length) {
        endNode = node;
        endOffset = Math.max(0, end - cursor);
        break;
      }
      cursor += length;
    }
    if (!startNode || !endNode) throw new Error('Selection offsets exceed surface text');
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, { start, end });
}

test.describe('student exam iPad layout', () => {
  test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

  test('Reading keeps split panes in iPad portrait and keeps controls visible', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, 'reading');

    const splitPane = page.getByTestId('reading-split-pane');
    const passagePane = page.getByTestId('reading-passage-pane');
    const questionPane = page.getByTestId('reading-question-pane');

    await expect(splitPane).toBeVisible();
    await expect(passagePane).toBeVisible();
    await expect(questionPane).toBeVisible();
    await expect(splitPane).toHaveCSS('flex-direction', 'row');
    await expectThinTabletResizer(page, 'reading-pane-resizer');
    await expectFooterInsideViewport(page, /question navigation and progress/i);

    const passageBox = await passagePane.boundingBox();
    const questionBox = await questionPane.boundingBox();
    expect(passageBox).not.toBeNull();
    expect(questionBox).not.toBeNull();
    expect(passageBox!.right).toBeLessThanOrEqual(questionBox!.x + 20);
  });

  test('Reading uses split panes in iPad landscape without hiding the footer', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPreview(page, 'reading');

    const splitPane = page.getByTestId('reading-split-pane');
    const passagePane = page.getByTestId('reading-passage-pane');
    const questionPane = page.getByTestId('reading-question-pane');

    await expect(splitPane).toBeVisible();
    await expect(splitPane).toHaveCSS('flex-direction', 'row');
    await expectThinTabletResizer(page, 'reading-pane-resizer');
    await expectFooterInsideViewport(page, /question navigation and progress/i);

    const passageBox = await passagePane.boundingBox();
    const questionBox = await questionPane.boundingBox();
    expect(passageBox).not.toBeNull();
    expect(questionBox).not.toBeNull();
    expect(passageBox!.right).toBeLessThanOrEqual(questionBox!.x + 20);
  });

  test('Reading highlight tool applies repeatedly, switches color, erases, and survives scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPreview(page, 'reading');

    const highlightButton = page.getByRole('button', { name: 'Highlight' });
    const optionsButton = page.getByRole('button', { name: 'Choose highlight color' });
    const eraseButton = page.getByRole('button', { name: 'Erase highlights' });
    const passageSurface = page
      .getByTestId('reading-passage-pane')
      .locator('[data-student-highlightable="true"]')
      .first();
    await expect(highlightButton).toBeVisible();
    await expect(optionsButton).toBeVisible();
    await expect(eraseButton).toBeVisible();
    const highlightBox = await highlightButton.boundingBox();
    const optionsBox = await optionsButton.boundingBox();
    const eraseBox = await eraseButton.boundingBox();
    expect(highlightBox).not.toBeNull();
    expect(optionsBox).not.toBeNull();
    expect(eraseBox).not.toBeNull();
    expect(highlightBox!.width).toBeGreaterThanOrEqual(44);
    expect(highlightBox!.height).toBeGreaterThanOrEqual(44);
    expect(optionsBox!.width).toBeGreaterThanOrEqual(44);
    expect(optionsBox!.height).toBeGreaterThanOrEqual(44);
    expect(eraseBox!.width).toBeGreaterThanOrEqual(44);
    expect(eraseBox!.height).toBeGreaterThanOrEqual(44);
    await highlightButton.click();
    await expect(page.getByRole('button', { name: 'Highlighting' })).toBeVisible();

    await completeHighlightSelection(passageSurface, 0, 4);
    await expect(page.locator('mark[data-highlighted="true"]')).toHaveCount(1);
    await completeHighlightSelection(passageSurface, 5, 9);
    await expect(page.locator('mark[data-highlighted="true"]')).toHaveCount(2);

    await optionsButton.click();
    const paletteBox = await page.getByRole('group', { name: 'Highlight options' }).boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox!.x + paletteBox!.width).toBeLessThanOrEqual(optionsBox!.x + optionsBox!.width + 1);
    expect(paletteBox!.x).toBeGreaterThanOrEqual(12);
    await page.getByRole('button', { name: 'Blue' }).click();
    await completeHighlightSelection(passageSurface, 10, 14);
    await expect(page.locator('mark[data-highlight-color="blue"]')).toHaveCount(1);

    await page.getByTestId('reading-passage-pane').evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(page.getByRole('button', { name: 'Highlighting' })).toBeVisible();
    await eraseButton.click();
    await expect(eraseButton).toHaveAttribute('aria-pressed', 'true');
    await expect(highlightButton).toHaveAttribute('aria-pressed', 'false');
    await completeHighlightSelection(passageSurface, 0, 4);
    await expect(page.locator('mark[data-highlighted="true"]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /apply .* highlight/i })).toHaveCount(0);
  });

  test('Question Navigator stays centered in both iPad orientations', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, 'reading');

    await page.getByRole('button', { name: /open question navigator/i }).click();
    await expectCenteredInViewport(page, /question navigator/i);

    await page.getByRole('button', { name: /close question navigator/i }).click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole('button', { name: /open question navigator/i }).click();
    await expectCenteredInViewport(page, /question navigator/i);
  });

  test('Writing remains usable in both iPad orientations', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, 'writing');

    const splitPane = page.getByTestId('writing-split-workspace');
    const promptPane = page.getByTestId('writing-task-prompt');
    const promptSurface = promptPane.locator('[data-student-highlightable="true"]');
    const editor = page.getByRole('textbox', { name: /writing response/i });

    await expect(splitPane).toHaveCSS('flex-direction', 'row');
    await expect(promptPane).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erase highlights' })).toBeVisible();
    await expect(promptSurface).toHaveCount(1);
    await expect(editor).not.toHaveAttribute('data-student-highlightable');
    expect(await editor.evaluate((element) => element.closest('[data-student-highlightable="true"]'))).toBeNull();

    await page.getByRole('button', { name: 'Highlight' }).click();
    await completeHighlightSelection(promptSurface, 0, 4);
    await expect(promptPane.locator('mark[data-highlighted="true"]')).toHaveCount(1);
    await expectThinTabletResizer(page, 'writing-pane-resizer');
    await expectFooterInsideViewport(page, /writing task navigation and submission/i);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();
    await expect(page.getByTestId('writing-split-workspace')).toHaveCSS('flex-direction', 'row');
    await expect(page.getByRole('textbox', { name: /writing response/i })).toBeVisible();
    await expectThinTabletResizer(page, 'writing-pane-resizer');
    await expectFooterInsideViewport(page, /writing task navigation and submission/i);
  });
});
