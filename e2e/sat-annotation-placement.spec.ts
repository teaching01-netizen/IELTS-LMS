import { expect, test, type Page } from "@playwright/test";

/**
 * Annotation surface placement: the invariants, in a real browser.
 *
 * The unit suites prove the rules (float only with comfortable room, keep the
 * side you chose, pin inside the visible region when there is no room beside the
 * words) against geometry the test supplies. They cannot prove the thing a
 * student actually experiences, because jsdom has no layout: whether the surface
 * lands where the student can reach it, whether the caret points at the words,
 * and whether a toolbar appears at all on the device they are holding.
 *
 * So this file asserts geometry, per device profile, from the live DOM:
 *
 *   1. the surface is INSIDE the visual viewport (never clipped, never under
 *      the software keyboard's edge);
 *   2. it does not cover the selection it belongs to;
 *   3. its caret points at the line it belongs to — the first selected line when
 *      it floats above, the last when it floats below;
 *   4. it keeps a usable width;
 *   5. a viewport that cannot hold a toolbar still gets a toolbar, pinned inside
 *      the visible region — there is no second presentation to retreat to;
 *   6. it appears promptly, but not the instant the gesture ends;
 *   7. coarse-pointer comfort and native selection UI are separate: a real
 *      student exam owns touch selection and reserves no browser-menu lane.
 *
 * Phrase choices are deliberate. Mid-passage text leaves room for the normal
 * placement rule to choose a side; the cramped case deliberately uses a
 * viewport too short for any lane to hold the controls.
 */

/** The one annotation surface there is. */
const SURFACE_SELECTOR = '[data-sat-selection-toolbar="true"]';

/** The profiles a student actually sits an exam on. */
const PROFILES = [
  { name: "phone", width: 390, height: 844 },
  { name: "iPad portrait", width: 820, height: 1180 },
  { name: "iPad landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1280, height: 768 },
] as const;

/** Comfortably inside the spec's 280–340px band. */
const SURFACE_MIN_WIDTH = 280;
const SURFACE_MAX_WIDTH = 340;

async function openHarness(page: Page, query = "?ownedTouchSelection=1"): Promise<void> {
  await page.goto(`/__dev/sat-accessibility${query}`);
  await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 15_000 });
}

/**
 * Mid-passage text. On a phone the sentence occupies three rendered lines, so
 * the placement rule has room to choose either side using its comfort budget.
 */
const PHRASE = "canopy density";

/**
 * Arm annotation the way the student does: press the labeled top-bar control.
 *
 * This is the first half of every flow in this file. Selection only raises the
 * surface in an armed exam, so without this the placement engine would have
 * nothing to place — which is the point of the mode, not a quirk of the harness.
 */
async function armHighlights(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^Highlights & Notes/ });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

/**
 * The app's own selection gesture: a real range plus the pointerup that
 * completes it. Identical to the accessibility suite's helper on purpose — the
 * flow under test is the one a student performs, not a shortcut into it — with
 * the one press that arms the tool in front of it.
 */
async function selectStimulusText(page: Page, requested: string): Promise<void> {
  await armHighlights(page);
  await selectTextInRegion(page, '[data-sat-annotation-region="stimulus"]', requested);
}

async function selectTextInRegion(page: Page, selector: string, requested: string): Promise<void> {
  await page.locator(selector).evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.nodeValue ?? "").includes(value)) node = walker.nextNode();
    if (!node) throw new Error(`Could not find stimulus text: ${value}`);
    const textNode = node as Text;
    const start = textNode.data.indexOf(value);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + value.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textNode.parentElement?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
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
  surface: Box;
  /** The surface's positioning container — what "room above" is measured from. */
  bounds: Box | null;
  caret: { center: number } | null;
  firstLine: Box | null;
  lastLine: Box | null;
  visible: { left: number; top: number; right: number; bottom: number };
  /** What the browser's own selection holds — the app retires it on capture. */
  nativeSelection: string;
}

/**
 * Everything the invariants need, read once from the live page.
 *
 * The lines of the selection are measured from the ANCHORED PHRASE, not from
 * `window.getSelection()`. The app captures the anchor and then retires the
 * browser's own selection — deliberately, because leaving it live is what lets
 * the platform paint its Copy / Look Up / Share bar over the passage (see
 * `SatAnnotatedContent`) — so a living selection is not something this suite can
 * measure any more. The phrase is the span the app anchored, so its rendered
 * lines ARE the anchored lines; `nativeSelection` reports the retirement so the
 * contract is asserted rather than assumed.
 */
