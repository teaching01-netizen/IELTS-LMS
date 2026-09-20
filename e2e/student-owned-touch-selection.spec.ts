import { expect, test, type Page, type Locator } from '@playwright/test';

const fixture = '/e2e/fixtures/touch-selection/index.html';
const passage = '.student-reading-passage-pane [data-student-highlightable="true"]';

async function coordinates(surface: Locator, phrase: string) {
  return surface.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      const point = (offset: number) => {
        const range = document.createRange();
        range.setStart(node!, offset); range.setEnd(node!, offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      };
      return { from: point(start), to: point(start + text.length) };
    }
    throw new Error(`Missing text: ${text}`);
  }, phrase);
}

/** Chromium uses browser-generated touch events. WebKit has real layout/carets
 * here, but synthetic pointers: it cannot validate iPad gesture arbitration. */
async function drag(page: Page, surface: Locator, phrase: string, browserName: string, isMobile: boolean) {
  const { from, to } = await coordinates(surface, phrase);
  if (!isMobile) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  } else if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await surface.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: from.x, clientY: from.y });
    await surface.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y });
    await surface.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y });
  }
}

test('IELTS Reading: arming, caret resolution, range, capture and persistence', async ({ page, browserName, isMobile }, info) => {
  await page.goto(fixture);
  const surface = page.locator(passage);
  await expect(surface).toBeVisible();
  const before = await surface.elementHandle();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Highlight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await surface.evaluate((root, original) => root === original, before)).toBe(true);
  const styles = await surface.evaluate(root => ({ marker: root.getAttribute('data-student-owned-touch-selection'), select: getComputedStyle(root).getPropertyValue('-webkit-user-select'), touch: getComputedStyle(root).touchAction }));
  expect(styles).toEqual(isMobile ? { marker: 'true', select: 'none', touch: 'none' } : { marker: null, select: 'text', touch: 'auto' });
  await drag(page, surface, 'beta gamma', browserName, isMobile);
  await expect(surface.locator('mark')).toHaveText('beta gamma');
  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  await info.attach('selection-trace', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
  if (isMobile) {
    const selected = snapshot!.surfaces.find(item => item['surface'] === 'IELTS reading:passage:passage-1')!;
    expect(selected).toMatchObject({ listenerAttached: true, listenerRootMatches: true, pointerDownSeen: true, pointerMoveSeen: true, pointerUpSeen: true, pointerCancelSeen: false, startCaretResolved: true, focusCaretResolved: true, rangeText: 'beta gamma', onSelectCalled: true, captureSucceeded: true, mutationApplied: true });
    expect(selected['rangeRectCount']).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  }
  await page.getByText(/^Touch selection diagnostics \(/).click();
  const savedTrace = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save trace', exact: true }).click();
  await (await savedTrace).saveAs(info.outputPath('touch-selection-trace.json'));
  await page.screenshot({ path: info.outputPath('selection-diagnostics.png') });
  await page.reload();
  await expect(page.locator(passage).locator('mark')).toHaveText('beta gamma');
  await expect(page.locator(passage)).not.toHaveAttribute('data-student-owned-touch-selection');
  await page.getByRole('textbox', { name: 'Answer', exact: true }).fill('Edited answer');
  await expect(page.getByRole('textbox', { name: 'Answer', exact: true })).toHaveValue('Edited answer');
});

test('SAT: owned range reaches the actual shell toolbar and annotation state', async ({ page, browserName, isMobile }, info) => {
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, 'Several researchers', browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  await info.attach('selection-trace', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
  if (isMobile) expect(snapshot!.surfaces.find(item => item['surface'] === 'SAT stimulus')).toMatchObject({ captureSucceeded: true, onSelectCalled: true, anchorReported: true, pointerCancelSeen: false });
  await page.locator('[data-sat-selection-toolbar="true"]').getByRole('button', { name: /yellow/i }).click();
  await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText('Several researchers');
});

test('preview keeps native selection and diagnostics are opt-in', async ({ page }) => {
  await page.goto(`${fixture}?preview=1&debug=0`);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator(passage)).not.toHaveAttribute('data-student-owned-touch-selection');
  expect(await page.locator(passage).evaluate(root => getComputedStyle(root).getPropertyValue('-webkit-user-select'))).toBe('text');
  await expect(page.getByRole('region', { name: 'Touch selection diagnostics' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__studentTouchSelectionDebug)).toBeUndefined();
});

test('IELTS real layout fallback works when native caret APIs are unavailable', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'Owned selection is only used on coarse pointers.');
  await page.addInitScript(() => {
    Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: undefined });
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: undefined });
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const surface = page.locator(passage);
  await drag(page, surface, 'beta gamma', browserName, isMobile);
  await expect(surface.locator('mark')).toHaveText('beta gamma');
  const result = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot().surfaces.find(item => item['surface'] === 'IELTS reading:passage:passage-1'));
  expect(result).toMatchObject({ captureSucceeded: true, mutationApplied: true });
  expect((result!['events'] as { stage: string }[]).map(event => event.stage)).toContain('geometry');
});
