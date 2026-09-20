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

/**
 * Chromium uses browser-generated touch events. WebKit has real layout/carets
 * here, but synthetic pointers: it cannot validate iPad gesture arbitration.
 *
 * `hold` leaves the finger down, which is the only state in which the magnifier
 * exists — a test that needs to look at the loupe must read the page mid-gesture
 * rather than after the release, and `finish` is how it ends the gesture itself.
 */
async function drag(
  page: Page,
  surface: Locator,
  phrase: string,
  browserName: string,
  isMobile: boolean,
  options: { hold?: boolean } = {},
): Promise<{ finger: { x: number; y: number }; finish: () => Promise<void> }> {
  const { from, to } = await coordinates(surface, phrase);
  const rest = async () => {};
  if (!isMobile) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (options.hold) return { finger: to, finish: async () => { await page.mouse.up(); } };
    await page.mouse.up();
    return { finger: to, finish: rest };
  }
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, id: 1 }] });
    }
    const finish = async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
    if (options.hold) return { finger: to, finish };
    await finish();
    return { finger: to, finish: rest };
  }
  await surface.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: from.x, clientY: from.y });
  await surface.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y });
  const finish = async () => {
    await surface.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y });
  };
  if (options.hold) return { finger: to, finish };
  await finish();
  return { finger: to, finish: rest };
}

/**
 * How many addressable surfaces the document contains.
 *
 * The magnifier clones rendered DOM, so this is the measurement that catches a
 * clone carrying the application's own attributes with it: with the loupe open
 * the counts must be EXACTLY what they were before the gesture, and the picture
 * must address nothing at all.
 */
async function surfaceCounts(page: Page) {
  return page.evaluate(() => ({
    stimulusRegions: document.querySelectorAll('[data-sat-annotation-region="stimulus"]').length,
    ownedSurfaces: document.querySelectorAll('[data-student-owned-touch-selection]').length,
    highlightable: document.querySelectorAll('[data-student-highlightable]').length,
    textNodes: document.querySelectorAll('[data-content-text-node]').length,
    insidePicture: document.querySelectorAll(
      '[data-selection-loupe-source] [data-sat-annotation-region], [data-selection-loupe-source] [data-student-owned-touch-selection], [data-selection-loupe-source] [data-student-highlightable], [data-selection-loupe-source] [data-content-text-node]',
    ).length,
  }));
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

/**
 * The owned selection's own painting, and where it sits on screen.
 *
 * Read from the DOM rather than from the engine's diagnostics, because the
 * question is what the STUDENT can see: the lines the surface paints and the two
 * handle controls, at their real viewport coordinates.
 */
async function ownedSelectionGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left) };
    };
    const menu = document.querySelector('[data-selection-action-menu]');
    const viewport = window.visualViewport;
    return {
      toolbarVisible: document.querySelector('[data-sat-selection-toolbar="true"]') !== null,
      menuVisibility: menu ? getComputedStyle(menu).visibility : null,
      lines: Array.from(document.querySelectorAll('[data-student-selection-line]')).map(box),
      handles: Array.from(document.querySelectorAll('[data-student-selection-handle]')).map((element) => ({
        edge: element.getAttribute('data-student-selection-handle'),
        ...box(element),
      })),
      visibleTop: viewport ? viewport.offsetTop : 0,
      visibleBottom: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
    };
  });
}

/**
 * Scrolling the passage away from the words the student chose.
 *
 * This is the third way an owned selection leaves the screen, after the student
 * dismisses it and the exam ends it: they keep reading. The contextual tools
 * belong to a span the student can see, so they go quiet — but the selection is
 * the student's, so it is kept, handles and all, and the tools come back to the
 * same words when the words come back. The handles are not separately hidden:
 * they are painted at the selection's measured endpoints, so they travel with
 * the text they point at, which is what keeps them honest when a drag is
 * auto-scrolling the passage underneath them.
 */