async function readPlacement(page: Page, phrase: string): Promise<PlacementGeometry> {
  return page.evaluate(
    ({ selector, text }) => {
      const box = (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      const surface = document.querySelector(selector);
      if (!surface) throw new Error("the selection surface is not in the document");
      const region = document.querySelector("[data-sat-annotation-region]");
      const anchored = (() => {
        if (!region) return null;
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        let node: Node | null = walker.nextNode();
        while (node && !(node.nodeValue ?? "").includes(text)) node = walker.nextNode();
        if (!node) return null;
        const textNode = node as Text;
        const start = textNode.data.indexOf(text);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + text.length);
        return range;
      })();
      const lines = anchored
        ? Array.from(anchored.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
        : [];
      const caret = document.querySelector("[data-sat-annotation-caret]");
      const viewport = window.visualViewport;
      const container = document.querySelector("[data-sat-annotation-bounds]");
      return {
        surface: box(surface.getBoundingClientRect()),
        bounds: container ? box(container.getBoundingClientRect()) : null,
        caret: caret
          ? {
              center: (() => {
                const rect = caret.getBoundingClientRect();
                return rect.left + rect.width / 2;
              })(),
            }
          : null,
        firstLine: lines.length > 0 ? box(lines[0]) : null,
        lastLine: lines.length > 0 ? box(lines[lines.length - 1]) : null,
        visible: viewport
          ? {
              left: viewport.offsetLeft,
              top: viewport.offsetTop,
              right: viewport.offsetLeft + viewport.width,
              bottom: viewport.offsetTop + viewport.height,
            }
          : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
        nativeSelection: window.getSelection()?.toString() ?? "",
      };
    },
    { selector: SURFACE_SELECTOR, text: phrase }
  );
}

/**
 * The invariants every placement must hold, whatever the device. Deliberately
 * one function so a new profile cannot quietly opt out of one of them.
 */
/**
 * Whether the anchored span now sits entirely above the visible region.
 *
 * Measured without the surface, because the surface is gone in the state this is
 * asked about — that is the point of asking. The anchored phrase is the span the
 * app anchored, so its rendered lines are the span the rule is deciding about.
 */
function anchoredSpanIsAboveVisibleRegion(page: Page, phrase: string): Promise<boolean> {
  return page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.nodeValue ?? "").includes(text)) node = walker.nextNode();
    if (!node) return false;
    const textNode = node as Text;
    const start = textNode.data.indexOf(text);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + text.length);
    const line = range.getClientRects()[0];
    if (!line) return false;
    const viewport = window.visualViewport;
    return line.bottom < (viewport ? viewport.offsetTop : 0);
  }, phrase);
}

function expectContained(geometry: PlacementGeometry): void {
  const { surface, visible } = geometry;
  // A pixel of tolerance: sub-pixel layout rounds differently across engines.
  expect(surface.top, "surface starts above the visible region").toBeGreaterThanOrEqual(
    visible.top - 1
  );
  expect(surface.bottom, "surface ends below the visible region").toBeLessThanOrEqual(
    visible.bottom + 1
  );
  expect(surface.left, "surface starts left of the visible region").toBeGreaterThanOrEqual(
    visible.left - 1
  );
  expect(surface.right, "surface ends right of the visible region").toBeLessThanOrEqual(
    visible.right + 1
  );
}

function expectDoesNotCoverSelection(geometry: PlacementGeometry): void {
  const { surface, firstLine, lastLine } = geometry;
  if (!firstLine || !lastLine) return;
  const above = surface.bottom <= firstLine.top + 1;
  const below = surface.top >= lastLine.bottom - 1;
  expect(above || below, "surface overlaps the text it belongs to").toBe(true);
}

