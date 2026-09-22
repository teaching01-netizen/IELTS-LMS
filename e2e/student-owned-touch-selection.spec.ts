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
        // Clamped to the node's last character: a phrase that ENDS the paragraph
        // (the fixture's RTL/Thai ones do) has no character after it, and a range
        // one past the node is an IndexSizeError rather than a coordinate.
        // Mid-node phrases — every earlier caller — are unaffected.
        const at = Math.min(offset, node!.data.length - 1);
        range.setStart(node!, at); range.setEnd(node!, at + 1);
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

/**
 * How far into its entrance the lens's frame is, read from the frame itself.
 *
 * The frame is the element that scales in, and every box painted inside it is
 * scaled with it, so a geometry sample taken mid-entrance measures the animation
 * rather than the instrument. Waiting on this is what makes the numbers below
 * properties of the lens instead of properties of when the test happened to look.
 * The lens's own outer box is never animated, which is why the placement
 * assertions can be made at any moment.
 */
async function loupeFrameScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-selection-loupe-frame]');
    if (!frame) return 0;
    const transform = getComputedStyle(frame).transform;
    if (!transform || transform === 'none') return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

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
  // The frame is the part of the lens that scales in, and everything painted
  // inside it is scaled with it — so every box measured below is measured once
  // the entrance has settled, or it is a measurement of the animation. Exactly
  // settled: a lens still at 0.995 is half a pixel off across a whole passage.
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  const geometry = await page.evaluate(() => {
    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    const content = document.querySelector('[data-selection-loupe-content]') as HTMLElement;
    const lens = document.querySelector('[data-selection-loupe]')!.getBoundingClientRect();
    const marker = document.querySelector('[data-selection-loupe-marker]')!.getBoundingClientRect();
    const source = document.querySelector('[data-sat-annotation-region="stimulus"]') as HTMLElement;
    const scale = new DOMMatrixReadOnly(getComputedStyle(content).transform).a;
    const picture = clone.getBoundingClientRect();
    const passage = source.getBoundingClientRect();
    return {
      scale,
      // The centre of the lens: what the PICTURE is pointed at (a character
      // boundary the engine resolved) and where the column tick is painted. Read
      // from the lens's own box rather than from anything the component believes.
      centre: { x: lens.left + lens.width / 2, y: lens.top + lens.height / 2 },
      marker: { x: marker.left + marker.width / 2, y: marker.top + marker.height / 2 },
      top: lens.top,
      size: lens.width,
      inert: clone.hasAttribute('inert'),
      hidden: clone.getAttribute('aria-hidden'),
      // The picture's own painted box, and the passage's — the two facts that say
      // whether the lens holds a second layout of the prose or a blank white disc.
      picture: { left: picture.left, right: picture.right, width: picture.width, height: picture.height },
      passage: { width: passage.width, height: passage.height },
      // The type the picture is laid out in, against the document's: same font,
      // same size, same leading — which is what decides where the lines break.
      fontSize: [getComputedStyle(clone).fontSize, getComputedStyle(source).fontSize],
      fontFamily: [getComputedStyle(clone).fontFamily, getComputedStyle(source).fontFamily],
      lineHeight: [getComputedStyle(clone).lineHeight, getComputedStyle(source).lineHeight],
      // And the question the student asks of it: is there TEXT in the lens?
      textInLens: (() => {
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (rect.right > lens.left && rect.left < lens.right && rect.bottom > lens.top && rect.top < lens.bottom) return true;
          }
        }
        return false;
      })(),
    };
  });
  expect(geometry.scale).toBeCloseTo(1.5, 2);
  expect(geometry.inert).toBe(true);
  expect(geometry.hidden).toBe('true');
  expect(geometry.centre.x).toBeCloseTo(gesture.finger.x, 0);
  // A lens centred half a lens-height above the finger puts its top edge one
  // lens-height above the finger — never under it, which is the whole point of a
  // loupe. It holds for whatever lens this device was sized to.
  expect(geometry.top).toBeCloseTo(gesture.finger.y - geometry.size, 0);
  expect(geometry.size).toBeGreaterThanOrEqual(120);
  expect(geometry.size).toBeLessThanOrEqual(150);

  // THE ACCEPTANCE TEST, as arithmetic. Two claims, and the lens is only a camera
  // if BOTH hold — which is the lesson this file exists to keep.
  //
  // First, the picture IS the document's own layout, magnified: the passage's own
  // width and height, scaled — not a copy left to wrap itself into the lens's
  // narrow column. A picture laid out at the lens's width is the right size on
  // screen and a blank disc in practice, because its text then sits hundreds of
  // pixels from where the finger is.
  expect(geometry.picture.width).toBeCloseTo(geometry.passage.width * geometry.scale, 0);
  expect(geometry.picture.height).toBeCloseTo(geometry.passage.height * geometry.scale, 0);
  // Second, the two coordinates the lens keeps apart. The INSTRUMENT is over the
  // hand — the lens's box is centred on the finger, asserted above and below.
  // The PICTURE is over the caret: the document coordinate at the centre of the
  // lens is the character boundary the engine resolved, which is where the tick
  // sits. That is usually a fraction of a glyph away from the finger and can be a
  // whole word away on a claim that expanded to a word — asserting the finger's
  // own coordinate instead is what this file used to do, and it is the old
  // contract: a loupe that reports where the hand is rather than what was chosen.
  const caret = await resolvedCaretAt(page, region, gesture.finger);
  const pointed = await lensMisalignment(page, caret);
  expect(pointed!.x, 'the picture is centred on the resolved caret, not on the finger').toBeLessThan(1.5);
  expect(pointed!.y, 'the picture is centred on the resolved caret, not on the finger').toBeLessThan(1.5);
  // And the tick itself is drawn on that column, so the mark the student reads and
  // the mapping the engine applies are the same claim.
  const offBy = (mapped: number, centre: number) => Math.abs(mapped - centre);
  expect(offBy(geometry.marker.x, geometry.centre.x)).toBeLessThan(0.5);
  expect(offBy(geometry.marker.y, geometry.centre.y)).toBeLessThan(0.5);
  // The clone is mounted in a layer at `document.body`, so it inherits the layer's
  // type unless the document's is written onto it — a second layout in the wrong
  // font breaks its lines somewhere else and shows the finger the wrong words.
  expect(geometry.fontSize[0]).toBe(geometry.fontSize[1]);
  expect(geometry.fontFamily[0]).toBe(geometry.fontFamily[1]);
  expect(geometry.lineHeight[0]).toBe(geometry.lineHeight[1]);
  // And there is prose inside the lens, not merely around it: the assertion that
  // fails loudly for a magnifier showing the student nothing at all.
  expect(geometry.textInLens).toBe(true);

  await gesture.finish();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
  // Nothing the picture added survives the gesture either.
  expect(await surfaceCounts(page)).toEqual({ ...before, insidePicture: 0 });
});