test('SAT: scrolling the passage away keeps the selection and its handles, and hides the tools', async ({ page, browserName, isMobile }, info) => {
  test.skip(!isMobile, 'The exam owns touch selection only on a coarse pointer.');
  // A viewport short enough that the passage is longer than its pane — on a pad
  // in portrait it fits, and a scroll that cannot move the words cannot test this
  // — and `long=1` for a passage the length of a real one, because a pane that
  // cannot scroll cannot take the selection off the screen at all.
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto(`${fixture}?product=sat&long=1`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const phrase = 'Several researchers';
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, phrase, browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();

  const scroller = page.locator('[data-sat-passage-scroll]');
  const range = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(range, 'the passage must be scrollable for this case to mean anything').toBeGreaterThan(0);
  const before = await ownedSelectionGeometry(page);
  expect(before.handles.map((handle) => handle.edge).sort()).toEqual(['end', 'start']);
  expect(before.lines.length).toBeGreaterThan(0);

  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  // The words are gone from the visible region, and with them the tools — but
  // nothing was thrown away: the surface is still mounted and claims no
  // interaction while it is hidden.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  const scrolled = await ownedSelectionGeometry(page);
  expect(scrolled.menuVisibility, 'a hidden surface stays mounted').toBe('hidden');
  // Handles and lines are still painted, and they left the screen WITH the text
  // rather than being pinned to an edge.
  expect(scrolled.handles).toHaveLength(2);
  for (const handle of [...scrolled.handles, ...scrolled.lines]) {
    expect(handle.bottom, 'the selection travelled off the top edge with its words').toBeLessThanOrEqual(scrolled.visibleTop);
  }

  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const returned = await ownedSelectionGeometry(page);
  // The same selection, not a re-made one: same count, same place, same span.
  expect(returned.handles.map((handle) => ({ edge: handle.edge, top: handle.top, left: handle.left })))
    .toEqual(before.handles.map((handle) => ({ edge: handle.edge, top: handle.top, left: handle.left })));
  expect(returned.lines).toEqual(before.lines);

  await page.locator('[data-sat-selection-toolbar="true"]').getByRole('button', { name: /yellow/i }).click();
  await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText(phrase);
  await info.attach('selection-geometry', {
    body: JSON.stringify({ before, scrolled, returned }, null, 2),
    contentType: 'application/json',
  });
});

test('the magnifier is a picture of the prose, not a second exam surface', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  const before = await surfaceCounts(page);
  expect(before.stimulusRegions).toBeGreaterThan(0);

  // Finger down and moved, and left there: the magnifier only exists mid-gesture,
  // so a test about it has to read the page while the gesture is still running.
  const gesture = await drag(page, region, 'Several researchers', browserName, isMobile, { hold: true });
  const loupe = page.locator('[data-selection-loupe]');
  await expect(loupe).toBeVisible();

  // The clones DOM, so this is the measurement that catches it carrying the
  // application's own attributes: exactly as many addressable surfaces as before
  // the gesture, and the picture addressing nothing.
  const during = await surfaceCounts(page);
  expect(during).toEqual({ ...before, insidePicture: 0 });

  // And it is still the prose: the same words, magnified, above the finger that
  // is choosing them, and reachable by neither pointer nor assistive tech.
  await expect(page.locator('[data-selection-loupe-source]')).toContainText('Several researchers');
  const geometry = await page.evaluate(() => {
    const picture = document.querySelector('[data-selection-loupe-content]') as HTMLElement;
    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    const lens = document.querySelector('[data-selection-loupe]')!.getBoundingClientRect();
    return {
      scale: new DOMMatrixReadOnly(getComputedStyle(picture).transform).a,
      centreX: lens.left + lens.width / 2,
      top: lens.top,
      size: lens.width,
      inert: clone.hasAttribute('inert'),
      hidden: clone.getAttribute('aria-hidden'),
    };
  });
  expect(geometry.scale).toBeCloseTo(1.5, 2);
  expect(geometry.inert).toBe(true);
  expect(geometry.hidden).toBe('true');
  expect(geometry.centreX).toBeCloseTo(gesture.finger.x, 0);
  // A 128px lens centred 64px above the finger puts its top edge one lens-height
  // above the finger — never under it, which is the whole point of a loupe.
  expect(geometry.top).toBeCloseTo(gesture.finger.y - geometry.size, 0);

  await gesture.finish();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
  // Nothing the picture added survives the gesture either.
  expect(await surfaceCounts(page)).toEqual({ ...before, insidePicture: 0 });
});