test.describe("annotation surface placement", () => {
  for (const profile of PROFILES) {
    test(`${profile.name}: the surface stays visible, clear of the selection, with its caret on the anchored line`, async ({
      page,
      isMobile,
    }) => {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await openHarness(page);
      await selectStimulusText(page, PHRASE);
      await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();

      const geometry = await readPlacement(page, PHRASE);
      // The app captures the anchor and retires the browser's own selection, so
      // no native Copy / Look Up bar can be painted over the passage. This suite
      // therefore measures the anchored phrase, and asserts the retirement.
      expect(geometry.nativeSelection).toBe("");
      expectContained(geometry);
      expectDoesNotCoverSelection(geometry);

      // This harness declares an owned student exam. A coarse pointer keeps its
      // larger comfort budget, but the browser draws no selection UI to reserve
      // a lane. Fine pointers use the tighter comfort budget.
      const selectionTop = geometry.firstLine?.top ?? 0;
      const selectionBottom = geometry.lastLine?.bottom ?? 0;
      // Room above is measured from the container's own top edge and inset by
      // the 12px edge budget. Coarse pointers ask for 24px comfort; fine pointers
      // ask for 12px.
      const roomAbove = selectionTop - (geometry.bounds?.top ?? geometry.visible.top) - 12;
      const comfort = isMobile ? 24 : 12;
      if (roomAbove >= geometry.surface.height + 12 + comfort) {
        expect(
          geometry.surface.bottom,
          "the surface takes the ordinary gap above when it comfortably fits"
        ).toBeLessThanOrEqual(selectionTop + 1);
      } else {
        expect(
          geometry.surface.top,
          "the surface flips below when above is too small"
        ).toBeGreaterThanOrEqual(selectionBottom - 1);
      }

      // Usable width, and never wider than the accessible band.
      expect(geometry.surface.width).toBeGreaterThanOrEqual(SURFACE_MIN_WIDTH);
      expect(geometry.surface.width).toBeLessThanOrEqual(SURFACE_MAX_WIDTH);

      // The caret belongs to the anchored line: the first line when the surface
      // floats above it, the last when it floats below.
      expect(geometry.caret, "a floating surface carries a caret").not.toBeNull();
      const above =
        geometry.firstLine !== null && geometry.surface.bottom <= geometry.firstLine.top + 1;
      const line = above ? geometry.firstLine : geometry.lastLine;
      expect(line, "the selection has measurable lines").not.toBeNull();
      if (!line || !geometry.caret) return;
      // Inside the anchored line, allowing only for the inward shift a
      // screen-edge clamp applies.
      expect(geometry.caret.center).toBeGreaterThanOrEqual(line.left - 16);
      expect(geometry.caret.center).toBeLessThanOrEqual(line.right + 16);
      // When the surface is not clamped by an edge, the caret sits on the line's
      // centre rather than merely inside it.
      const unclamped =
        geometry.surface.left > geometry.visible.left + 1 &&
        geometry.surface.right < geometry.visible.right - 1;
      if (unclamped) {
        expect(Math.abs(geometry.caret.center - (line.left + line.right) / 2)).toBeLessThanOrEqual(
          2
        );
      }
    });
  }

  test("keeps the toolbar aligned to its viewport anchor at 50%", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openHarness(page);
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("button", { name: "Decrease screen zoom" }).click();
    await page.getByRole("button", { name: "Decrease screen zoom" }).click();
    await expect(page.locator("[data-sat-zoom-plane]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "0.5"
    );
    await page.getByRole("button", { name: "Close display settings" }).click();
    await selectStimulusText(page, PHRASE);
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();

    const geometry = await readPlacement(page, PHRASE);
    expectContained(geometry);
    expectDoesNotCoverSelection(geometry);
    expect(geometry.caret, "caret remains attached to the selected text").not.toBeNull();
    const scaling = await page.locator(SURFACE_SELECTOR).evaluate((surface) => {
      const rect = surface.getBoundingClientRect();
      return {
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        logicalWidth: surface.clientWidth,
        logicalHeight: surface.clientHeight,
      };
    });
    expect(Math.abs(scaling.renderedWidth - scaling.logicalWidth * 0.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(scaling.renderedHeight - scaling.logicalHeight * 0.5)).toBeLessThanOrEqual(2);
  });

  test("keeps the toolbar inside a viewport too short for it", async ({ page, isMobile }) => {
    // Phone: a short viewport is what a software keyboard leaves behind. Desktop:
    // a window too short for a toolbar is the same problem with a mouse. The
    // selection sits at the top of the passage, where no ordinary gap holds the
    // controls on either side.
    await page.setViewportSize(
      isMobile ? { width: 390, height: 330 } : { width: 1280, height: 300 }
    );
    await openHarness(page);
    await selectStimulusText(page, "Several");

    // Still a toolbar — there is no sheet to retreat to — and still inside what
    // the student can see: the actions scroll inside it rather than hanging off
    // the bottom edge, under the keyboard.
    const toolbar = page.locator(SURFACE_SELECTOR);
    await expect(toolbar).toBeVisible();

    const geometry = await readPlacement(page, "Several");
    expectContained(geometry);
    expect(geometry.surface.bottom).toBeGreaterThan(geometry.surface.top);
    expect(
      await page.evaluate(() => {
        const body = document.querySelector('[data-sat-annotation-surface-body="true"]');
        return body ? getComputedStyle(body).overflowY : null;
      })
    ).toBe("auto");
  });

  test("surfaces promptly, but not the instant the gesture ends", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 768 });
    await openHarness(page);
    // Armed outside the measured window on purpose: the timing contract is about
    // the gesture, not about the press that made it possible.
    await armHighlights(page);

    const elapsed = await page
      .locator('[data-sat-annotation-region="stimulus"]')
      .evaluate(async (root, value) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null = walker.nextNode();
        while (node && !(node.nodeValue ?? "").includes(value)) node = walker.nextNode();
        if (!node) throw new Error(`Could not find stimulus text: ${value}`);
        const textNode = node as Text;
        const range = document.createRange();
        range.setStart(textNode, textNode.data.indexOf(value));
        range.setEnd(textNode, textNode.data.indexOf(value) + value.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const started = performance.now();
        textNode.parentElement?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        while (performance.now() - started < 3_000) {
          const surface = document.querySelector('[data-sat-selection-toolbar="true"]');
          if (surface && getComputedStyle(surface).visibility === "visible")
            return performance.now() - started;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return -1;
      }, "Several");

    // The selection settles first (it is never shown under a handle the student
    // is still moving), and it is nowhere near a perceptible wait.
    expect(elapsed).toBeGreaterThan(50);
    expect(elapsed).toBeLessThan(400);
  });

  test("holds still through a rotation, then comes back placed in the new viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openHarness(page);
    await selectStimulusText(page, PHRASE);
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();

    // The device turns. For a few frames the browser reports the old and the new
    // axes together, so the surface must not be placed from transitional
    // geometry: it goes quiet, and only then is it placed again.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("orientationchange"));
    });
    const hiddenState = await page.waitForFunction(
      () => {
        const menu = document.querySelector("[data-selection-action-menu]");
        if (!menu || getComputedStyle(menu).visibility !== "hidden") return false;
        return {
          visibility: getComputedStyle(menu).visibility,
          claimsInteraction: document.querySelector('[data-sat-selection-toolbar="true"]') !== null,
        };
      },
      null,
      { polling: "raf", timeout: 1_000 }
    );
    // A mounted-but-hidden surface claims no interaction: the Highlights
    // shortcut focuses the first control it finds, and it must not find one
    // nobody can see.
    expect(await hiddenState.jsonValue()).toEqual({
      visibility: "hidden",
      claimsInteraction: false,
    });

    // The viewport settles in the new orientation, and the surface comes back —
    // placed for the geometry it now has, not for the one it had.
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();
    const geometry = await readPlacement(page, PHRASE);
    expectContained(geometry);
    expectDoesNotCoverSelection(geometry);
    expect(
      geometry.caret,
      "the surface comes back with its caret, not as a bare box"
    ).not.toBeNull();
  });

  test("a software keyboard shrinking what is visible keeps the toolbar reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page);
    // A selection small enough to float on its own, so the keyboard's arrival is
    // the only thing that can move it.
    await selectStimulusText(page, PHRASE);
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();

    // A note field takes focus and the keyboard rises: the LAYOUT viewport keeps
    // its height while the visible region loses most of it. A surface placed
    // against the layout viewport would be pinned under the keyboard — present,
    // unreachable — which is why placement is measured against what the student
    // can actually see.
    const shrinkVisibleRegion = (height: number) =>
      page.evaluate((visible) => {
        const viewport = window.visualViewport;
        if (!viewport) return false;
        // Stand in for the browser's own metrics: the same API, carrying the
        // numbers a keyboard produces, with the real placement pipeline
        // downstream of it.
        Object.defineProperty(window, "visualViewport", {
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
        window.dispatchEvent(new Event("resize"));
        return true;
      }, height);

    expect(
      await shrinkVisibleRegion(300),
      "the harness runs in a browser with a visual viewport"
    ).toBe(true);

    // The same selection that floated a moment ago now has nowhere to sit beside
    // the words: the toolbar is pinned inside what is left of the viewport.
    //
    // CONTAINMENT IS A CLAIM ABOUT WHERE IT RESTS, and this move is animated on
    // purpose (a viewport change is a big move, and the design settles those).
    // Mid-flight the box's bottom is below the new edge — `top` is still
    // travelling while the height bound has already snapped — measured at frame
    // 2 as bottom 395 against a 300px region, reaching its place at frame 9.
    // Asserting the transient would forbid the settle; asserting the settle is
    // the promise the student experiences.
    await expect(page.locator(SURFACE_SELECTOR)).toBeVisible();
    await expect
      .poll(async () => (await readPlacement(page, PHRASE)).surface.bottom, {
        message: "the toolbar settles inside what the student can see",
        timeout: 3_000,
      })
      .toBeLessThanOrEqual(301);
    const geometry = await readPlacement(page, PHRASE);
    expectContained(geometry);
    // Above the keyboard's edge, not merely inside the page — the difference
    // between a control the student can reach and one hidden under glass.
    expect(geometry.surface.bottom).toBeLessThanOrEqual(301); // And when the keyboard leaves even less than that, the selection itself is
    // off the visible region: a contextual surface with no visible source hides
    // rather than pinning itself to a screen its words are no longer on.
    //
    // This is the rule a student meets by scrolling the passage away from the
    // words they chose: `placeSelectionMenu` returns the hidden mode when the
    // anchored box stops intersecting the visible region. (The passage here is
    // shorter than a real one, so the visible region is what moves; the owned-touch
    // suite drives the same rule from a real scroll, with the selection's handles
    // travelling off the screen with its words.)
    const toolbar = page.locator(SURFACE_SELECTOR);
    expect(await shrinkVisibleRegion(240)).toBe(true);
    await expect(toolbar).toBeHidden();
    // Hidden, NOT unmounted: the surface is still in the document, which is why
    // the tool the student armed, the anchored span and everything the exam holds
    // about the selection survive the trip. A surface torn down here would have to
    // re-anchor from scratch, and a lost anchor is how a student ends up
    // annotating a word they did not choose.
    expect(
      await page
        .locator("[data-selection-action-menu]")
        .evaluate((element) => getComputedStyle(element).visibility),
      "a hidden surface stays mounted"
    ).toBe("hidden");

    // The room comes back, and so do the tools — placed again for the geometry
    // they now have, on the SAME words.
    expect(await shrinkVisibleRegion(844)).toBe(true);
    await expect(toolbar).toBeVisible();
    const restored = await readPlacement(page, PHRASE);
    expectContained(restored);
    expect(
      restored.caret,
      "the surface comes back with its caret, not as a bare box"
    ).not.toBeNull();
    await toolbar.getByRole("button", { name: "Highlight Yellow" }).click();
    await expect(page.locator('[data-sat-highlight="true"]')).toHaveText(PHRASE);
  });

  /**
   * The other way a selection leaves the screen, and the way a student actually
   * meets it: they scroll the passage away from the words they chose.
   *
   * Same decision as the case above — this is the same rule reached through the
   * passage's own scroll, with the visible region left alone, so the two cases
   * pin the rule from both ends rather than testing two implementations of it.
   * `placeSelectionMenu` returns the hidden mode when the anchored box stops
   * intersecting the visible region, and the hidden mode is a MOUNTED surface
   * that claims no interaction, not an unmounted one. That is the whole of the
   * checklist line: the tools go quiet while their source is off screen, nothing
   * is thrown away, and they come back on the same words.
   *
   * The opt-in long passage is what a real SAT passage is; the default harness
   * one is a few lines, and a pane that cannot scroll cannot test this.
   */
  test("hides while its anchor is scrolled out of the visible region, and acts on the same span when it returns", async ({
    page,
  }) => {
    // Long enough that the passage is genuinely longer than its pane, and tall
    // enough to leave the tools a comfortable lane above the selection — so the
    // surface the student meets is the ordinary floating one with a caret, not
    // the pinned fallback.
    await page.setViewportSize({ width: 390, height: 620 });
    await openHarness(page, "?long=1&ownedTouchSelection=1");
    const phrase = PHRASE;
    await selectStimulusText(page, phrase);
    const toolbar = page.locator(SURFACE_SELECTOR);
    await expect(toolbar).toBeVisible();

    const scroller = page.locator("[data-sat-passage-scroll]");
    const range = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(range, "the passage must be scrollable for this case to mean anything").toBeGreaterThan(
      0
    );

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    // The premise, measured rather than assumed: the anchored span is off the
    // visible region, entirely above its top edge.
    await expect
      .poll(() => anchoredSpanIsAboveVisibleRegion(page, phrase), {
        message: "the words left the visible region",
      })
      .toBe(true);
    await expect(toolbar).toBeHidden();
    // Hidden, NOT gone: the surface is still in the document, holding the tool the
    // student armed, so nothing has to be rebuilt when the words come back.
    expect(
      await page
        .locator("[data-selection-action-menu]")
        .evaluate((element) => getComputedStyle(element).visibility),
      "a hidden surface stays mounted"
    ).toBe("hidden");

    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(toolbar).toBeVisible();
    const geometry = await readPlacement(page, phrase);
    expectContained(geometry);
    expect(geometry.caret, "the surface returns with its caret, not as a bare box").not.toBeNull();

    // And it is the same span the student chose: the tool still acts on those
    // words, so the anchor survived the trip rather than being re-derived.
    await toolbar.getByRole("button", { name: "Highlight Yellow" }).click();
    await expect(page.locator('[data-sat-highlight="true"]')).toHaveText(phrase);
  });

  test("reopens and removes a saved highlight with a real iPad tap", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "webkit-ipad",
      "real touch tap regression runs in iPad WebKit"
    );
    await page.setViewportSize({ width: 1024, height: 768 });
    await openHarness(page, "?ownedTouchSelection=1");
    await selectStimulusText(page, "Several");
    const selectedActions = page.getByRole("toolbar", { name: "Selected text actions" });
    await selectedActions.getByRole("button", { name: "Highlight Yellow" }).click();
    const edit = page.getByRole("toolbar", { name: "Edit annotation" });
    await edit.getByRole("button", { name: "Close text tools" }).click({ force: true });
    const mark = page.locator('[data-sat-highlight="true"]').filter({ hasText: "Several" });
    await mark.tap();
    await expect(page.getByRole("toolbar", { name: "Edit annotation" })).toBeVisible();
    await page.getByRole("button", { name: "Remove highlight" }).click();
    await expect(page.locator('[data-sat-highlight="true"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-sat-highlight="true"]')).toHaveText("Several");
  });

  test("owns Math prose selections beside inline equations without selecting the equation", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "webkit-ipad",
      "owned-selection contract runs in iPad WebKit"
    );
    await page.setViewportSize({ width: 1024, height: 768 });
    await openHarness(page, "?mode=math&ownedTouchSelection=1");
    await expect(page.getByRole("button", { name: "Calculator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reference" })).toBeVisible();

    const prompt = page.locator('[data-sat-annotation-region="prompt"]');
    await armHighlights(page);
    await selectTextInRegion(page, '[data-sat-annotation-region="prompt"]', "graph");
    await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
    await expect(
      prompt.locator('[data-content-text-node="math-prompt::text-run-0"]')
    ).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await page
      .getByRole("toolbar", { name: "Selected text actions" })
      .getByRole("button", { name: "Close text tools" })
      .click();

    await selectTextInRegion(page, '[data-sat-annotation-region="prompt"]', "minimum");
    await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
    await expect.poll(() => prompt.getAttribute("data-student-selection-owner")).toBe("app");
    await expect.poll(() => prompt.getAttribute("data-student-owned-touch-selection")).toBe("true");
    await expect(
      prompt.locator('[data-content-text-node="math-prompt::text-run-2"]')
    ).toBeVisible();
    expect(
      await prompt.evaluate((root) =>
        getComputedStyle(root).getPropertyValue("-webkit-user-select")
      )
    ).toBe("none");
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    expect(
      await prompt
        .locator('[role="math"]')
        .evaluate((math) => math.closest("[data-content-text-node]"))
    ).toBeNull();

    await page.getByRole("button", { name: "Highlight Yellow" }).click();
    const mark = prompt.locator('[data-sat-highlight="true"]').filter({ hasText: "minimum" });
    await expect(mark).toBeVisible();
    await page
      .getByRole("toolbar", { name: "Edit annotation" })
      .getByRole("button", { name: "Close text tools" })
      .click();
    await mark.tap();
    await expect(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await page.getByRole("button", { name: "Remove highlight" }).click();
    await expect(prompt.locator('[data-sat-highlight="true"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(prompt.locator('[data-sat-highlight="true"]')).toHaveText("minimum");

    await prompt.locator('[role="math"]').evaluate((math) => {
      const walker = document.createTreeWalker(math, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) throw new Error("Equation has no rendered text");
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      text.parentElement?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toHaveCount(0);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await page.goto("/__dev/sat-accessibility?mode=spr&ownedTouchSelection=1");
    const answer = page.getByRole("textbox");
    await expect(answer).toBeEditable();
  });
});
