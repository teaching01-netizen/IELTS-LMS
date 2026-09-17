import { expect, test, type Page } from '@playwright/test';

/**
 * Annotation surface placement: the invariants, in a real browser.
 *
 * The unit suites prove the rules (float only with comfortable room, keep the
 * side you chose, dock when the visible region cannot hold a toolbar) against
 * geometry the test supplies. They cannot prove the thing a student actually
 * experiences, because jsdom has no layout: whether the surface lands where the
 * student can reach it, whether the caret points at the words, and whether a
 * toolbar appears at all on the device they are holding.
 *
 * So this file asserts geometry, per device profile, from the live DOM:
 *
 *   1. the surface is INSIDE the visual viewport (never clipped, never under
 *      the software keyboard's edge);
 *   2. it does not cover the selection it belongs to;
 *   3. its caret points at the line it belongs to — the first selected line when
 *      it floats above, the last when it floats below;
 *   4. it keeps a usable width;
 *   5. a viewport that cannot hold a toolbar docks instead, and the dock is
 *      inside the visible region too;
 *   6. it appears promptly, but not the instant the gesture ends;
 *   7. the LANE follows the pointer type: the native selection menu owns the
 *      space above the selection on glass, so the toolbar takes the side below
 *      it, while a mouse — which has no such menu — keeps the side above.
 *
 * Phrase choices are deliberate. A selection near the top of a passage has no
 * conflict-free lane on glass (iOS flips its menu down into the only room, and
 * the lane above it is too short for a toolbar), so the cases that assert a
 * floating toolbar select mid-passage text, while the dock case deliberately
 * uses a viewport too short for any lane to hold the controls.
 */

const SURFACE_SELECTOR = '[data-sat-selection-toolbar="true"], [data-sat-touch-dock="true"]';

/** The profiles a student actually sits an exam on. */
const PROFILES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 768 },
] as const;

/** Comfortably inside the spec's 280–340px band. */
const SURFACE_MIN_WIDTH = 280;
const SURFACE_MAX_WIDTH = 340;

async function openHarness(page: Page): Promise<void> {
  await page.goto('/__dev/sat-accessibility');
  await expect(page.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 15_000 });
}

/**
 * Mid-passage text. On a phone the sentence occupies three rendered lines, which
 * puts the selection far enough down the visible region for the native menu to
 * have room above it — the arrangement the lane policy is about: the menu takes
 * the top lane, ours is the one below.
 */
const PHRASE = 'canopy density';

/**
 * The app's own selection gesture: a real range plus the pointerup that
 * completes it. Identical to the accessibility suite's helper on purpose — the
 * flow under test is the one a student performs, not a shortcut into it.
 */
async function selectStimulusText(page: Page, requested: string): Promise<void> {
  await page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.nodeValue ?? '').includes(value)) node = walker.nextNode();
    if (!node) throw new Error(`Could not find stimulus text: ${value}`);
    const textNode = node as Text;
    const start = textNode.data.indexOf(value);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + value.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textNode.parentElement?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, requested);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface PlacementGeometry {
  mode: 'floating' | 'docked';
  surface: Box;
  /** The surface's positioning container — what "room above" is measured from. */
  bounds: Box | null;
  caret: { center: number } | null;
  firstLine: Box | null;
  lastLine: Box | null;
  visible: { left: number; top: number; right: number; bottom: number };
}

/** Everything the invariants need, read once from the live page. */
async function readPlacement(page: Page): Promise<PlacementGeometry> {
  return page.evaluate((selector) => {
    const box = (rect: DOMRect) => ({
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
    });
    const surface = document.querySelector(selector);
    if (!surface) throw new Error('the selection surface is not in the document');
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const lines = range
      ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      : [];
    const caret = document.querySelector('[data-sat-annotation-caret]');
    const viewport = window.visualViewport;
    const container = document.querySelector('[data-sat-annotation-bounds]');
    return {
      mode: surface.getAttribute('data-sat-touch-dock') === 'true' ? 'docked' : 'floating',
      surface: box(surface.getBoundingClientRect()),
      bounds: container ? box(container.getBoundingClientRect()) : null,
      caret: caret ? { center: (() => { const rect = caret.getBoundingClientRect(); return rect.left + rect.width / 2; })() } : null,
      firstLine: lines.length > 0 ? box(lines[0]) : null,
      lastLine: lines.length > 0 ? box(lines[lines.length - 1]) : null,
      visible: viewport
        ? { left: viewport.offsetLeft, top: viewport.offsetTop, right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height }
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
    };
  }, SURFACE_SELECTOR);
}

/**
 * The invariants every placement must hold, whatever the device. Deliberately
 * one function so a new profile cannot quietly opt out of one of them.
 */
function expectContained(geometry: PlacementGeometry): void {
  const { surface, visible } = geometry;
  // A pixel of tolerance: sub-pixel layout rounds differently across engines.
  expect(surface.top, 'surface starts above the visible region').toBeGreaterThanOrEqual(visible.top - 1);
  expect(surface.bottom, 'surface ends below the visible region').toBeLessThanOrEqual(visible.bottom + 1);
  expect(surface.left, 'surface starts left of the visible region').toBeGreaterThanOrEqual(visible.left - 1);
  expect(surface.right, 'surface ends right of the visible region').toBeLessThanOrEqual(visible.right + 1);
}