/**
 * The platform's reduced-motion preference, reaching the overlay.
 *
 * The policy is asserted deterministically in the unit suite (both answers, as a
 * pure function); what can only be proven here is that the browser's answer
 * ARRIVES, and that a student who asked for less motion is shown the settled
 * geometry on every frame rather than an entrance they have to sit through.
 *
 * The sampler runs inside the page on `requestAnimationFrame`, so it observes
 * every frame the compositor does rather than sampling a moment that a slow
 * machine could make look settled. Under reduced motion the frame element must
 * never be scaled.
 *
 * That the sampler can see an entrance at all is MEASURED, not assumed: run
 * against the default preference, this same sampler reads the frame at 0.9965 on
 * its first sample and below identity on 7 of its 14 frames, so "identity on
 * every frame" above is a statement about a surface that would otherwise have
 * been caught mid-scale — not about one that had already settled.
 */
test('reduced motion greets the magnifier already settled, on every frame', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  // Before the document loads: motion reads the preference once, the way a
  // student who has it set at the OS level arrives.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  const gesture = await drag(page, region, 'Several researchers', browserName, isMobile, { hold: true });

  const sampled = await page.evaluate(async () => {
    const scaleOf = (element: Element | null) => {
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === 'none') return 1;
      return new DOMMatrixReadOnly(transform).a;
    };
    const frames: number[] = [];
    let witness: string | null = null;
    let gripWitness: string | null = null;
    for (let frame = 0; frame < 14; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const lensFrame = document.querySelector('[data-selection-loupe-frame]');
      if (!lensFrame) continue;
      witness = lensFrame.getAttribute('data-selection-motion');
      const scale = scaleOf(lensFrame);
      if (scale !== null) frames.push(scale);
      gripWitness = document.querySelector('[data-student-selection-handle] .selection-v2-grip')?.getAttribute('data-selection-motion') ?? null;
    }
    return { frames, witness, gripWitness };
  });

  expect(sampled.frames.length, 'the magnifier was on screen for the sample').toBeGreaterThan(6);
  expect(sampled.witness).toBe('reduced');
  // Every frame, not merely the settled one: nothing was ever half-size.
  expect(sampled.frames.filter((scale) => scale !== 1)).toEqual([]);
  // The handle's grip answers the same way, from the same source.
  expect(sampled.gripWitness).toBe('reduced');

  await gesture.finish();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

/**
 * Where the two handles are, in the coordinates the overlay positions them at.
 *
 * Read from the inline transform rather than a rect, because a rect is exactly
 * what the reachability case below must not trust on its own.
 */
async function endpoints(page: Page) {
  return page.evaluate(() => {
    const read = (edge: string) => {
      const transform = document.querySelector(`[data-student-selection-handle="${edge}"]`)?.style.transform ?? '';
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
      return match ? { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) } : null;
    };
    return { start: read('start'), end: read('end') };
  });
}

/** Press one handle, drag it sideways, release — the gesture a student makes. */
async function dragHandle(page: Page, browserName: string, edge: 'start' | 'end', dx: number) {
  const box = await page.locator(`[data-student-selection-handle="${edge}"]`).boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  const handle = page.locator(`[data-student-selection-handle="${edge}"]`);
  await handle.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: x, clientY: y, buttons: 1 });
  await handle.dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: x + dx, clientY: y, buttons: 1 });
  await handle.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: x + dx, clientY: y });
}

/**
 * The handles are reachable — a claim about pixels and hit testing, not geometry.
 *
 * Everything else in this file reads a rect or a transform, and both are reported
 * by an element that never appears on screen. That is how the overlay shipped with
 * invisible, ungrabbable handles: it lives in a `popover`, and the platform's own
 * box for one is `fit-content` with `auto` margins and `overflow: auto`. Every
 * child of the layer is absolutely positioned, so `fit-content` resolved to zero
 * and the layer became a 0×0 scroll container at the origin — the lines still
 * painted (they are composited by `will-change`), while the handles were clipped
 * out of paint and hit testing. A finger landing on the handle it could feel but
 * not see hit the prose instead, dismissing the selection and starting a new one.
 *
 * So this case asserts the three things a rect cannot: the layer is the viewport
 * and clips nothing, a press at each handle's centre lands on that handle, and
 * adjusting one end leaves the other exactly where it was.
 */