/**
 * The camera follows the DOCUMENT, not a cached selection.
 *
 * This is the student's own acceptance test in arithmetic: a finger is over the
 * word it is choosing — covering it, which is the entire reason a loupe exists —
 * and the lens has to say which character boundary is being chosen, line by line,
 * as the finger moves. Two claims, and a magnifier that shows one cached word
 * fails both: the picture travels by the finger's own distance, magnified, and
 * the finger's new document coordinate is at the centre of the lens.
 *
 * Driven through a HANDLE drag rather than a press-and-drag, because that is the
 * gesture the requirement names — the lens exists while an endpoint is being
 * moved, and it has to be pointed at the finger rather than at whatever the last
 * frame resolved.
 */
test('the magnifier follows the finger while a handle is dragged, line by line', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  // Long enough prose that the end handle can be taken down onto another line,
  // and short enough a viewport that the finger is over real words.
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto(`${fixture}?product=sat&long=1`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'Several researchers', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  const handle = await grabHandle(page, browserName, 'end');
  // Along the line first, then down onto the next one: the same gesture a student
  // makes to grow a highlight, and the one where a lens showing the wrong line is
  // indistinguishable from a lens that is working.
  const along = { x: handle.origin.x + 26, y: handle.origin.y };
  await handle.move(along.x, along.y);
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);
  const firstCaret = await resolvedCaretAt(page, region, handle.at());
  const first = await lensMisalignment(page, firstCaret);

  const down = { x: along.x + 4, y: along.y + 34 };
  await handle.move(down.x, down.y);
  await nextFrames(page);
  const secondCaret = await resolvedCaretAt(page, region, handle.at());
  const second = await lensMisalignment(page, secondCaret);

  // It is still a camera at each place the finger went, not only at the first —
  // aimed at whatever caret that position resolved to.
  expect(first!.x).toBeLessThan(1.5);
  expect(first!.y).toBeLessThan(1.5);
  expect(second!.x).toBeLessThan(1.5);
  expect(second!.y).toBeLessThan(1.5);
  // And it travelled: the picture slides inside the lens by the CARET's own
  // distance, magnified — the finger's distance less the snap, because the caret
  // only moves when it crosses a boundary. Measured against the caret at both
  // ends rather than against the finger, since a picture that moved by exactly
  // the finger's distance would be the old contract rather than this one. A lens
  // holding one cached word fails both, because its content does not move at all.
  expect(second!.translate!.x - first!.translate!.x).toBeCloseTo(-(secondCaret.x - firstCaret.x) * second!.scale, 0);
  expect(second!.translate!.y - first!.translate!.y).toBeCloseTo(-(secondCaret.y - firstCaret.y) * second!.scale, 0);

  // The same claim in the form a student would state it, after the finger has been
  // carried across a line and then across another: the character under the tick is
  // the one the caret resolved to there. The geometry above can agree with itself
  // while the picture is placed for a box the passage no longer has — both sides
  // of the sum move together — so the mapping is also asserted the way the
  // requirement asks for it, by character rather than by pixel.
  // `canopy density` is the furthest line inside this passage's scroll band that
  // still sits clear of the engine's 72px edge band (the container is only ~218px
  // tall here), so the drag crosses lines without the engine auto-scrolling the
  // passage underneath it — the case measured separately, not this one.
  const across = (await coordinates(region, 'canopy density')).from;
  await handle.move(across.x, across.y);
  await nextFrames(page);
  // Asserted BEFORE the tolerance below, because this is the claim and the
  // tolerance is only a way of measuring it: a lens painted from a stale origin, or
  // one showing the word it was opened on, can pass every pixel check in this file
  // — its own travel still matches the finger's, and a constant offset cancels out
  // of a difference — while telling the student they are on a different character
  // than they are. The index under the tick is the answer to the question they are
  // actually asking.
  const fingerInk = await characterUnder(region, handle.at());
  expect(fingerInk, 'the finger has to be over real ink for this to mean anything').not.toBeNull();
  const acrossCaret = await resolvedCaretAt(page, region, handle.at());
  const underTick = await characterUnder(page.locator('[data-selection-loupe-source]'), await lensCentre(page));
  expect(underTick, 'the tick sits on the caret the engine resolved').not.toBeNull();
  // The tick is drawn ON a boundary, so the rects of the characters either side
  // of it both contain the centre point — which is why this asserts the caret's
  // OWN characters rather than the character under the finger.
  expect(underTick!.index).toBe(characterAtCaret(acrossCaret));
  const third = await lensMisalignment(page, acrossCaret);
  expect(third!.x, 'the picture is pointed at the caret, line by line').toBeLessThan(1.5);
  expect(third!.y, 'the picture is pointed at the caret, line by line').toBeLessThan(1.5);

  await handle.release();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

/**
 * The page can move the passage without telling the lens anything.
 *
 * A banner appearing above the passage, a panel collapsing, a font swap changing
 * an earlier paragraph's height: the passage TRANSLATES, its own size does not
 * change and nothing scrolls. Every signal the lens could register is silent to
 * that — the `ResizeObserver` on the source watches its size, which is exactly
 * what did not change — so a box remembered from the commit that cloned the
 * picture leaves the lens pointed at where the passage used to be. Measured on
 * that defect: a 56px shift showed up as 84.5px of error (56 x the magnification),
 * it stayed there for as long as the gesture lasted, and only a scroll event
 * cleared it. On screen it is the words under the tick a line away from the words
 * under the finger, which is the one thing a magnifier must never do.
 *
 * The gesture is the one the audit that found this went through: claim a phrase,
 * take the finger onto another line, then drag the end handle — with the page
 * moving under it in the middle, and with the live-layout read asserted in the
 * form a student would recognise: the character under the finger is the character
 * under the tick.
 */
test('the lens re-reads a passage that moved under it without a scroll or a resize', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'Several researchers', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  // Finger onto a later line, still down, with the lens pointing at it.
  const handle = await grabHandle(page, browserName, 'end');
  const laterLine = (await coordinates(region, 'built environment')).from;
  await handle.move(laterLine.x, laterLine.y);
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);
  const beforeCaret = await resolvedCaretAt(page, region, handle.at());
  const before = await lensMisalignment(page, beforeCaret);
  expect(before!.y).toBeLessThan(1.5);

  // The page moves the passage: an ancestor's box changes, so the passage is not
  // scrolled, not resized, and — as the run that found this shows — not announced.
  await page.evaluate(() => {
    const pane = document.querySelector('[data-sat-passage-scroll]')!.parentElement as HTMLElement;
    pane.style.paddingTop = '56px';
  });

  // The finger moves on — which is the commit that paints — and the box the picture
  // is translated by has to be the one the passage has on that frame.
  const after = (await coordinates(region, 'built environment')).from;
  await handle.move(after.x, after.y);
  await nextFrames(page);
  const shiftedCaret = await resolvedCaretAt(page, region, handle.at());
  const shifted = await lensMisalignment(page, shiftedCaret);
  expect(shifted!.x).toBeLessThan(1.5);
  expect(shifted!.y).toBeLessThan(1.5);

  // And in the form a student would recognise: the character under the tick is the
  // one the caret resolved to on this frame — which a lens translated for the old
  // box fails by a whole line, not by a pixel.
  const centre = await lensCentre(page);
  const fingerInk = await characterUnder(region, handle.at());
  const underTick = await characterUnder(page.locator('[data-selection-loupe-source]'), centre);
  expect(fingerInk).not.toBeNull();
  expect(underTick, 'the tick sits on the caret the engine resolved').not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(shiftedCaret));

  await handle.release();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
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
 * The raw paint both endpoint reads below derive from, parsed ONCE: each
 * handle's `translate3d` (rounded to integer pixels, as the overlay wrote it)
 * and the painted first line's origin — in one round-trip, so a frame cannot
 * land between the transforms and the line they are judged against.
 */