function expectDoesNotCoverSelection(geometry: PlacementGeometry): void {
  const { surface, firstLine, lastLine } = geometry;
  if (!firstLine || !lastLine) return;
  const above = surface.bottom <= firstLine.top + 1;
  const below = surface.top >= lastLine.bottom - 1;
  expect(above || below, 'surface overlaps the text it belongs to').toBe(true);
}

test.describe('annotation surface placement', () => {
  for (const profile of PROFILES) {
    test(`${profile.name}: the surface stays visible, clear of the selection, with its caret on the anchored line`, async ({ page, isMobile }) => {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await openHarness(page);
      await selectStimulusText(page, PHRASE);
      await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();
      // A toolbar in a viewport with room for one — on glass as well as with a
      // mouse. The dock is the fallback, not the touch default.
      await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();

      const geometry = await readPlacement(page);
      expect(geometry.mode).toBe('floating');
      expectContained(geometry);
      expectDoesNotCoverSelection(geometry);

      // The lane, which is the reason this suite runs on both pointer types. The
      // browser paints the native selection menu above the selection and over
      // anything we render there, so on glass the tools take the side below it —
      // always, however much room the lane above happens to be offering. A mouse
      // has no menu and therefore nothing reserved: it follows the geometry
      // exactly as it always has, which on these profiles means flipping below
      // too, because the room above the selection is smaller than the toolbar.
      const selectionTop = geometry.firstLine?.top ?? 0;
      const selectionBottom = geometry.lastLine?.bottom ?? 0;
      // Room above is measured the way the engine measures it: from the container's
      // own top edge, minus its screen-edge margin (11px of hairline, which is the
      // `--sat-annotation-edge` budget). A toolbar needs its own height plus the
      // 12px gap and the mouse's 12px comfort buffer.
      const roomAbove = selectionTop - (geometry.bounds?.top ?? geometry.visible.top) - 12;
      if (isMobile) {
        expect(geometry.surface.top, 'a touch surface must stay out of the native menu\u2019s lane')
          .toBeGreaterThanOrEqual(selectionBottom - 1);
      } else if (roomAbove >= geometry.surface.height + 24) {
        expect(geometry.surface.bottom, 'a mouse surface takes the lane above when it fits there')
          .toBeLessThanOrEqual(selectionTop + 1);
      } else {
        expect(geometry.surface.top, 'a mouse surface flips below when above is too small')
          .toBeGreaterThanOrEqual(selectionBottom - 1);
      }

      // Usable width, and never wider than the accessible band.
      expect(geometry.surface.width).toBeGreaterThanOrEqual(SURFACE_MIN_WIDTH);
      expect(geometry.surface.width).toBeLessThanOrEqual(SURFACE_MAX_WIDTH);

      // The caret belongs to the anchored line: the first line when the surface
      // floats above it, the last when it floats below.
      expect(geometry.caret, 'a floating surface carries a caret').not.toBeNull();
      const above = geometry.firstLine !== null && geometry.surface.bottom <= geometry.firstLine.top + 1;
      const line = above ? geometry.firstLine : geometry.lastLine;
      expect(line, 'the selection has measurable lines').not.toBeNull();
      if (!line || !geometry.caret) return;
      // Inside the anchored line, allowing only for the inward shift a
      // screen-edge clamp applies.
      expect(geometry.caret.center).toBeGreaterThanOrEqual(line.left - 16);
      expect(geometry.caret.center).toBeLessThanOrEqual(line.right + 16);
      // When the surface is not clamped by an edge, the caret sits on the line's
      // centre rather than merely inside it.
      const unclamped = geometry.surface.left > geometry.visible.left + 1
        && geometry.surface.right < geometry.visible.right - 1;
      if (unclamped) {
        expect(Math.abs(geometry.caret.center - (line.left + line.right) / 2)).toBeLessThanOrEqual(2);
      }
    });
  }

  test('docks inside the visible region when the viewport cannot hold a toolbar', async ({ page, isMobile }) => {
    // Phone: a short viewport is what a software keyboard leaves behind. Desktop:
    // a window too short for a toolbar is the same problem with a mouse. The
    // selection sits at the top of the passage, where no lane can hold the
    // controls — not the menu's, and not the one it leaves free either.
    await page.setViewportSize(isMobile ? { width: 390, height: 330 } : { width: 1280, height: 300 });
    await openHarness(page);
    await selectStimulusText(page, 'Several');

    const dock = page.locator('[data-sat-touch-dock="true"]');
    await expect(dock).toBeVisible();

    const geometry = await readPlacement(page);
    expect(geometry.mode).toBe('docked');
    expectContained(geometry);
    // A sheet has no "that line" to point at.
    expect(geometry.caret).toBeNull();
    // Full-bleed within the region it is docked to, and anchored to its bottom.
    expect(geometry.surface.width).toBeGreaterThan(SURFACE_MIN_WIDTH);
    expect(geometry.surface.bottom).toBeGreaterThan(geometry.surface.top);
  });

  test('surfaces promptly, but not the instant the gesture ends', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 768 });
    await openHarness(page);

    const elapsed = await page.locator('[data-sat-annotation-region="stimulus"]').evaluate(async (root, value) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node && !(node.nodeValue ?? '').includes(value)) node = walker.nextNode();
      if (!node) throw new Error(`Could not find stimulus text: ${value}`);
      const textNode = node as Text;
      const range = document.createRange();
      range.setStart(textNode, textNode.data.indexOf(value));
      range.setEnd(textNode, textNode.data.indexOf(value) + value.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const started = performance.now();
      textNode.parentElement?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      while (performance.now() - started < 3_000) {
        const surface = document.querySelector('[data-sat-selection-toolbar="true"], [data-sat-touch-dock="true"]');
        if (surface && getComputedStyle(surface).visibility === 'visible') return performance.now() - started;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return -1;
    }, 'Several');

    // The selection settles first (it is never shown under a handle the student
    // is still moving), and it is nowhere near a perceptible wait.
    expect(elapsed).toBeGreaterThan(50);
    expect(elapsed).toBeLessThan(400);
  });

  test('holds still through a rotation, then comes back placed in the new viewport', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openHarness(page);
    await selectStimulusText(page, PHRASE);
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();

    // The device turns. For a few frames the browser reports the old and the new
    // axes together, so the surface must not be placed from transitional
    // geometry: it goes quiet, and only then is it placed again.
    const duringRotation = await page.evaluate(async (selector) => {
      const surface = document.querySelector(selector);
      if (!surface) throw new Error('the selection surface is not in the document');
      window.dispatchEvent(new Event('orientationchange'));
      // One frame: React commits the hold in a microtask, so by the next frame it
      // has landed — and it lasts far longer than a frame.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        visibility: getComputedStyle(surface).visibility,
        claimsInteraction: document.querySelector(selector) !== null,
      };
    }, SURFACE_SELECTOR);
    expect(duringRotation.visibility).toBe('hidden');
    // A mounted-but-hidden surface claims no interaction: the Highlights
    // shortcut focuses the first control it finds, and it must not find one
    // nobody can see.
    expect(duringRotation.claimsInteraction).toBe(false);

    // The viewport settles in the new orientation, and the surface comes back —
    // placed for the geometry it now has, not for the one it had.
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();
    const geometry = await readPlacement(page);
    expect(geometry.mode).toBe('floating');
    expectContained(geometry);
    expectDoesNotCoverSelection(geometry);
    expect(geometry.caret, 'the surface comes back with its caret, not as a bare box').not.toBeNull();
  });

  test('a software keyboard shrinking what is visible keeps the sheet reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page);
    // A selection small enough to float on its own, so the keyboard's arrival is
    // the only thing that can move it.
    await selectStimulusText(page, PHRASE);
    await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();

    // A note field takes focus and the keyboard rises: the LAYOUT viewport keeps
    // its height while the visible region loses most of it. A surface placed
    // against the layout viewport would be pinned under the keyboard — present,
    // unreachable — which is why placement is measured against what the student
    // can actually see.
    const shrinkVisibleRegion = (height: number) => page.evaluate((visible) => {
      const viewport = window.visualViewport;
      if (!viewport) return false;
      // Stand in for the browser's own metrics: the same API, carrying the
      // numbers a keyboard produces, with the real placement pipeline
      // downstream of it.
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: {
          offsetLeft: viewport.offsetLeft,
          offsetTop: viewport.offsetTop,
          width: viewport.width,
          height: visible,
          addEventListener: viewport.addEventListener.bind(viewport),
          removeEventListener: viewport.removeEventListener.bind(viewport),
        },
      });
      window.dispatchEvent(new Event('resize'));
      return true;
    }, height);

    expect(
      await shrinkVisibleRegion(300),
      'the harness runs in a browser with a visual viewport',
    ).toBe(true);

    // The same selection that floated a moment ago is now a sheet: the visible
    // region cannot hold a toolbar any more.
    await expect(page.locator('[data-sat-touch-dock="true"]')).toBeVisible();
    const geometry = await readPlacement(page);
    expect(geometry.mode).toBe('docked');
    expectContained(geometry);
    // Above the keyboard's edge, not merely inside the page — the difference
    // between a control the student can reach and one hidden under glass.
    expect(geometry.surface.bottom).toBeLessThanOrEqual(301);
    expect(geometry.caret).toBeNull();

    // And when the keyboard leaves even less than that, the selection itself is
    // off the visible region: a contextual surface with no visible source hides
    // rather than pinning itself to a screen its words are no longer on.
    expect(await shrinkVisibleRegion(240)).toBe(true);
    await expect(page.locator(SURFACE_SELECTOR)).toBeHidden();
  });
});