test('the handles are painted and hittable, and dragging one moves only that end', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'Owned selection is only used on coarse pointers.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'Several researchers', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  const reach = await page.evaluate(() => {
    const layer = document.querySelector('[data-selection-floating-layer]')!;
    const box = layer.getBoundingClientRect();
    const targets = Array.from(document.querySelectorAll('[data-student-selection-handle]')).map((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      // The dot inside the control is what a point resolves to, so the check is
      // "is this handle an ancestor of what the point hit", not equality.
      return { edge: element.getAttribute('data-student-selection-handle'), hit: hit?.closest?.('[data-student-selection-handle]') === element };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      box: { width: Math.round(box.width), height: Math.round(box.height) },
      clips: getComputedStyle(layer).overflow,
      scrolls: layer.scrollWidth > layer.clientWidth || layer.scrollHeight > layer.clientHeight,
      targets,
    };
  });

  expect(reach.box, 'the layer is the viewport, not the popover floor plan').toEqual(reach.viewport);
  expect(reach.clips).toBe('visible');
  expect(reach.scrolls, 'nothing is scrolled out of a clipped box').toBe(false);
  expect(reach.targets.map((target) => target.edge).sort()).toEqual(['end', 'start']);
  expect(reach.targets.filter((target) => !target.hit)).toEqual([]);

  const before = await endpoints(page);
  await dragHandle(page, browserName, 'end', 60);
  const afterEnd = await endpoints(page);
  expect(afterEnd.start, 'the anchor did not move').toEqual(before.start);
  expect(afterEnd.end!.x, 'the grabbed endpoint followed the finger').toBeGreaterThan(before.end!.x + 20);

  await dragHandle(page, browserName, 'start', 40);
  const afterStart = await endpoints(page);
  expect(afterStart.end, 'the other end stayed where it was left').toEqual(afterEnd.end);
  expect(afterStart.start!.x).toBeGreaterThan(afterEnd.start!.x + 10);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
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

for (const product of ['IELTS', 'SAT'] as const) {
  test(`${product}: recovers from Safari returning a text caret outside the touched passage`, async ({ page, browserName, isMobile }, info) => {
    test.skip(!isMobile, 'Owned selection is only used on coarse pointers.');
    // Reproduce the supplied device trace: the standard API is unavailable,
    // and the legacy API returns a connected text node outside the exam root.
    // Layout and the pointer gesture still run through the actual components.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: undefined });
      Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => {
        let outside = document.querySelector('[data-outside-caret-fixture]');
        if (!outside) {
          outside = document.createElement('span');
          outside.setAttribute('data-outside-caret-fixture', '');
          outside.setAttribute('aria-hidden', 'true');
          outside.textContent = 'Unrelated toolbar text';
          document.body.append(outside);
        }
        const range = document.createRange();
        range.setStart(outside.firstChild!, 0);
        range.collapse(true);
        return range;
      } });
    });
    await page.goto(product === 'SAT' ? `${fixture}?product=sat` : fixture);
    await page.getByRole('button', { name: product === 'SAT' ? /^Highlights & Notes/ : 'Highlight', exact: product === 'IELTS' }).click();
    const surface = page.locator(product === 'SAT' ? '[data-sat-annotation-region="stimulus"]' : passage);
    const phrase = product === 'SAT' ? 'Several researchers' : 'beta gamma';
    await drag(page, surface, phrase, browserName, isMobile);
    const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
    await info.attach('outside-caret-trace', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    const selected = snapshot!.surfaces.find(item => item['surface'] === (product === 'SAT' ? 'SAT stimulus' : 'IELTS reading:passage:passage-1'));
    expect(selected).toMatchObject({ startCaretInsideRoot: true, focusCaretInsideRoot: true, rangeText: phrase, captureSucceeded: true, pointerCancelSeen: false });
    if (product === 'SAT') {
      await page.locator('[data-sat-selection-toolbar="true"]').getByRole('button', { name: /yellow/i }).click();
      await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText(phrase);
    } else await expect(surface.locator('mark')).toHaveText(phrase);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  });
}