async function handlePaint(page: Page) {
  return page.evaluate(() => {
    const read = (edge: string) => {
      const transform = document.querySelector(`[data-student-selection-handle="${edge}"]`)?.style.transform ?? '';
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
      return match ? { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) } : null;
    };
    const line = document.querySelector('[data-student-selection-line]')?.getBoundingClientRect();
    return {
      start: read('start'),
      end: read('end'),
      origin: line ? { x: Math.round(line.left), y: Math.round(line.top) } : null,
    };
  });
}

/**
 * Where the two handles are, in the coordinates the overlay positions them at.
 *
 * Read from the inline transform rather than a rect, because a rect is exactly
 * what the reachability case below must not trust on its own.
 */
async function endpoints(page: Page) {
  const { start, end } = await handlePaint(page);
  return { start, end };
}

/**
 * A handle taken hold of, with the finger still down.
 *
 * Returned as a gesture rather than performed whole, because two different tests
 * need it: one that only wants the endpoint moved, and the magnifier's, which has
 * to read the page WHILE the finger is down — a lens that exists only mid-gesture
 * cannot be tested through a gesture that has already ended.
 */
async function grabHandle(page: Page, browserName: string, edge: 'start' | 'end') {
  const box = await page.locator(`[data-student-selection-handle="${edge}"]`).boundingBox();
  const origin = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 2 }] });
    let at = origin;
    return {
      origin,
      move: async (x: number, y: number) => {
        at = { x, y };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 2 }] });
      },
      release: async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      },
      at: () => at,
    };
  }
  const handle = page.locator(`[data-student-selection-handle="${edge}"]`);
  await handle.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: origin.x, clientY: origin.y, buttons: 1 });
  let at = origin;
  return {
    origin,
    move: async (x: number, y: number) => {
      at = { x, y };
      await handle.dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: x, clientY: y, buttons: 1 });
    },
    release: async () => {
      await handle.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: at.x, clientY: at.y });
    },
    at: () => at,
  };
}

/** Press one handle, drag it sideways, release — the gesture a student makes. */
async function dragHandle(page: Page, browserName: string, edge: 'start' | 'end', dx: number) {
  const drag = await grabHandle(page, browserName, edge);
  await drag.move(drag.origin.x + dx, drag.origin.y);
  await drag.release();
}

/** Let the page run frames, so the render a gesture's move asked for has happened. */
async function nextFrames(page: Page, frames = 2) {
  await page.evaluate(async (count) => {
    for (let frame = 0; frame < count; frame += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, frames);
}

/**
 * A finger the test keeps down and moves by hand: press, claim, NUDGE.
 *
 * `drag` ends (or hands off) its gesture, and `grabHandle` starts on a handle —
 * neither can hold the page still and then move3.5 pixels, which is the only way
 * to observe the difference this suite now hinges on: a lens BOX that follows
 * every pixel against CONTENT that must not move until the caret does. Real
 * touch events on Chromium (where these tests run), synthetic ones elsewhere —
 * the same bargain `drag` makes.
 */
async function press(page: Page, surface: Locator, browserName: string) {
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    let at = { x: 0, y: 0 };
    return {
      down: async (point: { x: number; y: number }) => {
        at = point;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      },
      move: async (point: { x: number; y: number }) => {
        at = point;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
      },
      at: () => at,
      release: async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      },
    };
  }
  let at = { x: 0, y: 0 };
  return {
    down: async (point: { x: number; y: number }) => {
      at = point;
      await surface.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: point.x, clientY: point.y });
    },
    move: async (point: { x: number; y: number }) => {
      at = point;
      await surface.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: point.x, clientY: point.y });
    },
    at: () => at,
    release: async () => {
      await surface.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: at.x, clientY: at.y });
    },
  };
}

/**
 * The roomiest glyph inside `phrase`: where a3.5px nudge is provably still
 * inside ONE character. Measured from the page's own layout rather than assumed
 * from a font size — the claim "same glyph" has to come from the renderer.
 */
async function widestGlyph(surface: Locator, phrase: string) {
  return surface.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      let best: DOMRect | null = null;
      for (let index = start; index < start + text.length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (!best || rect.width > best.width)) best = rect;
      }
      if (best) return { x: best.left, y: best.top, width: best.width, height: best.height };
      throw new Error(`No measurable glyph in: ${text}`);
    }
    throw new Error(`Missing text: ${text}`);
  }, phrase);
}

/**
 * Frame-by-frame truth about the two precision indicators: their deviation from
 * identity (0 = not moving), whether both elements exist, and the snap revision
 * that says the EVENT which would start them had arrived.
 *
 * Sampled on `requestAnimationFrame` because "the bounce never happened" and
 * "the sampler never looked" are the same observation otherwise — the same rule
 * the entrance test states for reduced motion, applied to the tick.
 */
