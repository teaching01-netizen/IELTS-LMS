import { expect, test, type Locator, type Page } from '@playwright/test';
import { studentHighlightPalette } from '../src/components/student/highlightPalette';

const fixture = '/e2e/fixtures/touch-selection/index.html';
const surfaceSelector = '.student-reading-passage-pane [data-student-owned-touch-selection="true"]';

async function dragText(page: Page, surface: Locator, text: string, browserName: string, isMobile: boolean) {
  const paragraph = surface.locator('p').filter({ hasText: /^Alpha beta/ }).first();
  await paragraph.scrollIntoViewIfNeeded();
  const { from, to } = await paragraph.evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const start = node.data.indexOf(phrase);
      if (start < 0) continue;
      const point = (offset: number) => {
        const range = document.createRange();
        range.setStart(node!, offset);
        range.setEnd(node!, offset + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      };
      return { from: point(start), to: point(start + phrase.length - 1) };
    }
    throw new Error(`Missing phrase: ${phrase}`);
  }, text);

  if (!isMobile) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    return () => page.mouse.up();
  }
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y, id: 1 }],
      });
    }
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
  }
  // WebKit provides real caret/layout measurements, but these pointers do not
  // exercise iPadOS's native gesture recognizer.
  await surface.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: from.x, clientY: from.y });
  await surface.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: to.x, clientY: to.y });
  return () => surface.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1 });
}

test('IELTS locked preview without an owned gesture still highlights through native selection', async ({ page, browserName, isMobile }) => {
  // WebKit here uses synthetic pointers that cannot make a real native
  // selection, and CDP-synthesized touch does not run the long-press
  // recognizer that starts touch text selection. Desktop mouse is genuine
  // platform input; the touch commit path is covered by unit tests and the
  // owned-gesture suites.
  test.skip(browserName !== 'chromium' || isMobile, 'Requires real mouse input for native selection.');
  await page.goto(`${fixture}?preview=1&lock=1`);
  const surface = page.locator('.student-reading-passage-pane [data-student-highlightable="true"]');
  await expect(surface).toBeVisible();
  await expect(surface).not.toHaveAttribute('data-student-selection-owner', 'app');
  await expect(page.locator('html.student-exam-active')).toHaveCount(1);

  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(surface).toHaveAttribute('data-student-highlight-armed', 'true');
  await expect(surface).not.toHaveAttribute('data-student-selection-owner', 'app');
  expect(await surface.evaluate((root) => getComputedStyle(root).userSelect)).toBe('text');

  const release = await dragText(page, surface, 'beta', browserName, isMobile);
  const selected = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      text: selection?.toString() ?? null,
      ranges: selection?.rangeCount ?? null,
      anchor: selection?.anchorNode?.nodeName ?? null,
    };
  });
  expect(selected.ranges).toBeGreaterThan(0);
  // Native selection has no word expansion: the helper lands mid-glyph, so
  // the committed span is the exact dragged characters.
  expect(selected.text ?? '').toContain('bet');
  await release();
  await expect(surface.locator('mark')).toHaveText('bet');
  await expect(page.locator('[data-student-selection-highlight]')).toHaveCount(0);
});

test('IELTS previews each color, applies on release, and partially erases persistently without a menu', async ({ page, browserName, isMobile }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const surface = page.locator(surfaceSelector);
  await expect(surface).toHaveAttribute('data-student-selection-owner', 'app');
  expect(await surface.evaluate((root) => getComputedStyle(root).getPropertyValue('user-select') || getComputedStyle(root).getPropertyValue('-webkit-user-select'))).toBe('none');

  for (const entry of studentHighlightPalette) {
    await page.getByRole('combobox', { name: 'Highlight color' }).selectOption(entry.id);
    const release = await dragText(page, surface, 'Alpha beta gamma', browserName, isMobile);
    const line = page.locator('[data-student-selection-line]').first();
    await expect(line).toBeVisible();
    const colors = await line.evaluate((element, color) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `color-mix(in srgb, ${color} 45%, transparent)`;
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(element).backgroundColor, expected };
    }, entry.highlightColorValue);
    expect(colors.actual).toBe(colors.expected);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await expect(page.locator('[data-selection-action-menu], [data-sat-selection-toolbar]')).toHaveCount(0);
    await release();
    await expect(surface.locator('mark')).toHaveText('Alpha beta gamma');
    await expect(surface.locator('mark')).toHaveAttribute('data-highlight-color', entry.id);
    await expect(page.locator('[data-student-selection-highlight]')).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  const release = await dragText(page, surface, 'beta', browserName, isMobile);
  await expect(page.locator('[data-student-selection-line]').first()).toHaveCSS('background-color', 'rgba(100, 116, 139, 0.25)');
  await release();
  await expect(surface.locator('mark')).toHaveText(['Alpha ', ' gamma']);
  await expect(surface.locator('mark').first()).toHaveAttribute('data-highlight-color', 'purple');
  await expect(surface.locator('mark').last()).toHaveAttribute('data-highlight-color', 'purple');
  await expect(page.locator('[data-student-selection-highlight]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.student-reading-passage-pane mark')).toHaveText(['Alpha ', ' gamma']);
  await page.getByRole('textbox', { name: 'Answer', exact: true }).fill('Answer still editable');
  await expect(page.getByRole('textbox', { name: 'Answer', exact: true })).toHaveValue('Answer still editable');
  await expect(page.locator(surfaceSelector)).toHaveCount(0);
});

test('IELTS keyboard selection hands back to native text, then the next pointer is custom again', async ({ page, browserName, isMobile }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const surface = page.locator(surfaceSelector);
  await surface.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(surface).not.toHaveAttribute('data-student-selection-owner');
  await surface.evaluate((root) => {
    const paragraph = [...root.querySelectorAll('p')].find((element) => element.textContent?.startsWith('Alpha beta'))!;
    const text = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 10);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // Exercise Alt+H before selectionchange's automatic keyboard completion.
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true, bubbles: true }));
  });
  await expect(surface.locator('mark')).toHaveText('beta');
  const release = await dragText(page, surface, 'gamma', browserName, isMobile);
  await expect(surface).toHaveAttribute('data-student-selection-owner', 'app');
  await expect(page.locator('[data-student-selection-line]').first()).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await release();
});

for (const armed of [false, true]) {
  test(`IELTS ${armed ? 'armed' : 'disarmed'} touch selection still allows vertical passage scrolling`, async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || !isMobile, 'Requires browser-generated touch events.');
    await page.goto(fixture);
    if (armed) await page.getByRole('button', { name: 'Highlight', exact: true }).click();
    const pane = page.locator('.student-reading-passage-pane');
    const paragraph = pane.locator('p').filter({ hasText: /^Alpha beta/ }).first();
    await paragraph.scrollIntoViewIfNeeded();
    const box = await paragraph.boundingBox();
    if (!box) throw new Error('Missing passage paragraph');
    const before = await pane.evaluate((root) => root.scrollTop);
    const x = box.x + 12;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 8, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => pane.evaluate((root) => root.scrollTop)).toBeGreaterThan(before);
    await expect(pane.locator('mark')).toHaveCount(0);
    await expect(page.locator('[data-student-selection-highlight]')).toHaveCount(0);
  });
}