async function sampleTick(page: Page, frames = 24) {
  return page.evaluate(async (count) => {
    const marker = document.querySelector('[data-selection-loupe-marker]');
    const gripTick = document.querySelector('.selection-v2-grip-tick');
    const deviation = (element: Element | null): number => {
      if (!element) return -1;
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === 'none') return 0;
      const matrix = new DOMMatrixReadOnly(transform);
      return Math.max(Math.abs(matrix.a - 1), Math.abs(matrix.d - 1));
    };
    const markerDeviations: number[] = [];
    const gripDeviations: number[] = [];
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      markerDeviations.push(deviation(marker));
      gripDeviations.push(deviation(gripTick));
    }
    return {
      markerPresent: marker !== null,
      gripPresent: gripTick !== null,
      revision: marker?.getAttribute('data-snap-revision') ?? null,
      gripWitness: document.querySelector('[data-student-selection-handle] .selection-v2-grip')?.getAttribute('data-selection-motion') ?? null,
      markerDeviations,
      gripDeviations,
    };
  }, frames);
}

/** The picture's own offset INSIDE the lens, as the string it is written with. */
async function loupeContentTransform(page: Page) {
  return page.evaluate(() =>
    (document.querySelector('[data-selection-loupe-content]') as HTMLElement | null)?.style.transform ?? null,
  );
}

/**
 * The one claim the lens makes, in the coordinate system it makes it in: where
 * the finger's own document coordinate lands, against the centre of the lens.
 *
 * Derived from what is on screen — the passage's box, the picture's box and the
 * magnification between them — rather than from anything the component believes,
 * because the failure this guards is one where every box agrees and the mapping
 * is still wrong.
 *
 * `translate` is the picture's own offset INSIDE the lens, which is the number
 * that says which words are under it: the lens's box travels with the finger, so
 * the picture's box on screen moves by only `1 - magnification` for every pixel
 * of finger travel, and a test that watched that would be watching the lens move.
 * `null` when the lens is not on screen at all.
 */

/**
 * The same mapping over any surface: `sourceSelector` defaults to the SAT
 * stimulus, and the IELTS passage passes its own highlightable surface — the
 * picture is measured against whatever the lens was cloned from.
 */
async function lensMisalignment(page: Page, finger: { x: number; y: number }, sourceSelector = '[data-sat-annotation-region="stimulus"]') {
  return page.evaluate(({ point, sourceSelector }) => {
    const content = document.querySelector('[data-selection-loupe-content]') as HTMLElement | null;
    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement | null;
    const lens = document.querySelector('[data-selection-loupe]');
    const source = document.querySelector(sourceSelector);
    if (!content || !clone || !lens || !source) return null;
    const lensRect = lens.getBoundingClientRect();
    const picture = clone.getBoundingClientRect();
    const passage = source.getBoundingClientRect();
    const scale = new DOMMatrixReadOnly(getComputedStyle(content).transform).a;
    const translate = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(content.style.transform);
    return {
      scale,
      x: Math.abs(picture.left + (point.x - passage.left) * scale - (lensRect.left + lensRect.width / 2)),
      y: Math.abs(picture.top + (point.y - passage.top) * scale - (lensRect.top + lensRect.height / 2)),
      translate: translate ? { x: Number(translate[1]), y: Number(translate[2]) } : null,
    };
  }, { point: finger, sourceSelector });
}

/**
 * The centre of the lens on screen: where the tick points, and the point the
 * picture is asked to resolve. Read from the lens's box rather than from anything
 * the component says about itself.
 */
async function lensCentre(page: Page) {
  return page.evaluate(() => {
    const lens = document.querySelector('[data-selection-loupe]')!.getBoundingClientRect();
    return { x: lens.left + lens.width / 2, y: lens.top + lens.height / 2 };
  });
}

/**
 * The caret the platform resolves for a finger — the position the engine adopts,
 * and therefore what the lens CONTENT is pointed at.
 *
 * Built entirely from the browser's own answers rather than from anything the
 * component reports: `caretPositionFromPoint` (with `caretRangeFromPoint` for
 * engines that only ship the legacy API) and the real rect of the glyph beside
 * the boundary. That is the same definition the engine uses, arrived at from
 * outside it — the only kind of oracle a claim about "does the lens point at the
 * caret" can be, and the reason this can be asserted without a component
 * diagnostic to agree with.
 *
 * This is what replaced the old check that "the finger's own document coordinate
 * lands at the centre of the lens". The finger is ANALOG and the caret is
 * DISCRETE: the lens's BOX follows the finger (asserted separately, and still
 * true), while its picture follows a CHARACTER BOUNDARY — typically a fraction of
 * a glyph from the finger, and further on a long-press claim that expanded to a
 * whole word. `caretPositionFromPoint` may answer with an ELEMENT rather than a
 * text node — a point between two glyphs, or in the whitespace at a line's end
 * (where a finger travelling between lines spends its time), hit-tests to
 * "somewhere inside this box, at child index n", which is not yet a character.
 * The engine resolves that by measurement — nearest rendered run, then the side
 * of the nearest character's midpoint — and so does this helper, by the same
 * rule. Sharing the engine's DEFINITION of where the caret is leaves the claim
 * under test fully independent: that the lens points THERE instead of at the
 * hand is still measured from nothing but DOM geometry.
 *
 * Viewport coordinates for `lensMisalignment`, plus the character index in
 * `root` counted exactly the way `characterUnder` counts it.
 */
async function resolvedCaretAt(page: Page, root: Locator, finger: { x: number; y: number }) {
  return root.evaluate((scope, point) => {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    // The engine's resolution chain, spelled out independently: precise answers
    // first, an element answer held as a HINT about where to measure, geometry
    // last — in that order, because a renderer can answer precisely through one
    // spelling and coarsely through the other, and geometry must not shadow a
    // precise answer.
    let hit: Text | null = null;
    let hint: Element | null = null;
    let hitOffset = 0;

    const inScope = (candidate: Node | null): boolean => !!candidate && scope.contains(candidate);
    const elementFor = (candidate: Node | null): Element | null => {
      if (!inScope(candidate)) return null;
      return candidate!.nodeType === Node.ELEMENT_NODE ? (candidate as Element) : candidate!.parentElement;
    };
    const asPrecise = (candidate: Node | null, at: number): Text | null => {
      if (candidate?.nodeType !== Node.TEXT_NODE) return null;
      const run = candidate as Text;
      if (run.data.length === 0 || !inScope(run)) return null;
      hitOffset = Math.max(0, Math.min(run.data.length, Math.trunc(at)));
      return run;
    };

    if (typeof doc.caretPositionFromPoint === 'function') {
      const position = doc.caretPositionFromPoint(point.x, point.y);
      hit = asPrecise(position?.offsetNode ?? null, position?.offset ?? 0);
      hint = elementFor(position?.offsetNode ?? null);
    }
    if (!hit && typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(point.x, point.y);
      if (range) {
        hit = asPrecise(range.startContainer, range.startOffset);
        hint = hint ?? elementFor(range.startContainer);
      }
    }

    const distanceToRect = (rect: DOMRect, x: number, y: number) =>
      Math.hypot(
        Math.max(rect.left - x, 0, x - (rect.left + rect.width)),
        Math.max(rect.top - y, 0, y - (rect.top + rect.height)),
      );
    const rectsOf = (read: () => DOMRectList | null): DOMRect[] => {
      try {
        const list = read();
        if (!list) return [];
        return Array.from(list).filter((rect) => rect.width > 0 && rect.height > 0);
      } catch {
        return [];
      }
    };

    let node: Text;
    let offset: number;
    if (hit) {
      node = hit;
      offset = hitOffset;
    } else {
      // The element the renderer named — or the element under the point, or the
      // passage itself — is where the measurement looks.
      const atPoint = document.elementFromPoint(point.x, point.y);
      const within = hint ?? (inScope(atPoint) ? atPoint : null) ?? scope;
      const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
      let candidate: Text | null;
      let nearest: Text | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      while ((candidate = walker.nextNode() as Text | null)) {
        if (candidate.data.length === 0) continue;
        const rects = rectsOf(() => {
          const range = document.createRange();
          range.selectNodeContents(candidate!);
          return range.getClientRects();
        });
        for (const rect of rects) {
          const distance = distanceToRect(rect, point.x, point.y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = candidate;
          }
        }
      }
      if (!nearest) throw new Error('the platform answered with an element and no text measures inside it');
      node = nearest;

      // Then the offset on whichever side of the nearest character's midpoint
      // the point fell: the same rule a text cursor obeys, arrived at from
      // geometry. A character whose rect CONTAINS the point wins immediately —
      // nothing later can be closer — which is what makes a gap resolve onto
      // one of the lines that bounds it rather than into the gap itself.
      offset = 0;
      let offsetDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < node.data.length; index += 1) {
        const rects = rectsOf(() => {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          return range.getClientRects();
        });
        let contained = false;
        for (const rect of rects) {
          const distance = distanceToRect(rect, point.x, point.y);
          const side = point.x < rect.left + rect.width / 2 ? index : index + 1;
          if (distance === 0) {
            offset = side;
            contained = true;
            break;
          }
          if (distance < offsetDistance) {
            offsetDistance = distance;
            offset = side;
          }
        }
        if (contained) break;
      }
    }

    const text = node.data;
    offset = Math.max(0, Math.min(offset, text.length));
    const glyph = (from: number, to: number) => {
      if (from < 0 || to > text.length) return null;
      const range = document.createRange();
      range.setStart(node!, from);
      range.setEnd(node!, to);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const previous = glyph(offset - 1, offset);
    const next = glyph(offset, offset + 1);
    if (!previous && !next) throw new Error('no measurable glyph beside the resolved caret');

    const rtl = getComputedStyle((node as Text).parentElement ?? scope).direction === 'rtl';
    const sameLine = !!(previous && next && Math.abs(previous.top - next.top) < 1);
    // One rule, three cases — the same one the engine applies. On a line the
    // boundary is the edge the two glyphs share; at a WRAP it belongs to the line
    // the following glyph is on (never a gap the finger may be travelling in); at
    // either end of the node it is the outer edge of the one glyph there is.
    let x: number;
    let box: DOMRect;
    if (previous && next && !sameLine) {
      x = rtl ? next.right : next.left;
      box = next;
    } else if (previous && next) {
      x = rtl ? previous.left : previous.right;
      box = next;
    } else if (previous) {
      x = rtl ? previous.left : previous.right;
      box = previous;
    } else {
      x = rtl ? next!.right : next!.left;
      box = next!;
    }

    // The character index, counted the way `characterUnder` counts it: every
    // character of every text node under this root, in document order.
    let counted: number | null = null;
    let index = 0;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let scanned: Text | null;
    while ((scanned = walker.nextNode() as Text | null)) {
      if (scanned === node) {
        counted = index + offset;
        break;
      }
      index += scanned.data.length;
    }
    if (counted === null) throw new Error('the resolved caret is outside the passage under test');

    return {
      x,
      y: box.top + box.height / 2,
      index: counted,
      onFollowingLine: previous !== null && next !== null && !sameLine,
      charBefore: offset > 0 ? text[offset - 1] : null,
      charAfter: offset < text.length ? text[offset] : null,
    };
  }, finger);
}

/**
 * The character `characterUnder` should report for a tick drawn ON `caret`.
 *
 * The tick lands exactly on a boundary, so the rect of the character before it
 * and of the character after it both CONTAIN the point — which is why the old
 * "same character as under the finger" comparison had to be replaced rather than
 * tightened: it was measuring the wrong coordinate, not measuring it imprecisely.
 * Whichever neighbour has ink is the answer a student reads; whitespace on both
 * sides falls back to the first hit, as `characterUnder` itself does.
 */
function characterAtCaret(caret: Awaited<ReturnType<typeof resolvedCaretAt>>): number {
  if (caret.onFollowingLine) return caret.index;
  // The caret's own character is the nearest one that HAS a glyph at the
  // boundary — the same rule `characterUnder` lives by (`rect.width > 0`). A
  // combining mark (Thai vowel signs, Arabic diacritics) renders as a zero-width
  // unit: naming it here would promise a character the oracle, correctly, can
  // never return, and every such caret would mismatch by exactly one index. The
  // boundary's visible character in that case is the following base.
  const hasOwnGlyph = (value: string | null | undefined) =>
    Boolean(value && value.trim() !== '' && !/^\p{M}/u.test(value));
  if (hasOwnGlyph(caret.charBefore)) return caret.index - 1;
  if (caret.charAfter && caret.charAfter.trim() !== '') return caret.index;
  return caret.index - 1;
}

/**
 * The character under a viewport point, as an index into that subtree's own text.
 *
 * The picture holds the same characters in the same order as the passage, so two
 * indices are the strongest form of the claim the lens makes: not that some
 * geometry is plausible, but that both trees resolve the point to the SAME
 * character — which is precisely the question a student asks of a magnifier with
 * a finger over the word they are choosing. Compared as an index rather than as a
 * character because the passage's text starts again at every block, and two
 * different `e`s are not the same character.
 *
 * A single character's own rect is not always disjoint from its neighbours — a
 * space's box may take in the glyph after it, in one engine and not the other — so
 * the answer is the first INK under the point: a whitespace match is kept only
 * when nothing else covers it. A space is a boundary rather than a character, and
 * which side of one a point falls on is not what the lens is being asked.
 */
async function characterUnder(root: Locator, point: { x: number; y: number }) {
  return root.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const hits: { index: number; char: string }[] = [];
    let index = 0;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0
          && target.x >= rect.left && target.x <= rect.right
          && target.y >= rect.top && target.y <= rect.bottom) {
          hits.push({ index, char: node.data[offset] });
        }
        index += 1;
      }
    }
    return hits.find((hit) => hit.char.trim() !== '') ?? hits[0] ?? null;
  }, point);
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

/**
 * How many presses actually reached the gesture — one intent, counted once.
 *
 * The diagnostics WIPE this buffer on every pointerdown whose target is inside
 * the root, so a count is "since the last in-root press": comparing across a
 * press that lands outside the root (on the highlight paint, the toolbar) is
 * exact, and after an in-root press the answer is what THAT press produced.
 */
async function pointerDownIntents(page: Page) {
  return page.evaluate(() => {
    const surface = window.__studentTouchSelectionDebug?.snapshot().surfaces
      .find((item) => item['surface'] === 'SAT stimulus');
    const events = (surface?.['events'] ?? []) as { stage: string; pointerDownSeen?: boolean }[];
    // The hook's own record, not the diagnostics module's raw capture listener
    // (which sees every pointerdown whether or not the overlay consumed it).
    return events.filter((event) => event.stage === 'pointerdown' && event.pointerDownSeen === true).length;
  });
}

/**
 * Each endpoint's position RELATIVE to the painted line it belongs to.
 *
 * Read relative rather than as raw viewport transforms: the shell settles its
 * toolbar around a selection and the passage can shift under it, and a uniform
 * shift of the whole paint is NOT an endpoint moving. What an inert press must
 * leave identical is each endpoint's place ON the selection.
 */
async function endpointGeometry(page: Page) {
  const { start, end, origin } = await handlePaint(page);
  if (!origin || !start || !end) return { start, end, origin };
  return {
    start: { x: start.x - origin.x, y: start.y - origin.y },
    end: { x: end.x - origin.x, y: end.y - origin.y },
  };
}

/**
 * Where a resting selection may be moved FROM — on a selection short enough
 * that the two endpoint controls physically overlap (docs/selectionui.md).
 *
 * The rule: a resting selection can only be RESIZED by acquiring one of its
 * two visible endpoint handles. A press inside the selected text must never
 * move either endpoint, never open the magnifier, and never begin a new
 * selection — one physical pointerdown holds exactly one intent. The fixture
 * word is deliberately two glyphs wide (`of`), so both 44×44 accessible boxes
 * cover the highlighted midpoint: before the fix, a press there landed on the
 * end handle's invisible target and dragged it.
 */
test("a short selection's middle belongs to neither handle, and one press holds one intent", async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'Owned selection is only used on coarse pointers.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'of', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);
  // The shell raises its toolbar after the release and settles it over the next
  // frames; sample geometry only once that is done, so a settle mid-gesture
  // cannot be mistaken for an endpoint moving.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await nextFrames(page, 4);

  // The premise, measured rather than assumed: the two accessible boxes really
  // do overlap over the text — without this the case below would silently be
  // testing a wide selection instead.
  const overlap = await page.evaluate(() => {
    const start = document.querySelector('[data-student-selection-handle="start"]')!.getBoundingClientRect();
    const end = document.querySelector('[data-student-selection-handle="end"]')!.getBoundingClientRect();
    return start.right > end.left;
  });
  expect(overlap, 'the two 44px targets must overlap for this case to mean anything').toBe(true);

  const before = await endpointGeometry(page);
  expect(before.start).not.toBeNull();
  expect(before.end).not.toBeNull();
  const line = await page.locator('[data-student-selection-line]').first().boundingBox();
  const midpoint = { x: line!.x + line!.width / 2, y: line!.y + line!.height / 2 };
  // The midpoint must be the selection itself: if the shell's toolbar covered
  // it, the press below would be a command on the menu rather than a press on
  // the selected text, and the case would prove nothing.
  const onToolbar = await page.evaluate((point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return !!hit?.closest('[data-sat-selection-toolbar], [data-selection-action-menu]');
  }, midpoint);
  expect(onToolbar, 'the midpoint must resolve to the selection, not the toolbar').toBe(false);

  const intentsBefore = await pointerDownIntents(page);

  // 1. The middle: pressed, travelled 40px each way, released. Nothing may
  // move, no loupe may open, and the press may not also begin a new gesture.
  const finger = await press(page, region, browserName);
  await finger.down(midpoint);
  await finger.move({ x: midpoint.x - 40, y: midpoint.y });
  await finger.move({ x: midpoint.x + 40, y: midpoint.y });
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
  await finger.release();
  await nextFrames(page);

  expect(await endpointGeometry(page), 'the pressed midpoint moved neither endpoint').toEqual(before);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
  expect(await pointerDownIntents(page), 'that press ended at the midpoint; it did not also begin a new gesture').toBe(intentsBefore);

  // 2. The visible end handle DOES acquire — and once acquired, the finger may
  // travel through the very midpoint that refused it.
  const handle = await grabHandle(page, browserName, 'end');
  await handle.move(midpoint.x, midpoint.y);
  await nextFrames(page);
  const dragged = await endpointGeometry(page);
  expect(dragged!.start, 'only the acquired endpoint moved').toEqual(before.start);
  expect(dragged!.end!.x, 'the acquired endpoint followed the finger').toBeLessThan(before.end!.x);
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();

  // 3. Release over the prose (the finger is AT the midpoint), not over the
  // handle it started on: the loupe is gone within the next frame.
  await handle.release();
  await nextFrames(page, 1);
  expect(await page.locator('[data-selection-loupe]').count(), 'gone within one frame of the release').toBe(0);
});

/**
 * A mark inside the prose is OUTSIDE the selection (docs/selectionui.md): the
 * tap is dismissed AND consumed in the overlay's capture pass, so the same
 * pointerdown can never begin the next selection — while the mark's own
 * command, its editor, still opens. One press, one intent per layer: the
 * selection layer reads dismissal, the product reads its click.
 */

test("a tap on a mark while a selection rests dismisses the selection and still opens that mark's editor", async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'Owned selection is only used on coarse pointers.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  // 1. A mark exists: select the opening words and press a colour.
  await drag(page, region, 'Several researchers', browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await page.locator('[data-sat-selection-toolbar="true"]').getByRole('button', { name: /yellow/i }).click();
  const mark = region.locator('[data-sat-annotation-control="true"]');
  await expect(mark).toHaveText('Several researchers');

  // 2. The first span still rests after the colour was applied — its handles
  // stay painted. The doc's grammar, in order: a press on the prose OUTSIDE it
  // dismisses that selection and ends there (a prose drag would be consumed
  // the same way, which is why this is a plain tap),
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);
  const prose = await coordinates(region, 'built environment');
  const finger = await press(page, region, browserName);
  await finger.down(prose.from);
  await finger.release();
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(0);

  // — and only the NEXT gesture creates the selection that will rest here.
  await drag(page, region, 'built environment', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  // The mark must really be what is under the finger — if the resting
  // selection's toolbar covered it, the tap would be a command on the menu and
  // would prove nothing about a mark.
  const box = (await mark.boundingBox())!;
  const coveredBy = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const markElement = document.querySelector('[data-sat-annotation-control="true"]')!;
    return markElement === hit || markElement.contains(hit)
      ? null
      : `${hit?.tagName ?? 'nothing'}${hit?.closest('[data-sat-selection-toolbar="true"]') ? ' (toolbar)' : ''}`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(coveredBy, 'the mark must be hittable, not behind the toolbar').toBeNull();

  // A real tap: real touch events, so the browser decides whether a click
  // follows the pointerdown the overlay is about to consume.
  await mark.tap();

  // The doc's half: dismissed in capture AND the pointerdown consumed — the
  // gesture's own handler never saw this press, so no hidden new selection
  // began under it (docs/selectionui.md, outside → dismiss + consume).
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(0);
  await expect(page.locator('[data-selection-loupe]')).toHaveCount(0);
  // The diagnostics wipe their buffer on every press INSIDE the root (this tap
  // included), so what remains is exactly what the tap itself produced: no
  // flagged `pointerdown` record means the gesture's own handler never ran.
  expect(await pointerDownIntents(page), 'the consumed press reached no gesture').toBe(0);

  // The product's half: the mark's own command survives the consumed press —
  // its editor opens, exactly as it does with no selection on screen.
  await expect(mark).toHaveAttribute('data-sat-annotation-active', 'true');
  await expect(page.locator('[data-sat-annotation-edit-controls="true"]')).toBeVisible();
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

/*
 * THE THREE PROOFS A JSDOM SUITE CANNOT MAKE: a real renderer, real glyphs,
 * real frames. Each pins one claim docs/selectionui.md makes about what the
 * student perceives — sub-glyph travel is analog in the box and discrete in the
 * content; the snap fires and the bounce obeys the platform's preference; and
 * the caret geometry is MEASURED, including for scripts and directions a mock
 * cannot shape.
 */

test('a 3.5px nudge inside one glyph moves the lens box and leaves the loupe content byte-identical', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  // The spec's case at real scale: 3–5px of finger travel that stays inside ONE
  // glyph, with both sample points on the same side of that glyph's midpoint —
  // which is where a caret position changes. The glyph is chosen from the
  // layout, and wide enough that "inside it" is a measurement, not a hope.
  const glyph = await widestGlyph(region, 'extreme heat');
  expect(glyph.width, 'the chosen glyph must hold a 3.5px nudge past its midpoint').toBeGreaterThanOrEqual(9);
  const claim = (await coordinates(region, 'extreme heat')).from;
  const p1 = { x: glyph.x + glyph.width / 2 + 0.5, y: glyph.y + glyph.height / 2 };
  expect(p1.x - claim.x, 'the claim move must exceed the 8px tolerance to own the gesture').toBeGreaterThan(8);
  const p2 = { x: p1.x + 3.5, y: p1.y };

  const finger = await press(page, region, browserName);
  await finger.down(claim);
  await finger.move(p1);
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  const before = await page.evaluate(() => ({
    content: (document.querySelector('[data-selection-loupe-content]') as HTMLElement).style.transform,
    box: document.querySelector('[data-selection-loupe]')!.getBoundingClientRect().left,
    revision: document.querySelector('[data-selection-loupe-marker]')?.getAttribute('data-snap-revision') ?? null,
  }));
  const caretBefore = await resolvedCaretAt(page, region, p1);

  await finger.move(p2);
  await nextFrames(page);
  const after = await page.evaluate(() => ({
    content: (document.querySelector('[data-selection-loupe-content]') as HTMLElement).style.transform,
    box: document.querySelector('[data-selection-loupe]')!.getBoundingClientRect().left,
    revision: document.querySelector('[data-selection-loupe-marker]')?.getAttribute('data-snap-revision') ?? null,
  }));
  const caretAfter = await resolvedCaretAt(page, region, p2);

  // The premise, from the independent oracle: one glyph, one boundary — the
  // resolved caret is the SAME position before and after the nudge.
  expect(caretAfter.index, 'both points must resolve to the same caret for "inside one glyph" to mean anything').toBe(caretBefore.index);

  // The CONTENT is discrete: byte-identical transform, no sub-pixel creep, and
  // no snap event that would have said a new character was reached.
  expect(after.content, 'loupe content must not move while the caret does not').toBe(before.content);
  expect(after.revision).toBe(before.revision);

  // The BOX is analog: it travelled the finger's own 3.5px.
  expect(after.box - before.box, 'the lens box follows the finger, pixel for pixel').toBeCloseTo(3.5, 1);

  await finger.release();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

test('a caret crossing is a measurable tick under the default preference — the sampler can see it', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'extreme heat', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  // The contrast half of the reduced-motion proof: without a sampler that CAN
  // see the bounce, "the bounce never appeared" would also describe a sampler
  // that never looked. Grab, cross, and watch from the very next frame.
  const handle = await grabHandle(page, browserName, 'end');
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await nextFrames(page);
  const revision0 = await page.locator('[data-selection-loupe-marker]').getAttribute('data-snap-revision');

  await handle.move(handle.origin.x + 55, handle.origin.y);
  const seen = await sampleTick(page);

  expect(seen.markerPresent, 'the lens is open, so its marker is the tick\'s stage').toBe(true);
  expect(seen.gripPresent, 'the dragged handle carries the other precision indicator').toBe(true);
  expect(Number(seen.revision), 'the crossing must have arrived as an event').toBeGreaterThan(Number(revision0));
  // Both indicators displaced and sprang back — the tick exists in a real
  // browser, at a magnitude no slow frame could mistake for stillness.
  expect(Math.max(...seen.markerDeviations), 'the marker bounced under the default preference').toBeGreaterThan(0.001);
  expect(Math.max(...seen.gripDeviations), 'the grip bounced under the default preference').toBeGreaterThan(0.001);

  await handle.release();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

test('reduced motion keeps the snap — event fired, content jumped — while the bounce never starts', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  // Before the document loads, the way the entrance test does it: motion reads
  // the preference once per document, so a student who has it set at the OS
  // level arrives to a document that already knows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${fixture}?product=sat`);
  await page.getByRole('button', { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, 'extreme heat', browserName, isMobile);
  await expect(page.locator('[data-student-selection-handle]')).toHaveCount(2);

  const handle = await grabHandle(page, browserName, 'end');
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await nextFrames(page);
  const revision0 = await page.locator('[data-selection-loupe-marker]').getAttribute('data-snap-revision');
  const contentBefore = await loupeContentTransform(page);

  // ONE crossing, sampled from the frame it happens on — the pairing the spec
  // names, observed rather than inferred: the event must arrive (revision
  // advances, the picture jumps to the new boundary) and neither precision
  // indicator may leave identity on any sampled frame.
  await handle.move(handle.origin.x + 55, handle.origin.y);
  const seen = await sampleTick(page);
  const contentAfter = await loupeContentTransform(page);

  expect(seen.markerPresent).toBe(true);
  expect(seen.gripPresent).toBe(true);
  expect(Number(seen.revision), 'reduced motion must not swallow the snap: the caret change still happened').toBeGreaterThan(Number(revision0));
  expect(contentAfter, 'the lens content still jumped to the new boundary — that is information, not decoration').not.toBe(contentBefore);
  expect(seen.gripWitness, 'the platform preference reached the grip, as the entrance test proves for the frame').toBe('reduced');
  // The bounce, and only the bounce: identity on every frame of both indicators,
  // which the companion test above proves this sampler would catch if it ran.
  expect(Math.max(...seen.markerDeviations), 'the marker never started its bounce').toBeLessThanOrEqual(0.001);
  expect(Math.max(...seen.gripDeviations), 'the grip never started its bounce').toBeLessThanOrEqual(0.001);

  await handle.release();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

test('RTL: the caret the lens points at comes from real glyph edges in a right-to-left run', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  // Literals duplicated from e2e/fixtures/touch-selection/main.tsx, which owns
  // these paragraphs: a fixture cannot add passages to the SAT debug route (that
  // is product code), and the IELTS path renders any passage text through the
  // same surface, engine and lens.
  // Fixture paragraphs are placed FIRST (see fixtures/touch-selection/main.tsx):
  // the loupe clone drops container-scoped paragraph spacing, so any preceding
  // paragraph shifts the picture by 8px. Paragraph one has none — source and
  // clone agree exactly here, and every assertion below stays as strict as it
  // is for Latin text.
  const phrase = 'هذا نص عربي بسيط عن الطقس والمدينة والحدائق والشوارع';
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const surface = page.locator(passage);
  // CENTRED, not merely visible: these paragraphs are the pane's last, so
  // `scrollIntoViewIfNeeded` parks them at the bottom — inside the engine's 72px
  // edge band, where a held finger keeps auto-scrolling the passage and nothing
  // can rest long enough to be measured. Centering keeps the gesture clear of
  // both bands, the same rule the handle-drag test states for its positions.
  await page.locator('p').filter({ hasText: phrase }).evaluate((element) => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  // A fixture cannot put `dir` on a product-rendered <p>, so the RUN is
  // right-to-left: the paragraph and the lens's picture (mounted at the document
  // root, inheriting the same direction) flip together, and every computed
  // `direction` — the engine's edge rule and the oracle's — reads `rtl`.
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });

  const gesture = await drag(page, surface, phrase, browserName, isMobile, { hold: true });
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  // The claim, measured from actual DOM geometry: in RTL the boundary is the
  // SHARED edge the glyphs have — the preceding glyph's LEFT — and the lens's
  // picture sits on it to within the same 1.5px every other case uses.
  const caret = await resolvedCaretAt(page, surface, gesture.finger);
  const pointed = await lensMisalignment(page, caret, passage);
  expect(pointed!.x, 'the picture is centred on the resolved caret of the RTL run').toBeLessThan(1.5);
  expect(pointed!.y, 'the picture is centred on the resolved caret of the RTL run').toBeLessThan(1.5);
  const underTick = await characterUnder(page.locator('[data-selection-loupe-source]'), await lensCentre(page));
  expect(underTick, 'the tick sits on the caret the engine resolved').not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(caret));

  await gesture.finish();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});

test('Thai: the caret the lens points at comes from real shaped clusters, not code units', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile, 'The magnifier only exists on the owned touch selection.');
  // Literals duplicated from e2e/fixtures/touch-selection/main.tsx — see the RTL
  // test above for why the fixture owns these paragraphs.
  const phrase = 'ภาษาไทย คนในประเทศไทย พูดภาษาไทย ทุกวัน';
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const surface = page.locator(passage);
  // Centred for the same reason as the RTL test: clear of the auto-scroll band.
  await page.locator('p').filter({ hasText: phrase }).evaluate((element) => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
  });

  const gesture = await drag(page, surface, phrase, browserName, isMobile, { hold: true });
  await expect(page.locator('[data-selection-loupe]')).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  // A Thai cluster's rendered width has nothing to do with how many code units
  // it is made of — the one case `fontSize * characterIndex` cannot survive.
  // Both sides are the browser's own: the engine resolves the position with a
  // `Range`, the oracle measures the same position with `Range`s, and the lens
  // must sit on that boundary to within the shared tolerance.
  const caret = await resolvedCaretAt(page, surface, gesture.finger);
  const pointed = await lensMisalignment(page, caret, passage);
  expect(pointed!.x, 'the picture is centred on the resolved caret of the Thai run').toBeLessThan(1.5);
  expect(pointed!.y, 'the picture is centred on the resolved caret of the Thai run').toBeLessThan(1.5);
  const underTick = await characterUnder(page.locator('[data-selection-loupe-source]'), await lensCentre(page));
  expect(underTick, 'the tick sits on the caret the engine resolved').not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(caret));

  await gesture.finish();
  await expect(page.locator('[data-selection-loupe]')).toBeHidden();
});
