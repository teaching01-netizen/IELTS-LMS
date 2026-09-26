import { expect, test, type Page, type Locator } from "@playwright/test";

const fixture = "/e2e/fixtures/touch-selection/index.html";
const passage = '.student-reading-passage-pane [data-student-highlightable="true"]';
/**
 * The harness's cluster question (`?clusters=1`) and the ASCII word its stimulus
 * starts with, which is how the cluster cases find their text. See
 * `src/app/router/dev/SatAccessibilityDebugRoute.tsx` for the stimulus itself.
 */
const clustersQuestion = "?product=sat&ownedTouchSelection=1&clusters=1";
const clusterLeadIn = "Several";
const satSurface = "SAT stimulus";
const ieltsSurface = "IELTS reading:passage:passage-1";

/**
 * The fixture's two non-Latin paragraphs, duplicated from the fixture's own
 * literals: a page bundle cannot import a Playwright file. Both are rendered
 * through the same passage path as the rest.
 */
const thaiLead = "ภาษาไทย";
const rtlLead = "هذا";
/**
 * The fixture's paragraph whose words are split by a real inline element, and the
 * paragraph after it.
 *
 * `*researchers*` renders as `<em>researchers</em>`, so the paragraph is three
 * text nodes and a drag out of the emphasized run leaves the node it was claimed
 * in without leaving the paragraph. Duplicated from
 * `e2e/fixtures/touch-selection/main.tsx`, which owns these paragraphs.
 */
const inlineWord = "researchers";
const inlineLeadWord = "Several";
const inlineNextWord = "examined";
const crossWord = "measurements";
const inlineSpoken =
  "Several researchers examined how canopy density changes surface temperature near paved ground.";
const crossSpoken =
  "Their follow-up measurements suggest the relationship holds in cooler climates as well.";
type NativeSelectionAuditEntry = {
  rangeCount: number;
  isCollapsed: boolean;
  anchorInsideRoot: boolean;
  focusInsideRoot: boolean;
};

declare global {
  interface Window {
    __nativeSelectionAudit?: NativeSelectionAuditEntry[];
  }
}
/**
 * What a range's `toString()` says for the run that spans both paragraphs.
 *
 * It starts at the CLAIM's word, not at the paragraph's first word: reaching
 * forward fixes the claim's start and moves the far edge to the word the finger
 * reached. The text nodes of two paragraphs concatenate in a range with nothing
 * between them, which is why `ground.` runs straight into `Their`.
 */
const crossRunText = `${inlineSpoken.slice(inlineSpoken.indexOf(inlineWord))}Their follow-up ${crossWord}`;

/**
 * The engine's selection, mapped onto the CLUSTERS of the stimulus it came from.
 *
 * The offsets are recovered from the range text the engine is painting, and the
 * cluster boundaries come from the platform's own `Intl.Segmenter` — the same
 * authority production snaps to. `midIsBoundary` is the CONTROL: the second code
 * unit of a cluster, which must never be a boundary the engine could stop on;
 * without it the boundary check would also pass on a paragraph whose characters
 * were all one code unit long.
 */
async function clusterSelection(page: Page, surfaceName: string) {
  return page.evaluate(
    ({ name, lead }) => {
      const record = window.__studentTouchSelectionDebug
        ?.snapshot()
        .surfaces.find((item) => item["surface"] === name);
      const selected = typeof record?.["rangeText"] === "string" ? record["rangeText"] : "";
      const paragraph = [...document.querySelectorAll("p")].find((element) =>
        (element.textContent ?? "").startsWith(lead)
      );
      if (!paragraph) throw new Error("cluster paragraph not found");
      // The paragraph's text as the ENGINE sees it: every text node under it, in
      // document order, which is what the text of a range inside it is a slice of.
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let rendered = "";
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) rendered += node.data;

      const segments = [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rendered),
      ].map((part) => ({
        start: part.index,
        end: part.index + part.segment.length,
        text: part.segment,
      }));
      const boundaries = new Set<number>([
        0,
        rendered.length,
        ...segments.map((segment) => segment.end),
      ]);
      // Every cluster the stimulus contains that is MORE than one code unit — the
      // part of the text that gives the boundary question teeth. Each one's interior
      // is a position the engine must never stop on.
      const controls = segments
        .filter((segment) => segment.end - segment.start > 1)
        .map((segment) => ({ ...segment, midIsBoundary: boundaries.has(segment.start + 1) }));
      const start = selected ? rendered.indexOf(selected) : -1;
      const flag = rendered.indexOf("\u{1F1F9}\u{1F1ED}");
      return {
        selected,
        start,
        end: start + selected.length,
        startOnBoundary: start >= 0 && boundaries.has(start),
        endOnBoundary: start >= 0 && boundaries.has(start + selected.length),
        controls,
        flagStart: flag,
      };
    },
    { name: surfaceName, lead: clusterLeadIn }
  );
}

type ClusterReading = Awaited<ReturnType<typeof clusterSelection>>;

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
        range.setStart(node!, at);
        range.setEnd(node!, at + 1);
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
  options: { hold?: boolean } = {}
): Promise<{ finger: { x: number; y: number }; finish: () => Promise<void> }> {
  const { from, to } = await coordinates(surface, phrase);
  const rest = async () => {};
  if (!isMobile) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (options.hold)
      return {
        finger: to,
        finish: async () => {
          await page.mouse.up();
        },
      };
    await page.mouse.up();
    return { finger: to, finish: rest };
  }
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 8,
            y: from.y + ((to.y - from.y) * step) / 8,
            id: 1,
          },
        ],
      });
    }
    const finish = async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    };
    if (options.hold) return { finger: to, finish };
    await finish();
    return { finger: to, finish: rest };
  }
  await surface.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: from.x,
    clientY: from.y,
  });
  await surface.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    clientX: to.x,
    clientY: to.y,
  });
  const finish = async () => {
    await surface.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      clientX: to.x,
      clientY: to.y,
    });
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
    ownedSurfaces: document.querySelectorAll("[data-student-owned-touch-selection]").length,
    highlightable: document.querySelectorAll("[data-student-highlightable]").length,
    textNodes: document.querySelectorAll("[data-content-text-node]").length,
    insidePicture: document.querySelectorAll(
      "[data-selection-loupe-source] [data-sat-annotation-region], [data-selection-loupe-source] [data-student-owned-touch-selection], [data-selection-loupe-source] [data-student-highlightable], [data-selection-loupe-source] [data-content-text-node]"
    ).length,
  }));
}

test("IELTS Reading: arming, caret resolution, range, capture and persistence", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  await page.goto(fixture);
  const surface = page.locator(passage);
  await expect(surface).toBeVisible();
  const before = await surface.elementHandle();
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.getByRole("button", { name: "Highlight", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(await surface.evaluate((root, original) => root === original, before)).toBe(true);
  const styles = await surface.evaluate((root) => ({
    marker: root.getAttribute("data-student-owned-touch-selection"),
    select: getComputedStyle(root).getPropertyValue("-webkit-user-select"),
    touch: getComputedStyle(root).touchAction,
  }));
  expect(styles).toEqual({ marker: "true", select: "text", touch: "none" });
  await drag(page, surface, "beta gamma", browserName, isMobile);
  await expect(surface.locator("mark")).toHaveText("beta gamma");
  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  await info.attach("selection-trace", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
  if (isMobile) {
    const selected = snapshot!.surfaces.find(
      (item) => item["surface"] === "IELTS reading:passage:passage-1"
    )!;
    expect(selected).toMatchObject({
      listenerAttached: true,
      listenerRootMatches: true,
      pointerDownSeen: true,
      pointerMoveSeen: true,
      pointerUpSeen: true,
      pointerCancelSeen: false,
      startCaretResolved: true,
      focusCaretResolved: true,
      rangeText: "beta gamma",
      onSelectCalled: true,
      captureSucceeded: true,
      mutationApplied: true,
    });
    expect(selected["rangeRectCount"]).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  }
  await page.getByText(/^Touch selection diagnostics \(/).click();
  const savedTrace = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save trace", exact: true }).click();
  await (await savedTrace).saveAs(info.outputPath("touch-selection-trace.json"));
  await page.screenshot({ path: info.outputPath("selection-diagnostics.png") });
  await page.reload();
  await expect(page.locator(passage).locator("mark")).toHaveText("beta gamma");
  await expect(page.locator(passage)).not.toHaveAttribute("data-student-owned-touch-selection");
  await page.getByRole("textbox", { name: "Answer", exact: true }).fill("Edited answer");
  await expect(page.getByRole("textbox", { name: "Answer", exact: true })).toHaveValue(
    "Edited answer"
  );
});

test("SAT: owned range reaches the actual shell toolbar and annotation state", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  await info.attach("selection-trace", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
  if (isMobile)
    expect(snapshot!.surfaces.find((item) => item["surface"] === "SAT stimulus")).toMatchObject({
      captureSucceeded: true,
      onSelectCalled: true,
      anchorReported: true,
      pointerCancelSeen: false,
    });
  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText("Several researchers");
});

test("SAT: armed text ownership is active before the first pointer", async ({ page }) => {
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  const toggle = page.getByRole("button", { name: /^Highlights & Notes/ });
  await toggle.click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");

  const armedStyles = await surface.evaluate((root) => {
    const text = root.querySelector("[data-content-text-node]");
    const editor = document.createElement("textarea");
    root.append(editor);
    const editorSelect = getComputedStyle(editor).userSelect;
    editor.remove();
    return {
      owner: root.getAttribute("data-student-selection-owner"),
      userSelect: getComputedStyle(root).userSelect,
      webkitUserSelect: getComputedStyle(root).getPropertyValue("-webkit-user-select"),
      textUserSelect: text ? getComputedStyle(text).userSelect : null,
      editorUserSelect: editorSelect,
      touchAction: getComputedStyle(root).touchAction,
    };
  });
  expect(armedStyles).toMatchObject({
    owner: "app",
    userSelect: "none",
    webkitUserSelect: "none",
    textUserSelect: "none",
    editorUserSelect: "text",
    touchAction: "none",
  });

  await toggle.click();
  await expect(surface).not.toHaveAttribute("data-student-selection-owner", "app");
  await expect(surface).not.toHaveAttribute("data-student-owned-touch-selection", "true");
  // Disarmed: the exam-wide disable applies — no native selection means no
  // loupe, no handles, and no platform menu on a long-press.
  expect(await surface.evaluate((root) => getComputedStyle(root).userSelect)).toBe("none");
});

test("SAT: the platform callout guard holds with annotation mode armed and disarmed", async ({
  page,
}) => {
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  const toggle = page.getByRole("button", { name: /^Highlights & Notes/ });
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const touchCallout = () =>
    surface.evaluate((root) =>
      getComputedStyle(root).getPropertyValue("-webkit-touch-callout").trim()
    );

  // Blink never implemented `-webkit-touch-callout`, so its computed value is
  // the empty string — there is no menu to suppress there to begin with.
  const disarmed = await touchCallout();
  test.skip(disarmed === "", "This engine does not report -webkit-touch-callout.");

  // Disarmed: this is the exact iPad regression — Highlight mode off, root
  // without its owner marker, long-press handing Look Up / Copy / Translate
  // back over the passage.
  expect(disarmed).toBe("none");

  await toggle.click();
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
  expect(await touchCallout()).toBe("none");

  await toggle.click();
  await expect(surface).not.toHaveAttribute("data-student-selection-owner", "app");
  expect(await touchCallout()).toBe("none");
});

test("SAT: keyboard navigation clears the old owned session and the next touch can select", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));
  expect(await page.locator("[data-student-selection-handle]").count()).toBe(2);

  await page.keyboard.press("Control+Alt+x");
  await expect(page.getByRole("heading", { name: "Question 2" })).toBeVisible();
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
  expect(await liveSelectionText(page)).toBe("");
  expect(
    await page.evaluate(() => {
      const native = window.getSelection();
      return !native || native.rangeCount === 0 || native.isCollapsed;
    })
  ).toBe(true);

  await drag(page, surface, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));
  expect(await liveSelectionText(page)).toBe("Several researchers");
  expect(await page.locator("[data-student-selection-line]").count()).toBeGreaterThan(0);
  expect(await page.locator("[data-student-selection-handle]").count()).toBe(2);
  expect(
    await page.evaluate(() => {
      const native = window.getSelection();
      return !native || native.rangeCount === 0 || native.isCollapsed;
    })
  ).toBe(true);

  // The pointer-driven footer path must clear the next resting Range at the
  // same scope boundary as the keyboard shortcut above.
  await page.locator("[data-touch-selection-diagnostics]").evaluate((panel) => {
    (panel as HTMLElement).style.pointerEvents = "none";
  });
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByRole("heading", { name: "Question 3" })).toBeVisible();
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
  expect(await liveSelectionText(page)).toBe("");
  expect(
    await page.evaluate(() => {
      const native = window.getSelection();
      return !native || native.rangeCount === 0 || native.isCollapsed;
    })
  ).toBe(true);
});

test("SAT: outside mouse drag dismisses once; the next drag uses Selection v2", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "This regression starts from an owned touch selection on a mobile browser.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const stimulus = page.locator('[data-sat-annotation-region="stimulus"]');
  const prompt = page.locator('[data-sat-annotation-region="prompt"]');
  await drag(page, stimulus, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expect(await page.locator("[data-student-selection-handle]").count()).toBe(2);

  const promptPoints = await coordinates(prompt, "Which choice best states");
  await page.mouse.move(promptPoints.from.x, promptPoints.from.y);
  await page.mouse.down();
  await page.mouse.move(promptPoints.to.x, promptPoints.to.y, { steps: 8 });
  await expect(page.locator("[data-selection-loupe]")).toHaveCount(0);
  await page.mouse.up();
  await nextFrames(page);

  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
  await expect(stimulus).toHaveAttribute("data-student-selection-owner", "app");
  await expect(prompt).toHaveAttribute("data-student-selection-owner", "app");
  expect(
    await page.evaluate(() => {
      const native = window.getSelection();
      return !native || native.rangeCount === 0 || native.isCollapsed;
    })
  ).toBe(true);

  await page.mouse.move(promptPoints.from.x, promptPoints.from.y);
  await page.mouse.down();
  await page.mouse.move(promptPoints.to.x, promptPoints.to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const promptSnapshot = await ownedSelectionSnapshot(page, "SAT prompt");
  expectOwnedTouchSnapshot(promptSnapshot);
  expect(promptSnapshot.rangeText).toBe("Which choice best states");
  expect(
    await page.evaluate(() =>
      (window.__nativeSelectionAudit ?? []).every(
        (entry) => entry.rangeCount === 0 || entry.isCollapsed
      )
    )
  ).toBe(true);
  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(prompt.locator('[data-sat-highlight="true"]')).toHaveText(
    "Which choice best states"
  );
  await info.attach("outside-mouse-one-intent", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        nativeSelection: window.getSelection()?.toString() ?? "",
        nativeRangeCount: window.getSelection()?.rangeCount ?? 0,
        toolbarVisible: document.querySelector('[data-sat-selection-toolbar="true"]') !== null,
      }))
    ),
    contentType: "application/json",
  });
});

async function startNativeSelectionAudit(page: Page) {
  await page.addInitScript(() => {
    window.__nativeSelectionAudit = [];
    document.addEventListener(
      "selectionchange",
      () => {
        const root = document.querySelector('[data-sat-selection-protected="true"]');
        const selection = window.getSelection();
        window.__nativeSelectionAudit?.push({
          rangeCount: selection?.rangeCount ?? 0,
          isCollapsed: selection?.isCollapsed ?? true,
          anchorInsideRoot:
            !!root && !!selection?.anchorNode && root.contains(selection.anchorNode),
          focusInsideRoot: !!root && !!selection?.focusNode && root.contains(selection.focusNode),
        });
      },
      { capture: true }
    );
  });
}

test("SAT: a long hold on selected words keeps the app range and never creates a native range", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "The touch gesture requires a mobile browser context.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const phrase = "Several researchers";
  await drag(page, surface, phrase, browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const before = await liveSelectionText(page);
  expect(before).toBe(phrase);

  const { from, to } = await coordinates(surface, phrase);
  const point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const finger = await press(page, surface, browserName);
  await finger.down(point);
  for (let step = 1; step <= 8; step += 1) {
    await page.waitForTimeout(80);
    await finger.move({ x: point.x + step, y: point.y });
  }
  await page.waitForTimeout(2100);
  await finger.release();
  await nextFrames(page);

  const result = await page.evaluate(() => {
    const record = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus");
    const native = window.getSelection();
    return {
      rangeText: record?.["rangeText"],
      ownerMarkerPresent: record?.["ownerMarkerPresent"],
      computedUserSelect: record?.["computedUserSelect"],
      computedWebkitUserSelect: record?.["computedWebkitUserSelect"],
      nativeRangeCount: native?.rangeCount ?? 0,
      nativeCollapsed: native?.isCollapsed ?? true,
      lines: document.querySelectorAll("[data-student-selection-line]").length,
      handles: document.querySelectorAll("[data-student-selection-handle]").length,
      nativeSelectionAudit: window.__nativeSelectionAudit ?? [],
      selectionChanges: window.__studentTouchSelectionDebug
        ?.snapshot()
        .documentEvents.filter((event) => event["stage"] === "selectionchange"),
    };
  });
  await info.attach("selected-text-hold", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.rangeText).toBe(before);
  expect(result.ownerMarkerPresent).toBe(true);
  expect([result.computedUserSelect, result.computedWebkitUserSelect]).toContain("none");
  expect(result.nativeRangeCount === 0 || result.nativeCollapsed).toBe(true);
  expect(result.lines).toBeGreaterThan(0);
  expect(result.handles).toBe(2);
  expect(
    result.nativeSelectionAudit.every((entry) => entry.rangeCount === 0 || entry.isCollapsed)
  ).toBe(true);
  expect(
    result.selectionChanges?.every(
      (event) =>
        event["nativeSelectionRangeCount"] === 0 || event["nativeSelectionCollapsed"] === true
    )
  ).toBe(true);
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));
});

test("SAT: an aggressive drag toward another text region stays in its starting block", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "The touch gesture requires a mobile browser context.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const prompt = page.locator('[data-sat-annotation-region="prompt"]');
  const phrase = "Several researchers";
  const { from } = await coordinates(surface, phrase);
  const outsideBlock = await coordinates(prompt, "Which choice best states");
  const originBlockId = await surface
    .locator("[data-content-text-node]")
    .first()
    .getAttribute("data-content-text-node");

  const finger = await press(page, surface, browserName);
  await finger.down(from);
  await finger.move(outsideBlock.to);
  await nextFrames(page);
  await finger.release();
  await nextFrames(page);

  const result = await page.evaluate(() => {
    const record = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus");
    const native = window.getSelection();
    return {
      rangeText: record?.["rangeText"],
      startBlockId: record?.["rangeStartSatBlockId"],
      endBlockId: record?.["rangeEndSatBlockId"],
      withinOneBlock: record?.["rangeWithinSingleSatTextBlock"],
      ownerMarkerPresent: record?.["ownerMarkerPresent"],
      nativeRangeCount: native?.rangeCount ?? 0,
      nativeCollapsed: native?.isCollapsed ?? true,
      nativeSelectionAudit: window.__nativeSelectionAudit ?? [],
      lines: document.querySelectorAll("[data-student-selection-line]").length,
      handles: document.querySelectorAll("[data-student-selection-handle]").length,
    };
  });
  await info.attach("bounded-sat-range", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.rangeText).toBeTruthy();
  expect(result.startBlockId).toBe(originBlockId);
  expect(result.endBlockId).toBe(originBlockId);
  expect(result.withinOneBlock).toBe(true);
  expect(result.ownerMarkerPresent).toBe(true);
  expect(result.nativeRangeCount === 0 || result.nativeCollapsed).toBe(true);
  expect(
    result.nativeSelectionAudit.every((entry) => entry.rangeCount === 0 || entry.isCollapsed)
  ).toBe(true);
  expect(result.lines).toBeGreaterThan(0);
  expect(result.handles).toBe(2);
});

test("SAT: closing text tools preserves the range and tapping its body restores the toolbar", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "The touch gesture requires a mobile browser context.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const phrase = "Several researchers";
  await drag(page, surface, phrase, browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const before = await liveSelectionText(page);
  expect(before).toBe(phrase);
  const anchorBefore = await page.evaluate(() => {
    const surface = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus");
    const events = surface?.["events"];
    if (!Array.isArray(events)) return null;
    return (
      events.filter((event) => event["stage"] === "captureSatTextRange").at(-1)?.["anchor"] ?? null
    );
  });

  // The bar has no dismissal control (the reference has none): Escape is the way
  // out, and it must leave the owned Range exactly where it was.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  expect(await page.locator("[data-student-selection-handle]").count()).toBe(2);
  expect(await liveSelectionText(page)).toBe(before);
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
  expect(
    await surface.evaluate(
      (root) =>
        getComputedStyle(root).getPropertyValue("-webkit-user-select") ||
        getComputedStyle(root).getPropertyValue("user-select")
    )
  ).toBe("none");
  await page.waitForTimeout(550);

  const { from, to } = await coordinates(surface, phrase);
  const point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const finger = await press(page, surface, browserName);
  await finger.down(point);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await page.waitForTimeout(2200);
  await finger.release();
  await nextFrames(page);

  const result = await page.evaluate(() => ({
    rangeText: window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus")?.["rangeText"],
    nativeRangeCount: window.getSelection()?.rangeCount ?? 0,
    nativeCollapsed: window.getSelection()?.isCollapsed ?? true,
    nativeSelectionAudit: window.__nativeSelectionAudit ?? [],
    lines: document.querySelectorAll("[data-student-selection-line]").length,
    handles: document.querySelectorAll("[data-student-selection-handle]").length,
  }));
  await info.attach("toolbar-reactivation", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  const anchorAfter = await page.evaluate(() => {
    const surface = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus");
    const events = surface?.["events"];
    if (!Array.isArray(events)) return null;
    return (
      events.filter((event) => event["stage"] === "captureSatTextRange").at(-1)?.["anchor"] ?? null
    );
  });
  await info.attach("toolbar-reactivation-anchor", {
    body: JSON.stringify(
      {
        anchorBefore,
        anchorAfter,
        trace: await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot()),
      },
      null,
      2
    ),
    contentType: "application/json",
  });
  expect(anchorBefore).toBeTruthy();
  expect(anchorAfter).toEqual(anchorBefore);
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));
  expect(result.rangeText).toBe(before);
  expect(result.nativeRangeCount === 0 || result.nativeCollapsed).toBe(true);
  expect(
    result.nativeSelectionAudit.every((entry) => entry.rangeCount === 0 || entry.isCollapsed)
  ).toBe(true);
  expect(result.lines).toBeGreaterThan(0);
  expect(result.handles).toBe(2);

  // The reopened toolbar can be dismissed again without ending the Range, and
  // its end handle must remain usable while the toolbar is absent.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  const rangeBeforeHandle = await liveSelectionText(page);
  await dragHandle(page, browserName, "end", 28);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expect(await liveSelectionText(page)).not.toBe(rangeBeforeHandle);
  expect(await page.locator("[data-student-selection-handle]").count()).toBe(2);
  expect(await page.locator("[data-student-selection-line]").count()).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => {
      const native = window.getSelection();
      return !native || native.rangeCount === 0 || native.isCollapsed;
    })
  ).toBe(true);
});

test("SAT: an unselected long press claims one word as an app-owned range", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The long press requires a mobile browser context.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const { from, to } = await coordinates(surface, "researchers");
  const point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const finger = await press(page, surface, browserName);
  await finger.down(point);
  await page.waitForTimeout(650);
  await finger.release();
  await nextFrames(page);

  const snapshot = await ownedSelectionSnapshot(page);
  expectOwnedTouchSnapshot(snapshot);
  expect(snapshot.rangeText).toBe("researchers");
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window.__nativeSelectionAudit ?? []).every(
        (entry) => entry.rangeCount === 0 || entry.isCollapsed
      )
    )
  ).toBe(true);
});

test("SAT: touch drags stay in their source block at edges and across shell boundaries", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const { from } = await coordinates(surface, "researchers");
  const targets = await page.evaluate(() => {
    const block = [...document.querySelectorAll<HTMLElement>("[data-content-text-node]")].find(
      (element) => element.textContent?.includes("Several researchers")
    );
    const pane = document.querySelector<HTMLElement>("[data-sat-passage-scroll]");
    const timer = document.querySelector<HTMLElement>('[role="timer"]');
    const banner = document.querySelector<HTMLElement>('[role="banner"]');
    if (!block || !pane || !timer || !banner)
      throw new Error("SAT boundary fixture nodes are missing");
    const rect = block.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const point = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const slider = document.querySelector<HTMLElement>("[data-sat-reading-split-handle]");
    const outsideY = Math.min(rect.bottom + 20, paneRect.bottom - 8, window.innerHeight - 8);
    return {
      leftEdge: { x: rect.left - 18, y: rect.top + rect.height / 2 },
      rightEdge: { x: rect.right + 18, y: rect.top + rect.height / 2 },
      belowParagraph: { x: rect.left + rect.width / 2, y: outsideY },
      divider: slider && getComputedStyle(slider).display !== "none" ? point(slider) : null,
      timer: point(timer),
      header: { x: banner.getBoundingClientRect().left + 8, y: point(banner).y },
      originBlockId: block.getAttribute("data-content-text-node"),
      blockBounds: { left: rect.left, right: rect.right, bottom: rect.bottom },
    };
  });
  expect(targets.leftEdge.x).toBeLessThan(targets.blockBounds.left);
  expect(targets.rightEdge.x).toBeGreaterThan(targets.blockBounds.right);
  expect(targets.belowParagraph.y).toBeGreaterThan(targets.blockBounds.bottom);
  if (browserName === "webkit") expect(targets.divider).not.toBeNull();
  const cases = [
    ["left text-block edge", targets.leftEdge],
    ["right text-block edge", targets.rightEdge],
    ["below paragraph", targets.belowParagraph],
    ...(targets.divider ? [["pane divider", targets.divider] as const] : []),
    ["timer", targets.timer],
    ["header", targets.header],
  ] as const;
  const evidence: Record<string, unknown> = {};

  for (const [label, target] of cases) {
    await clearOwnedSelection(page);
    const finger = await press(page, surface, browserName);
    await finger.down(from);
    await finger.move(target);
    await nextFrames(page, 3);
    await finger.release();
    await nextFrames(page);
    const snapshot = await ownedSelectionSnapshot(page);
    evidence[label] = snapshot;
    expect(snapshot.rangeText, `${label}: a source range must survive`).toBeTruthy();
    expect(snapshot.startBlockId, `${label}: the start remains in its original block`).toBe(
      targets.originBlockId
    );
    expect(snapshot.endBlockId, `${label}: the far edge remains in its original block`).toBe(
      targets.originBlockId
    );
    expect(snapshot.withinOneBlock, `${label}: the range stays block-bounded`).toBe(true);
    expect(snapshot.owner, `${label}: Selection v2 remains the owner`).toBe(true);
    expect(
      snapshot.nativeRangeCount === 0 || snapshot.nativeCollapsed,
      `${label}: native Selection stays empty`
    ).toBe(true);
    expect(snapshot.lines, `${label}: custom range is painted`).toBeGreaterThan(0);
    expect(snapshot.handles, `${label}: both custom handles are painted`).toBe(2);
  }

  await info.attach("sat-boundary-drags", {
    body: JSON.stringify({ targets, evidence }, null, 2),
    contentType: "application/json",
  });
  expect(
    await page.evaluate(() =>
      (window.__nativeSelectionAudit ?? []).every(
        (entry) => entry.rangeCount === 0 || entry.isCollapsed
      )
    )
  ).toBe(true);
});

test("SAT: a new touch range can overlap an existing highlight without creating native Selection", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, "Several researchers", browserName, isMobile);
  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText("Several researchers");
  await clearOwnedSelection(page);

  const origin = (await coordinates(surface, "researchers")).from;
  const target = (await coordinates(surface, "examined")).to;
  const finger = await press(page, surface, browserName);
  await finger.down(origin);
  for (let step = 1; step <= 8; step += 1) {
    await finger.move({
      x: origin.x + ((target.x - origin.x) * step) / 8,
      y: origin.y + ((target.y - origin.y) * step) / 8,
    });
  }
  await finger.release();
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const snapshot = await ownedSelectionSnapshot(page);
  expectOwnedTouchSnapshot(snapshot);
  expect(snapshot.rangeText).toContain("researchers");
  expect(snapshot.rangeText).toContain("examined");
  await expect(surface.locator('[data-sat-highlight="true"]')).toContainText("researchers");
  expect(
    await page.evaluate(() =>
      (window.__nativeSelectionAudit ?? []).every(
        (entry) => entry.rangeCount === 0 || entry.isCollapsed
      )
    )
  ).toBe(true);
});

test("SAT: pointercancel and lostpointercapture clear an in-flight owned selection", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  const { from } = await coordinates(surface, "researchers");

  for (const signal of ["pointercancel", "lostpointercapture"] as const) {
    const finger = await press(page, surface, browserName);
    await finger.down(from);
    await finger.move({ x: from.x + 16, y: from.y });
    await nextFrames(page, 3);
    await expect(
      page.locator("[data-student-selection-line]"),
      `${signal}: the gesture must be owned before cancellation`
    ).toHaveCount(1);
    const pointerId = await page.evaluate(() => {
      const record = window.__studentTouchSelectionDebug
        ?.snapshot()
        .surfaces.find((item) => item["surface"] === "SAT stimulus");
      const events = record?.["events"];
      if (!Array.isArray(events)) return null;
      const event = [...events]
        .reverse()
        .find(
          (entry) => entry["stage"] === "pointerdown" && typeof entry["pointerId"] === "number"
        );
      return event?.["pointerId"] ?? null;
    });
    expect(pointerId, `${signal}: the active browser pointer is observable`).not.toBeNull();
    await page.evaluate(
      ({ type, id }) => {
        const target =
          type === "lostpointercapture"
            ? document.querySelector('[data-sat-selection-protected="true"]')!
            : document;
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: id,
            pointerType: "touch",
            cancelable: false,
          })
        );
      },
      { type: signal, id: pointerId as number }
    );
    await finger.release();
    await nextFrames(page);

    await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
    await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
    await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
    const native = await page.evaluate(() => {
      const selection = window.getSelection();
      return { rangeCount: selection?.rangeCount ?? 0, collapsed: selection?.isCollapsed ?? true };
    });
    expect(native.rangeCount === 0 || native.collapsed).toBe(true);
  }
});

test("SAT: turning annotation mode off clears a resting owned touch selection", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await startNativeSelectionAudit(page);
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  const toggle = page.getByRole("button", { name: /^Highlights & Notes/ });
  await toggle.click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
  await expect(surface).not.toHaveAttribute("data-student-selection-owner", "app");
  const native = await page.evaluate(() => {
    const selection = window.getSelection();
    return { rangeCount: selection?.rangeCount ?? 0, collapsed: selection?.isCollapsed ?? true };
  });
  expect(native.rangeCount === 0 || native.collapsed).toBe(true);
  expect(
    await page.evaluate(() =>
      (window.__nativeSelectionAudit ?? []).every(
        (entry) => entry.rangeCount === 0 || entry.isCollapsed
      )
    )
  ).toBe(true);
});

test("SAT prompt wording uses the same owned selection surface as the passage", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const prompt = page.locator('[data-sat-annotation-region="prompt"]');
  await expect(prompt).toContainText("Which choice best states the main idea of the text?");

  await drag(page, prompt, "Which choice best states", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const selection = await page.evaluate(() => ({
    rangeCount: window.getSelection()?.rangeCount ?? 0,
    collapsed: window.getSelection()?.isCollapsed ?? true,
    lines: document.querySelectorAll("[data-student-selection-line]").length,
    handles: document.querySelectorAll("[data-student-selection-handle]").length,
  }));
  expect(selection.rangeCount === 0 || selection.collapsed).toBe(true);
  expect(selection.lines).toBeGreaterThan(0);
  expect(selection.handles).toBe(2);
});

test("SAT choice wording uses owned selection, keeps the radio unchanged, and still answers on tap", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const choice = page.locator('[data-sat-annotation-region="choice.a"]');
  await expect(choice).toContainText(
    "Tree cover can affect heat differently depending on local conditions."
  );

  await drag(page, choice, "Tree cover can affect heat", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const selection = await page.evaluate(() => ({
    rangeCount: window.getSelection()?.rangeCount ?? 0,
    collapsed: window.getSelection()?.isCollapsed ?? true,
    lines: document.querySelectorAll("[data-student-selection-line]").length,
    handles: document.querySelectorAll("[data-student-selection-handle]").length,
  }));
  expect(selection.rangeCount === 0 || selection.collapsed).toBe(true);
  expect(selection.lines).toBeGreaterThan(0);
  expect(selection.handles).toBe(2);
  await expect(page.getByRole("radio", { name: /Option A/ })).not.toBeChecked();

  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(choice.locator('[data-sat-highlight="true"]')).toContainText(
    "Tree cover can affect heat"
  );

  // The next deliberate tap remains a normal answer action after the echo guard
  // expires. Close the mark editor first because it intentionally shares the
  // selected text's nearby surface and may cover the neighboring row.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Edit annotation" })).toHaveCount(0);
  await page.waitForTimeout(450);
  await page
    .getByText("All cities experience identical temperature changes from tree cover.")
    .click();
  await expect(page.getByRole("radio", { name: /Option B/ })).toBeChecked();
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
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
      };
    };
    const menu = document.querySelector("[data-selection-action-menu]");
    const viewport = window.visualViewport;
    return {
      toolbarVisible: document.querySelector('[data-sat-selection-toolbar="true"]') !== null,
      menuVisibility: menu ? getComputedStyle(menu).visibility : null,
      lines: Array.from(document.querySelectorAll("[data-student-selection-line]")).map(box),
      handles: Array.from(document.querySelectorAll("[data-student-selection-handle]")).map(
        (element) => ({
          edge: element.getAttribute("data-student-selection-handle"),
          ...box(element),
        })
      ),
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
/**
 * The body gesture is word-granular, and a press in the MIDDLE of a word is what
 * decides it.
 *
 * The version this replaces anchored on the exact character under the finger, so
 * a few pixels of travel produced `esearchers` / `rch`, and moving into a
 * neighbour produced `rch examined`. Every string below is asserted WHILE the
 * finger is down — the engine's own trace of what it is painting — and then again
 * through the mark the student's own tap commits, so a partial word cannot hide
 * behind a green draw path.
 */
test("a mid-word touch drag takes whole words, in both directions", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  // MID-WORD by measurement rather than by hope: the widest glyph inside a word
  // is a point the finger is provably inside that word at.
  const middle = (glyph: { x: number; y: number; width: number; height: number }) => ({
    x: glyph.x + glyph.width / 2,
    y: glyph.y + glyph.height / 2,
  });
  const claimed = middle(await widestGlyph(region, "researchers"));
  const previous = middle(await widestGlyph(region, "Several"));
  const following = middle(await widestGlyph(region, "examined"));

  const finger = await press(page, region, browserName);
  await finger.down(claimed);
  // Claim, then nudge INSIDE the same word: nothing may change — no
  // character-level endpoint may appear, and the opposite edge may not move.
  await finger.move({ x: claimed.x + 3, y: claimed.y });
  await nextFrames(page);
  expect(await liveSelectionText(page), "a nudge inside the claimed word").toBe("researchers");

  // Into the previous word: the whole of it, and none of the gap between them.
  await finger.move(previous);
  await nextFrames(page);
  expect(await liveSelectionText(page), "reaching the word before the claim").toBe(
    "Several researchers"
  );

  // Across the claim into the next word: the run follows the finger forward in
  // reading order, so the origin stays `researchers`.
  await finger.move(following);
  await nextFrames(page);
  expect(await liveSelectionText(page), "crossing the claim to the word after it").toBe(
    "researchers examined"
  );

  await finger.release();
  await nextFrames(page);

  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  await info.attach("selection-trace", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
  if (browserName === "chromium") {
    const record = snapshot!.surfaces.find((item) => item["surface"] === "SAT stimulus")!;
    expect(record, "the release keeps the whole-word run, not the last caret").toMatchObject({
      rangeText: "researchers examined",
      onSelectCalled: true,
    });
  }

  // And the student's own next action proves what was committed: the mark covers
  // the whole-word run rather than a fragment of it.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(region.locator('[data-sat-highlight="true"]')).toHaveText("researchers examined");
});

/**
 * Leaving the node a word was claimed in is NOT a different gesture.
 *
 * A passage splits its words across inline elements — this fixture's
 * `*researchers*` renders as `<em>researchers</em>`, so the claim's node has a
 * sibling on each side — and the paragraph after it is a separate block. Both are
 * the same gesture to a student, and the version this replaces dropped the word
 * anchor at either boundary and read the raw offsets instead, so the run came
 * back partial at BOTH edges. Every step is observed WHILE the finger is down,
 * through the engine's own published range text, and then again through what the
 * release committed.
 */
test("a drag out of an inline element and into the next paragraph keeps whole words", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);

  // The premise, read off the page: the claim really is inside an INLINE element
  // whose siblings are separate text nodes, and the paragraph the drag ends in is
  // a separate BLOCK. Without these the flow would be the single-node case that
  // already passes.
  const premise = await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll("p")];
    const inlineBox = paragraphs.find((box) => (box.textContent ?? "").includes("canopy density"));
    const crossBox = paragraphs.find((box) => (box.textContent ?? "").includes("cooler climates"));
    const emphasized = inlineBox?.querySelector("em") ?? null;
    let textNodes = 0;
    if (inlineBox) {
      const walker = document.createTreeWalker(inlineBox, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) textNodes += 1;
    }
    return {
      emphasizedText: emphasized?.textContent ?? null,
      emphasizedHasOwnTextNode: emphasized?.firstChild?.nodeType === Node.TEXT_NODE,
      emphasizedFollowsASiblingNode: emphasized?.previousSibling?.nodeType === Node.TEXT_NODE,
      inlineTextNodes: textNodes,
      differentBlocks: Boolean(inlineBox && crossBox && inlineBox !== crossBox),
    };
  });
  expect(premise).toEqual({
    emphasizedText: inlineWord,
    emphasizedHasOwnTextNode: true,
    emphasizedFollowsASiblingNode: true,
    inlineTextNodes: 3,
    differentBlocks: true,
  });

  await page
    .locator("p")
    .filter({ hasText: "canopy density" })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });

  // MID-WORD by measurement, as the single-node flow does: the widest glyph inside
  // a word is a point the finger is provably inside that word at.
  const middle = (glyph: { x: number; y: number; width: number; height: number }) => ({
    x: glyph.x + glyph.width / 2,
    y: glyph.y + glyph.height / 2,
  });
  const claimed = middle(await widestGlyph(surface, inlineWord));
  const beforeTheElement = middle(await widestGlyph(surface, inlineLeadWord));
  const afterTheElement = middle(await widestGlyph(surface, inlineNextWord));
  const nextParagraph = middle(await widestGlyph(surface, crossWord));

  const finger = await press(page, surface, browserName);
  const spans: Record<string, string | null> = {};
  const live = async (key: string) => {
    spans[key] = await liveSelectionText(page, ieltsSurface);
    return spans[key];
  };

  await finger.down(claimed);
  await finger.move({ x: claimed.x + 3, y: claimed.y });
  await nextFrames(page);
  expect(
    await live("claim inside the <em>"),
    "the whole word under the press, inside the inline element"
  ).toBe(inlineWord);

  // A sibling text node on the BEFORE side of the claim's node: from the claim's
  // start through the whole word the finger reached.
  await finger.move(beforeTheElement);
  await nextFrames(page);
  expect(
    await live("across the inline boundary backwards"),
    "whole words across an inline boundary"
  ).toBe(`${inlineLeadWord} ${inlineWord}`);

  // The sibling on the AFTER side, still one paragraph.
  await finger.move(afterTheElement);
  await nextFrames(page);
  expect(
    await live("across the inline boundary forwards"),
    "whole words across an inline boundary"
  ).toBe(`${inlineWord} ${inlineNextWord}`);

  // And into the NEXT BLOCK: the run spans the rest of this paragraph's words and
  // the whole word the finger reached in the one after it.
  await finger.move(nextParagraph);
  await nextFrames(page);
  expect(await live("into the next paragraph"), "whole words across a paragraph boundary").toBe(
    crossRunText
  );

  await finger.release();
  await nextFrames(page);

  // The PRODUCT's own commit, with the marker tool armed: what was selected is
  // what gets painted, so a run the engine only reported would still fail here.
  const committed = await surface.locator("mark").allTextContents();
  spans["committed marks"] = committed.join(" | ");
  expect(committed.join(""), "the marker covers the same run the engine painted").toContain(
    "researchers examined how canopy density"
  );
  expect(committed.join(""), "and reaches the whole word in the next paragraph").toContain(
    crossWord
  );

  const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
  // Printed as well as asserted: what the run PROVED is the sequence of spans, and
  // a failure message only ever shows the step that broke.
  console.log(`[word-run] ${JSON.stringify(spans)}`);
  await info.attach("word-run-spans", {
    body: JSON.stringify(spans, null, 2),
    contentType: "application/json",
  });
  await info.attach("selection-trace", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
  if (browserName === "chromium") {
    const record = snapshot!.surfaces.find((item) => item["surface"] === ieltsSurface)!;
    expect(record, "the release commits the whole run, not the last caret").toMatchObject({
      rangeText: crossRunText,
      onSelectCalled: true,
    });
    // The commit's own anchor proves which nodes it spans, rather than a string
    // that could have been assembled from one node's text.
    expect(crossSpoken.startsWith("Their follow-up measurements")).toBe(true);
  }
});

/**
 * Thai: several words inside ONE run of letters, so word granularity has to come
 * from the platform's dictionary rather than from whitespace.
 *
 * This is the case an ASCII flow cannot speak to — `ภาษา` and `ไทย` are adjacent
 * characters with no gap between them, and a rule that split on spaces would call
 * the pair one word (or every character its own) and still pass every flow above.
 * The words the flow presses and asserts are the platform's own `Intl.Segmenter`
 * words, read off the page in the same evaluate, so the expectation and the engine
 * are asking the same authority where a word begins.
 */
test("a body drag through Thai stays on whole words", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);
  await page
    .locator("p")
    .filter({ hasText: thaiLead })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });
  await nextFrames(page);

  const paragraph = await paragraphWords(surface, thaiLead);
  // The premise, read off the page: real Thai — words ICU finds INSIDE one run of
  // letters, with no space to split on — and the word this flow claims is half of
  // such a pair. Without the first assertion the flow would be an ASCII one
  // wearing Thai text.
  const joinedPairs = paragraph.words
    .map((word, index) =>
      word.joinedToNext ? `${word.text}|${paragraph.words[index + 1]?.text ?? ""}` : null
    )
    .filter((pair): pair is string => pair !== null);
  const claimIndex = 1;
  expect(joinedPairs, "words ICU finds inside one uninterrupted run of Thai letters").toContain(
    "ภาษา|ไทย"
  );
  expect(paragraph.words.length, "enough words to drag across").toBeGreaterThan(5);
  expect(
    paragraph.words[claimIndex]!.joinedToNext || paragraph.words[claimIndex - 1]!.joinedToNext,
    "the claimed word is one half of a space-free pair"
  ).toBe(true);

  const { spans, fingerAt } = await walkWordDrag(page, browserName, {
    surface,
    diagnosticsSurface: ieltsSurface,
    lead: thaiLead,
    claim: claimIndex,
    // Forward across a space to the next words, then BACKWARD across the space-free
    // boundary between `ไทย` and `ภาษา` — the direction a whitespace splitter gets
    // wrong first.
    steps: [2, 3, 0],
    label: "thai-run",
  });

  // The released run is what the product paints: a whole-word span, not the last
  // caret the finger passed over.
  await nextFrames(page);
  const marks = await surface.locator("mark").allTextContents();
  spans["committed marks"] = marks.join("|");
  expect(marks.join(""), "the marker covers the same whole-word run the engine painted").toContain(
    paragraph.text.slice(paragraph.words[0]!.start, paragraph.words[claimIndex]!.end)
  );

  await info.attach("thai-run-spans", {
    body: JSON.stringify({ words: paragraph.words, spans, fingerAt }, null, 2),
    contentType: "application/json",
  });
});

/**
 * A right-to-left run: reading order and screen order disagree, and the body drag
 * has to follow READING order.
 *
 * The direction is not assumed — the paragraph's own computed `direction` and the
 * measured positions of the words it presses are what the flow asserts before it
 * moves anything, and the spans it then expects are the reading-order slices. An
 * engine that moved the endpoint toward the finger's own side of the screen would
 * fail on the very first step.
 */
test("a body drag through a right-to-left run stays on whole words", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);
  await nextFrames(page);

  const paragraph = await paragraphWords(surface, rtlLead);
  const claimIndex = 3;
  // The premise, read off the page: the text is a right-to-left SCRIPT (so the run
  // is ordered right to left), and the renderer really did lay reading order out
  // leftward — which is what makes "the next word" and "the next thing to the
  // right" different words. The block's own computed `direction` is NOT asserted:
  // this paragraph carries no `dir`, so it computes to `ltr` while its script,
  // its measured layout and the engine's answer are all right-to-left (reported
  // as an observation — a product that ships RTL prose without `dir` gets handle
  // stems chosen as if the run were left-to-right).
  expect(paragraph.text, "a right-to-left script, and nothing else").toMatch(
    /^[\p{Script=Arabic}\s]+$/u
  );
  expect(
    paragraph.words[claimIndex + 1]!.point.x,
    "the next word in reading order is to the LEFT of the claim"
  ).toBeLessThan(paragraph.words[claimIndex]!.point.x);
  expect(
    paragraph.words[claimIndex - 1]!.point.x,
    "and the previous word is to the RIGHT of it"
  ).toBeGreaterThan(paragraph.words[claimIndex]!.point.x);

  const { spans, fingerAt } = await walkWordDrag(page, browserName, {
    surface,
    diagnosticsSurface: ieltsSurface,
    lead: rtlLead,
    claim: claimIndex,
    // Forward in reading order is leftward on screen: two words that way, then back
    // across the claim to the right.
    steps: [4, 5, 2, 1],
    label: "rtl-run",
  });

  // Printed as well as attached: the block's computed direction is an OBSERVATION,
  // not an expectation — this paragraph carries no `dir`, so it computes to `ltr`
  // while its script, its measured layout and every span above are right to left.
  // The engine's word run is ordered by document order and is unaffected; the
  // direction it is handed does decide which line edge each handle sits on and how
  // an acquisition tie breaks, so the line is worth having in the run's output.
  console.log(
    `[rtl-run] block direction ${paragraph.direction}, script-only ${/^[\p{Script=Arabic}\s]+$/u.test(paragraph.text)}`
  );
  await info.attach("rtl-run-spans", {
    body: JSON.stringify(
      { direction: paragraph.direction, words: paragraph.words, spans, fingerAt },
      null,
      2
    ),
    contentType: "application/json",
  });
});

/**
 * A wrapped line: the finger crosses a VISUAL break without crossing anything the
 * text itself knows about.
 *
 * The words before and after a wrap are neighbours in one text node, so a run that
 * spans them is still one whole-word slice — and the flow proves the break is real
 * by measuring the glyph boxes: the claim and the word it reaches sit on different
 * visual lines of the same paragraph, a whole line height apart. A flow that
 * dragged to a word the renderer had kept on the same line would prove nothing,
 * so the premise is asserted before the gesture starts.
 */
test("a body drag across a wrapped line stays on whole words", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await nextFrames(page);

  const paragraph = await paragraphWords(surface, "Several");
  /** The words the renderer put on each visual line, in document order. */
  const lines: number[][] = [];
  paragraph.words.forEach((word, index) => {
    const line = lines[lines.length - 1];
    if (line && Math.abs(paragraph.words[line[0]!]!.point.top - word.point.top) <= 2)
      line.push(index);
    else lines.push([index]);
  });
  expect(lines.length, "the stimulus wraps at this viewport").toBeGreaterThan(1);
  expect(
    paragraph.textNodes,
    "one block: the break between the lines is a WRAP, not a paragraph"
  ).toBe(1);

  const claimIndex = lines[0]!.at(-1)!;
  const nextLine = lines[1]!;
  const lineGap = Math.abs(
    paragraph.words[nextLine[0]!]!.point.y - paragraph.words[claimIndex]!.point.y
  );
  expect(lineGap, "the word the finger reaches is a line below the claim").toBeGreaterThan(4);

  const { spans, fingerAt } = await walkWordDrag(page, browserName, {
    surface,
    diagnosticsSurface: satSurface,
    lead: "Several",
    claim: claimIndex,
    // Across the wrap (the last word of the first line, then the first two of the
    // second), then back UP a line to the first word of the paragraph.
    steps: [nextLine[0]!, nextLine[1]!, lines[0]![0]!],
    label: "wrap-run",
  });

  await info.attach("wrap-run-spans", {
    body: JSON.stringify({ lines, words: paragraph.words, spans, fingerAt, lineGap }, null, 2),
    contentType: "application/json",
  });
});

/**
 * A handle is the PRECISION instrument, and precision is measured in characters a
 * student can SEE.
 *
 * The harness's cluster question exists for this: a ZWJ family emoji, a flag, a
 * Thai syllable with a tone mark and a decomposed `café` — each one character on
 * screen and several UTF-16 code units long. An endpoint that moved by offset
 * would stop inside one of them and anchor an annotation to a fragment of a
 * character. Every observation below recovers the selection's own offsets from the
 * page and asks the platform's own segmenter whether they are cluster boundaries —
 * with a control that proves the question has teeth.
 *
 * SAT rather than IELTS on purpose: a reading-pane selection is committed and
 * cleared on the release, so the handles these cases need only exist on the exam
 * surface a resting selection keeps them on.
 */
test("dragging the END handle across clusters stops only on grapheme boundaries", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}${clustersQuestion}`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  // The opt-in really is on screen: without the clusters below, every boundary
  // check here would pass on ASCII and prove nothing.
  await expect(surface).toContainText("\u0E01\u0E48\u0E2D\u0E19");

  // Claim the word the stimulus starts with: the selection begins on a word
  // boundary, so every move after it is the handle's own doing.
  await drag(page, surface, clusterLeadIn, browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  await nextFrames(page, 4);

  const trail: Array<{ dx: number; reading: ClusterReading }> = [];
  const end = await grabHandle(page, browserName, "end");
  for (let step = 1; step <= 12; step += 1) {
    const dx = step * 6;
    await end.move(end.origin.x + dx, end.origin.y);
    await nextFrames(page);
    const reading = await clusterSelection(page, satSurface);
    trail.push({ dx, reading });
    expect(reading.selected, `nothing selected at +${dx}px`).not.toBe("");
    expect(
      reading.startOnBoundary,
      `the start left its boundary at +${dx}px: ${JSON.stringify(reading)}`
    ).toBe(true);
    expect(
      reading.endOnBoundary,
      `the end stopped inside a cluster at +${dx}px: ${JSON.stringify(reading)}`
    ).toBe(true);
  }
  await info.attach("end-handle-trail", {
    body: JSON.stringify(trail, null, 2),
    contentType: "application/json",
  });

  // The control, then the substance: the stimulus must really contain multi-unit
  // clusters, no interior offset of one may be a boundary, and the endpoint must
  // actually have CROSSED one — a boundary check that passed by never reaching the
  // emoji, the flag or the tone mark would prove nothing.
  const { controls } = trail[0]!.reading;
  expect(controls.length, "the cluster stimulus must contain multi-unit clusters").toBeGreaterThan(
    1
  );
  for (const control of controls) {
    expect(
      control.midIsBoundary,
      `offset ${control.start + 1} inside ${JSON.stringify(control.text)}`
    ).toBe(false);
  }
  expect(
    trail.some(({ reading }) => reading.end >= controls[0]!.end),
    "the endpoint never crossed a whole multi-unit cluster"
  ).toBe(true);

  // And the finger lifting hands the product exactly the span the student narrowed
  // to — a cluster boundary at both ends, or a committed annotation would later
  // show a fragment of a character.
  const committed = trail[trail.length - 1]!.reading.selected;
  await end.release();
  const afterRelease = await clusterSelection(page, satSurface);
  expect(afterRelease.selected, "the release kept the span the finger narrowed to").toBe(committed);
  expect(
    afterRelease.startOnBoundary && afterRelease.endOnBoundary,
    `the resting span is not on cluster boundaries: ${JSON.stringify(afterRelease)}`
  ).toBe(true);
});

test("dragging the START handle back across clusters stops only on grapheme boundaries", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}${clustersQuestion}`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');

  // Claim the Thai word — a multi-cluster word of its own — then walk the START
  // endpoint back through the flag and the family emoji. The other endpoint, the
  // other direction, and a claim that is not ASCII text.
  await drag(page, surface, "\u0E01\u0E48\u0E2D\u0E19", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  await nextFrames(page, 4);

  const trail: Array<{ dx: number; reading: ClusterReading }> = [];
  const start = await grabHandle(page, browserName, "start");
  for (let step = 1; step <= 14; step += 1) {
    const dx = step * -6;
    await start.move(start.origin.x + dx, start.origin.y);
    await nextFrames(page);
    const reading = await clusterSelection(page, satSurface);
    trail.push({ dx, reading });
    expect(reading.selected, `nothing selected at ${dx}px`).not.toBe("");
    expect(
      reading.startOnBoundary,
      `the start stopped inside a cluster at ${dx}px: ${JSON.stringify(reading)}`
    ).toBe(true);
    expect(
      reading.endOnBoundary,
      `the end left its boundary at ${dx}px: ${JSON.stringify(reading)}`
    ).toBe(true);
  }
  await info.attach("start-handle-trail", {
    body: JSON.stringify(trail, null, 2),
    contentType: "application/json",
  });

  const { controls, flagStart } = trail[0]!.reading;
  for (const control of controls) {
    expect(
      control.midIsBoundary,
      `offset ${control.start + 1} inside ${JSON.stringify(control.text)}`
    ).toBe(false);
  }
  expect(flagStart, "the cluster stimulus must contain the flag").toBeGreaterThan(0);
  expect(
    trail.some(({ reading }) => reading.start <= flagStart),
    "the start endpoint never crossed the flag on its way back"
  ).toBe(true);

  const committed = trail[trail.length - 1]!.reading.selected;
  await start.release();
  const afterRelease = await clusterSelection(page, satSurface);
  expect(afterRelease.selected, "the release kept the span the finger narrowed to").toBe(committed);
  expect(
    afterRelease.startOnBoundary && afterRelease.endOnBoundary,
    `the resting span is not on cluster boundaries: ${JSON.stringify(afterRelease)}`
  ).toBe(true);
});

/**
 * CROSSOVER: a handle dragged PAST the other endpoint.
 *
 * The spec's browser list names it, and no flow has ever crossed one: the
 * arbitration case stops short on purpose (its own comment says so) and the
 * reachability case drags each handle away from the other. The rule has therefore
 * only ever been asserted at unit level, while what it means on a real paint is
 * exactly the thing a unit test cannot see.
 *
 * What crossing must do is stated by the machine: the finger keeps the edge it
 * grabbed, the run stays forward in reading order, and the endpoint the finger
 * crossed is left precisely where it was — so the span MIRRORS instead of
 * inverting, losing an edge or collapsing. What it must never do is hand the drag
 * to the other endpoint, drop the anchor or fall back to a body gesture: the
 * finger crossed a character, not a gesture boundary.
 *
 * Every observation is taken WHILE the finger is down, from the engine's published
 * span and from the page: the span must be exactly the slice between the caret the
 * engine resolved for the finger and the endpoint the finger did not move, the
 * control at the anchor's edge must not have shifted a pixel, the magnifier —
 * pointed at the session's own moving endpoint — must stay inside the run it
 * paints, no second press may join the gesture, and the swollen grip
 * (`gripHeldScale`) must be the control on the finger's side. Both handles are
 * crossed, in both directions.
 */
test("a handle dragged past the opposite endpoint keeps the finger on its edge, in both directions", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await nextFrames(page);

  const paragraph = await paragraphWords(surface, "Several");
  const words = paragraph.words;
  const sameLine = (one: number, other: number) =>
    Math.abs(words[one]!.point.y - words[other]!.point.y) <= 2;

  // WHICH WORDS, FROM THE MEASURED LAYOUT. Crossing a word's start puts the finger
  // on the word before it, so that neighbour — and the one before that, for the
  // deepest step — has to be on the claim's own line: a case whose finger left the
  // line its endpoint is on would be about a wrap, not about crossing. The two
  // claims are kept apart so the second gesture starts outside the first one's
  // resting run, which is a no-drag zone.
  const claimAfter = (from: number, neighbour: (index: number) => boolean) => {
    for (let index = Math.max(2, from); index < words.length - 2; index += 1) {
      if (neighbour(index) && words[index]!.end - words[index]!.start >= 5) return index;
    }
    throw new Error("the stimulus has no word this flow can cross from");
  };
  const endHandleClaim = claimAfter(
    2,
    (index) => sameLine(index, index - 1) && sameLine(index, index - 2)
  );
  const startHandleClaim = claimAfter(
    endHandleClaim + 2,
    (index) => sameLine(index, index + 1) && sameLine(index, index + 2)
  );

  const trail: Array<Record<string, unknown>> = [];
  for (const gesture of [
    { edge: "end" as const, claim: words[endHandleClaim]!, direction: -1 },
    { edge: "start" as const, claim: words[startHandleClaim]!, direction: 1 },
  ]) {
    // A FRESH PAGE PER GESTURE. The previous gesture's release raises the product's
    // toolbar over the words that follow its run, and a press that landed there
    // would be a command rather than a claim — so each crossing is its own gesture,
    // on the same page and viewport the words were measured in.
    await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
    await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
    await nextFrames(page);
    await drag(page, surface, gesture.claim.text, browserName, isMobile);
    await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
    await nextFrames(page, 4);
    expect(
      await liveSelectionText(page),
      "the claim this gesture drags is the word it pressed on"
    ).toBe(gesture.claim.text);

    const before = await handlePaint(page);
    // The endpoint the finger will NOT move, and where it is painted: every step
    // below must leave this one exactly where it is, whichever control carries it.
    const anchor = gesture.edge === "end" ? gesture.claim.start : gesture.claim.end;
    const anchorX = (gesture.edge === "end" ? before.start : before.end)!.x;
    const width = before.end!.x - before.start!.x;
    expect(width, "the claimed word has a width to cross").toBeGreaterThan(10);

    const finger = await grabHandle(page, browserName, gesture.edge);
    // The finger is grabbed at the control's centre — that is where the 44px target
    // is — but it MOVES along the run's own line. The control's centre sits half a
    // target below the line, and a caret resolved from there is whatever the
    // engine's own fallback makes of a point under no glyph: Chromium picks the
    // nearest character, WebKit the line's end, and neither is what a student
    // dragging the dot is aiming at.
    const runY = Math.round((before.start!.y + before.end!.y) / 2);
    const pressesBefore = (await crossoverStep(page)).presses;
    // Out past the endpoint and back across it. 1.0 is the anchor itself, so the
    // finger crosses at 1.3 on the way out and at 0.75 on the way back, and every
    // step stays clear of 1.0 — where the two endpoints coincide and the machine
    // deliberately keeps the last non-collapsed run instead of a fresh slice.
    for (const fraction of [0.4, 0.75, 1.3, 1.5, 1.3, 0.75, 0.4]) {
      const dx = gesture.direction * Math.round(width * fraction);
      const fingerX = finger.origin.x + dx;
      await finger.move(fingerX, runY);
      await nextFrames(page);
      const step = await crossoverStep(page);
      const caret = step.caret;
      // THE LENS IS POINTED AT THE ENDPOINT THIS FINGER OWNS, AND THAT ENDPOINT IS
      // INSIDE THE RUN — measured the way the lens cases measure it, because the
      // lens's own box centre is NOT the caret's position in the document: the box
      // travels with the finger while the picture is translated so the caret lands
      // on the box's centre, so the mapping has to be read from the picture. A
      // caret resolved independently from the finger is the oracle, checked against
      // the lens and then against the lines the run paints.
      const caretPoint = await resolvedCaretAt(page, surface, finger.at());
      const pointed = await lensMisalignment(page, caretPoint);
      const caretInRun = step.lines.some(
        (line) =>
          caretPoint.x >= line.left - 4 &&
          caretPoint.x <= line.right + 4 &&
          caretPoint.y >= line.top - 6 &&
          caretPoint.y <= line.bottom + 6
      );
      trail.push({
        gesture: gesture.edge,
        word: gesture.claim.text,
        dx,
        fraction,
        anchor,
        fingerX,
        caretPoint,
        pointed,
        caretInRun,
        ...step,
      });

      expect(caret, `the engine resolved no caret at dx ${dx}`).not.toBeNull();
      // A TEXT node, so the offset below is a character offset and not an element's
      // child index: the prose is what the gesture is measured against.
      expect(step.caretNode, "the caret the engine resolved is in the prose").toContain("#text in");
      expect(caret, `the finger sat exactly on the endpoint it crossed at dx ${dx}`).not.toBe(
        anchor
      );
      // THE ASSERTION THIS FLOW EXISTS FOR: the run is exactly the slice between
      // the caret the engine resolved for the finger and the endpoint the finger
      // did not move — on EITHER side of it, so the span mirrors rather than
      // inverting, dropping an edge or collapsing.
      expect(step.span, `the run at dx ${dx} (caret ${caret}, anchor ${anchor})`).toBe(
        paragraph.text.slice(Math.min(caret!, anchor), Math.max(caret!, anchor))
      );

      // Which control is which follows the direction the run is READ in: once the
      // finger is past the anchor, the anchor is the run's FAR edge.
      const anchorEdge: "start" | "end" = caret! < anchor ? "end" : "start";
      const fingerEdge: "start" | "end" = anchorEdge === "end" ? "start" : "end";
      const atAnchor = step[anchorEdge];
      const atFinger = step[fingerEdge];
      expect(step.lines.length, `the run is not one line at dx ${dx}`).toBe(1);
      expect(step.handles, "the selection is still there, with both endpoints").toBe(2);
      expect(
        step.open,
        "the drag is still running: the lens only exists while a pointer is owned"
      ).toBe(true);
      expect(step.presses, "no second press joined the gesture").toBe(pressesBefore);
      expect(atAnchor, `no ${anchorEdge} control to read at dx ${dx}`).not.toBeNull();
      expect(
        Math.abs(atAnchor!.x - anchorX),
        `the endpoint the finger crossed moved at dx ${dx}: ${JSON.stringify({ atAnchor, anchorX })}`
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(atFinger!.x - fingerX),
        `the finger's own endpoint is not on the finger at dx ${dx}: ${JSON.stringify({ atFinger, fingerX })}`
      ).toBeLessThanOrEqual(12);
      // The lens's own centring is asserted where the cloned picture is faithful.
      // Its 1.5px bar belongs to a finger held mid-glyph; this finger sits ON a
      // handle at the line's own edge, and WebKit's clone drifts there by a few
      // pixels that vary run to run — the clone-fidelity gap the RTL lens case
      // already owns as its own bug. What is asserted everywhere is the claim this
      // flow is about: WHEREVER the lens points, the endpoint it magnifies is the
      // one inside the run the student can see.
      if (browserName === "chromium") {
        expect(pointed, `the lens has no picture to measure at dx ${dx}`).not.toBeNull();
        expect(
          Math.max(pointed!.x, pointed!.y),
          `the lens is not centred on the caret the engine resolved at dx ${dx}: ${JSON.stringify(pointed)}`
        ).toBeLessThan(2);
      }
      expect(
        caretInRun,
        `the loupe endpoint is outside the run at dx ${dx}: ${JSON.stringify({ caretPoint, lines: step.lines })}`
      ).toBe(true);
    }

    // THE OWNERSHIP WITNESS, with the animation given time to catch up: exactly one
    // grip is swollen and it belongs to the control on the finger's side — the
    // endpoint the machine says this finger owns, on both sides of the crossing.
    await nextFrames(page, 12);
    const settled = await crossoverStep(page);
    const heldEdge: "start" | "end" = settled.caret! < anchor ? "start" : "end";
    const crossedEdge: "start" | "end" = heldEdge === "start" ? "end" : "start";
    trail.push({ gesture: gesture.edge, word: gesture.claim.text, settled: true, ...settled });
    expect(
      settled.grip[heldEdge] ?? 0,
      `the finger's own grip is not the swollen one: ${JSON.stringify(settled.grip)}`
    ).toBeGreaterThan(1.06);
    expect(
      settled.grip[crossedEdge] ?? 0,
      `the endpoint the finger crossed is still swollen: ${JSON.stringify(settled.grip)}`
    ).toBeLessThan(1.06);

    await finger.release();
    await nextFrames(page, 2);
    const resting = await crossoverStep(page);
    trail.push({ gesture: gesture.edge, word: gesture.claim.text, released: true, ...resting });
    expect(resting.span, "the release kept the run the finger left").toBe(settled.span);
    expect(resting.handles, "both endpoints are still there to grab").toBe(2);
    expect(resting.open, "the lens goes with the finger").toBe(false);
  }

  console.log(`[crossover] ${JSON.stringify(trail.map(({ lines: _lines, ...rest }) => rest))}`);
  await info.attach("crossover-trail", {
    body: JSON.stringify(trail, null, 2),
    contentType: "application/json",
  });
});

test("SAT: scrolling the passage away keeps the selection and its handles, and hides the tools", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  // A viewport short enough that the passage is longer than its pane — on a pad
  // in portrait it fits, and a scroll that cannot move the words cannot test this
  // — and `long=1` for a passage the length of a real one, because a pane that
  // cannot scroll cannot take the selection off the screen at all.
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1&long=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const phrase = "Several researchers";
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, surface, phrase, browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();

  const scroller = page.locator("[data-sat-passage-scroll]");
  const range = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(range, "the passage must be scrollable for this case to mean anything").toBeGreaterThan(0);
  const before = await ownedSelectionGeometry(page);
  expect(before.handles.map((handle) => handle.edge).sort()).toEqual(["end", "start"]);
  expect(before.lines.length).toBeGreaterThan(0);

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  // The words are gone from the visible region, and with them the tools — but
  // nothing was thrown away: the surface is still mounted and claims no
  // interaction while it is hidden.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  const scrolled = await ownedSelectionGeometry(page);
  expect(scrolled.menuVisibility, "a hidden surface stays mounted").toBe("hidden");
  // Handles and lines are still painted, and they left the screen WITH the text
  // rather than being pinned to an edge.
  expect(scrolled.handles).toHaveLength(2);
  for (const handle of [...scrolled.handles, ...scrolled.lines]) {
    expect(
      handle.bottom,
      "the selection travelled off the top edge with its words"
    ).toBeLessThanOrEqual(scrolled.visibleTop);
  }

  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  const returned = await ownedSelectionGeometry(page);
  // The same selection, not a re-made one: same count, same place, same span.
  expect(
    returned.handles.map((handle) => ({ edge: handle.edge, top: handle.top, left: handle.left }))
  ).toEqual(
    before.handles.map((handle) => ({ edge: handle.edge, top: handle.top, left: handle.left }))
  );
  expect(returned.lines).toEqual(before.lines);

  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText(phrase);
  await info.attach("selection-geometry", {
    body: JSON.stringify({ before, scrolled, returned }, null, 2),
    contentType: "application/json",
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
    const frame = document.querySelector("[data-selection-loupe-frame]");
    if (!frame) return 0;
    const transform = getComputedStyle(frame).transform;
    if (!transform || transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

test("the magnifier is a picture of the prose, not a second exam surface", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  const before = await surfaceCounts(page);
  expect(before.stimulusRegions).toBeGreaterThan(0);

  // Finger down and moved, and left there: the magnifier only exists mid-gesture,
  // so a test about it has to read the page while the gesture is still running.
  const gesture = await drag(page, region, "Several researchers", browserName, isMobile, {
    hold: true,
  });
  const loupe = page.locator("[data-selection-loupe]");
  await expect(loupe).toBeVisible();

  // The clones DOM, so this is the measurement that catches it carrying the
  // application's own attributes: exactly as many addressable surfaces as before
  // the gesture, and the picture addressing nothing.
  const during = await surfaceCounts(page);
  expect(during).toEqual({ ...before, insidePicture: 0 });

  // And it is still the prose: the same words, magnified, above the finger that
  // is choosing them, and reachable by neither pointer nor assistive tech.
  await expect(page.locator("[data-selection-loupe-source]")).toContainText("Several researchers");
  // The frame is the part of the lens that scales in, and everything painted
  // inside it is scaled with it — so every box measured below is measured once
  // the entrance has settled, or it is a measurement of the animation. Exactly
  // settled: a lens still at 0.995 is half a pixel off across a whole passage.
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  const geometry = await page.evaluate(() => {
    const clone = document.querySelector("[data-selection-loupe-source]") as HTMLElement;
    const content = document.querySelector("[data-selection-loupe-content]") as HTMLElement;
    const lens = document.querySelector("[data-selection-loupe]")!.getBoundingClientRect();
    const marker = document.querySelector("[data-selection-loupe-marker]")!.getBoundingClientRect();
    const source = document.querySelector('[data-sat-annotation-region="stimulus"]') as HTMLElement;
    const scale = new DOMMatrixReadOnly(getComputedStyle(content).transform).a;
    const picture = clone.getBoundingClientRect();
    const passage = source.getBoundingClientRect();
    return {
      scale,
      nativeSelectionPolicy: [
        source,
        document.querySelector<HTMLElement>("[data-selection-floating-layer]"),
        clone,
        ...clone.querySelectorAll<HTMLElement>("*"),
      ].map((element) =>
        element ? getComputedStyle(element).getPropertyValue("-webkit-user-select") : null
      ),
      // The centre of the lens: what the PICTURE is pointed at (a character
      // boundary the engine resolved) and where the column tick is painted. Read
      // from the lens's own box rather than from anything the component believes.
      centre: { x: lens.left + lens.width / 2, y: lens.top + lens.height / 2 },
      marker: { x: marker.left + marker.width / 2, y: marker.top + marker.height / 2 },
      top: lens.top,
      size: lens.width,
      inert: clone.hasAttribute("inert"),
      hidden: clone.getAttribute("aria-hidden"),
      // The picture's own painted box, and the passage's — the two facts that say
      // whether the lens holds a second layout of the prose or a blank white disc.
      picture: {
        left: picture.left,
        right: picture.right,
        width: picture.width,
        height: picture.height,
      },
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
            if (
              rect.right > lens.left &&
              rect.left < lens.right &&
              rect.bottom > lens.top &&
              rect.top < lens.bottom
            )
              return true;
          }
        }
        return false;
      })(),
    };
  });
  expect(geometry.scale).toBeCloseTo(1.5, 2);
  expect(geometry.inert).toBe(true);
  expect(geometry.hidden).toBe("true");
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
  expect(
    pointed!.x,
    "the picture is centred on the resolved caret, not on the finger"
  ).toBeLessThan(1.5);
  expect(
    pointed!.y,
    "the picture is centred on the resolved caret, not on the finger"
  ).toBeLessThan(1.5);
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
  expect(geometry.nativeSelectionPolicy.length).toBeGreaterThan(3);
  expect(geometry.nativeSelectionPolicy.every((value) => value === "none")).toBe(true);

  await gesture.finish();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
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
test("the magnifier follows the finger while a handle is dragged, line by line", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  // Long enough prose that the end handle can be taken down onto another line,
  // and short enough a viewport that the finger is over real words.
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1&long=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "Several researchers", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  const handle = await grabHandle(page, browserName, "end");
  // Along the line first, then down onto the next one: the same gesture a student
  // makes to grow a highlight, and the one where a lens showing the wrong line is
  // indistinguishable from a lens that is working.
  const along = { x: handle.origin.x + 26, y: handle.origin.y };
  await handle.move(along.x, along.y);
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
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
  expect(second!.translate!.x - first!.translate!.x).toBeCloseTo(
    -(secondCaret.x - firstCaret.x) * second!.scale,
    0
  );
  expect(second!.translate!.y - first!.translate!.y).toBeCloseTo(
    -(secondCaret.y - firstCaret.y) * second!.scale,
    0
  );

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
  const across = (await coordinates(region, "canopy density")).from;
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
  expect(fingerInk, "the finger has to be over real ink for this to mean anything").not.toBeNull();
  const acrossCaret = await resolvedCaretAt(page, region, handle.at());
  const underTick = await characterUnder(
    page.locator("[data-selection-loupe-source]"),
    await lensCentre(page)
  );
  expect(underTick, "the tick sits on the caret the engine resolved").not.toBeNull();
  // The tick is drawn ON a boundary, so the rects of the characters either side
  // of it both contain the centre point — which is why this asserts the caret's
  // OWN characters rather than the character under the finger.
  expect(underTick!.index).toBe(characterAtCaret(acrossCaret));
  const third = await lensMisalignment(page, acrossCaret);
  expect(third!.x, "the picture is pointed at the caret, line by line").toBeLessThan(1.5);
  expect(third!.y, "the picture is pointed at the caret, line by line").toBeLessThan(1.5);

  await handle.release();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
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
test("the lens re-reads a passage that moved under it without a scroll or a resize", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "Several researchers", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  // Finger onto a later line, still down, with the lens pointing at it.
  const handle = await grabHandle(page, browserName, "end");
  const laterLine = (await coordinates(region, "built environment")).from;
  await handle.move(laterLine.x, laterLine.y);
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);
  const beforeCaret = await resolvedCaretAt(page, region, handle.at());
  const before = await lensMisalignment(page, beforeCaret);
  expect(before!.y).toBeLessThan(1.5);

  // The page moves the passage: an ancestor's box changes, so the passage is not
  // scrolled, not resized, and — as the run that found this shows — not announced.
  await page.evaluate(() => {
    const pane = document.querySelector("[data-sat-passage-scroll]")!.parentElement as HTMLElement;
    pane.style.paddingTop = "56px";
  });

  // The finger moves on — which is the commit that paints — and the box the picture
  // is translated by has to be the one the passage has on that frame.
  const after = (await coordinates(region, "built environment")).from;
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
  const underTick = await characterUnder(page.locator("[data-selection-loupe-source]"), centre);
  expect(fingerInk).not.toBeNull();
  expect(underTick, "the tick sits on the caret the engine resolved").not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(shiftedCaret));

  await handle.release();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
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
test("reduced motion greets the magnifier already settled, on every frame", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  // Before the document loads: motion reads the preference once, the way a
  // student who has it set at the OS level arrives.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  const gesture = await drag(page, region, "Several researchers", browserName, isMobile, {
    hold: true,
  });

  const sampled = await page.evaluate(async () => {
    const scaleOf = (element: Element | null) => {
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === "none") return 1;
      return new DOMMatrixReadOnly(transform).a;
    };
    const frames: number[] = [];
    let witness: string | null = null;
    let gripWitness: string | null = null;
    for (let frame = 0; frame < 14; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const lensFrame = document.querySelector("[data-selection-loupe-frame]");
      if (!lensFrame) continue;
      witness = lensFrame.getAttribute("data-selection-motion");
      const scale = scaleOf(lensFrame);
      if (scale !== null) frames.push(scale);
      gripWitness =
        document
          .querySelector("[data-student-selection-handle] .selection-v2-grip")
          ?.getAttribute("data-selection-motion") ?? null;
    }
    return { frames, witness, gripWitness };
  });

  expect(sampled.frames.length, "the magnifier was on screen for the sample").toBeGreaterThan(6);
  expect(sampled.witness).toBe("reduced");
  // Every frame, not merely the settled one: nothing was ever half-size.
  expect(sampled.frames.filter((scale) => scale !== 1)).toEqual([]);
  // The handle's grip answers the same way, from the same source.
  expect(sampled.gripWitness).toBe("reduced");

  await gesture.finish();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
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
      const transform =
        document.querySelector(`[data-student-selection-handle="${edge}"]`)?.style.transform ?? "";
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
      return match ? { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) } : null;
    };
    const line = document.querySelector("[data-student-selection-line]")?.getBoundingClientRect();
    return {
      start: read("start"),
      end: read("end"),
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
async function grabHandle(page: Page, browserName: string, edge: "start" | "end") {
  const box = await page.locator(`[data-student-selection-handle="${edge}"]`).boundingBox();
  const origin = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...origin, id: 2 }],
    });
    let at = origin;
    return {
      origin,
      move: async (x: number, y: number) => {
        at = { x, y };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y, id: 2 }],
        });
      },
      release: async () => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      },
      at: () => at,
    };
  }
  const handle = page.locator(`[data-student-selection-handle="${edge}"]`);
  await handle.dispatchEvent("pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: origin.x,
    clientY: origin.y,
    buttons: 1,
  });
  let at = origin;
  return {
    origin,
    move: async (x: number, y: number) => {
      at = { x, y };
      await handle.dispatchEvent("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        buttons: 1,
      });
    },
    release: async () => {
      await handle.dispatchEvent("pointerup", {
        pointerId: 2,
        pointerType: "touch",
        clientX: at.x,
        clientY: at.y,
      });
    },
    at: () => at,
  };
}

/** Press one handle, drag it sideways, release — the gesture a student makes. */
async function dragHandle(page: Page, browserName: string, edge: "start" | "end", dx: number) {
  const drag = await grabHandle(page, browserName, edge);
  await drag.move(drag.origin.x + dx, drag.origin.y);
  await drag.release();
}

/**
 * One frame of a handle drag, read from the page WHILE the finger is down.
 *
 * Everything here is a fact the surface publishes or paints, and nothing is a
 * claim about what it should have done: the span the engine is painting
 * (`rangeText`), the caret offset it resolved for the finger (`focusOffset`), how
 * many presses have reached the gesture since the last one inside the root, the
 * two endpoint controls' coordinates, the SCALE of each grip (which is the
 * machine's own witness of the endpoint the finger owns — `gripHeldScale` while
 * held, settled at 1 otherwise), the magnifier's centre (which is pointed at the
 * session's own moving endpoint) and the lines the run paints.
 *
 * The grip scale and the lens centre are read from layout rather than from a
 * component's report, for the same reason the rest of this file is: a value a
 * component says about itself cannot falsify the component.
 */
async function crossoverStep(page: Page) {
  return page.evaluate((surfaceName) => {
    const record = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === surfaceName);
    const events = (record?.["events"] ?? []) as Array<Record<string, unknown>>;
    const focus = [...events].reverse().find((event) => event["stage"] === "focus-caret");
    const at = (edge: string) => {
      const transform =
        document.querySelector(`[data-student-selection-handle="${edge}"]`)?.style.transform ?? "";
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
      return match ? { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) } : null;
    };
    const grip = (edge: string) => {
      const element = document.querySelector(
        `[data-student-selection-handle="${edge}"] .selection-v2-grip`
      );
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      return !transform || transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
    };
    const lens = document.querySelector("[data-selection-loupe]");
    const box = lens ? lens.getBoundingClientRect() : null;
    return {
      span: typeof record?.["rangeText"] === "string" ? record["rangeText"] : null,
      caret: typeof focus?.["focusOffset"] === "number" ? focus["focusOffset"] : null,
      caretNode: typeof focus?.["focusNode"] === "string" ? focus["focusNode"] : null,
      presses: events.filter(
        (event) => event["stage"] === "pointerdown" && event["pointerDownSeen"] === true
      ).length,
      handles: document.querySelectorAll("[data-student-selection-handle]").length,
      open: !!lens,
      start: at("start"),
      end: at("end"),
      grip: { start: grip("start"), end: grip("end") },
      tick: box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null,
      lines: [...document.querySelectorAll("[data-student-selection-line]")].map((line) => {
        const rect = line.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    };
  }, "SAT stimulus");
}

/** Let the page run frames, so the render a gesture's move asked for has happened. */
async function nextFrames(page: Page, frames = 2) {
  await page.evaluate(async (count) => {
    for (let frame = 0; frame < count; frame += 1)
      await new Promise((resolve) => requestAnimationFrame(resolve));
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
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    let at = { x: 0, y: 0 };
    return {
      down: async (point: { x: number; y: number }) => {
        at = point;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...point, id: 1 }],
        });
      },
      move: async (point: { x: number; y: number }) => {
        at = point;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...point, id: 1 }],
        });
      },
      at: () => at,
      release: async () => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      },
    };
  }
  let at = { x: 0, y: 0 };
  /**
   * A synthetic pointer delivered to the element the COORDINATE is over.
   *
   * Not to the pane's prose: a real finger is hit-tested by the browser, and the
   * coordinates a selection's own controls cover resolve to those controls. A
   * harness that always delivered to the prose would be unable to reproduce the
   * very arbitration cases this suite now turns on — and would report a press the
   * browser gives to a handle as a press on the text.
   */
  const send = (type: string, point: { x: number; y: number }) =>
    page.evaluate(
      (event) => {
        const target = document.elementFromPoint(event.point.x, event.point.y) ?? document.body;
        target.dispatchEvent(
          new PointerEvent(event.type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            buttons: event.type === "pointerup" ? 0 : 1,
            clientX: event.point.x,
            clientY: event.point.y,
          })
        );
      },
      { type, point }
    );
  return {
    down: async (point: { x: number; y: number }) => {
      at = point;
      await send("pointerdown", point);
    },
    move: async (point: { x: number; y: number }) => {
      at = point;
      await send("pointermove", point);
    },
    at: () => at,
    release: async () => {
      await send("pointerup", at);
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
 * The range the engine is painting RIGHT NOW, read from its own trace.
 *
 * `rangeText` is recorded by every published frame, so it is the selection a
 * student would see mid-gesture — which is the only way to observe the body
 * gesture's granularity before the release commits it.
 */
async function liveSelectionText(page: Page, surface = "SAT stimulus") {
  return page.evaluate((name) => {
    const record = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === name);
    const text = record?.["rangeText"];
    return typeof text === "string" ? text : null;
  }, surface);
}

/** The owned range, native Selection, and the paint that must agree on every SAT touch path. */
async function ownedSelectionSnapshot(page: Page, surfaceName = "SAT stimulus") {
  return page.evaluate((name) => {
    const record = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === name);
    const native = window.getSelection();
    return {
      rangeText: typeof record?.["rangeText"] === "string" ? record["rangeText"] : "",
      withinOneBlock: record?.["rangeWithinSingleSatTextBlock"] === true,
      startBlockId: record?.["rangeStartSatBlockId"] ?? null,
      endBlockId: record?.["rangeEndSatBlockId"] ?? null,
      owner: record?.["ownerMarkerPresent"] === true,
      nativeRangeCount: native?.rangeCount ?? 0,
      nativeCollapsed: native?.isCollapsed ?? true,
      lines: document.querySelectorAll("[data-student-selection-line]").length,
      handles: document.querySelectorAll("[data-student-selection-handle]").length,
    };
  }, surfaceName);
}

async function clearOwnedSelection(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
}

function expectOwnedTouchSnapshot(snapshot: Awaited<ReturnType<typeof ownedSelectionSnapshot>>) {
  expect(snapshot.rangeText).toBeTruthy();
  expect(snapshot.withinOneBlock).toBe(true);
  expect(snapshot.startBlockId).toBe(snapshot.endBlockId);
  expect(snapshot.owner).toBe(true);
  expect(snapshot.nativeRangeCount === 0 || snapshot.nativeCollapsed).toBe(true);
  expect(snapshot.lines).toBeGreaterThan(0);
  expect(snapshot.handles).toBe(2);
}

/**
 * One paragraph's WORDS, the point that presses each one, and the lines they fall
 * on — all read off the page.
 *
 * The words come from the platform's own `Intl.Segmenter` in `word` granularity,
 * which is the authority the engine itself claims text with: Thai puts several
 * words inside one run of letters and Arabic orders them right to left, so a flow
 * that guessed where a word begins would be testing its own guess. The press point
 * is measured from the rendered glyph of a character INSIDE the word, and the
 * lines come from those glyph boxes, because how the renderer broke the paragraph
 * is a fact only the page has.
 */
async function paragraphWords(surface: Locator, lead: string) {
  return surface.evaluate((root, startsWith) => {
    const paragraph = [...root.querySelectorAll("p")].find((box) =>
      (box.textContent ?? "").startsWith(startsWith)
    );
    if (!paragraph) throw new Error(`Missing paragraph starting with: ${startsWith}`);
    // The paragraph's text as a RANGE sees it: every text node under it, in
    // document order, which is the string the engine's own spans are cut from.
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number }> = [];
    let text = "";
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    const locate = (index: number) => {
      for (let position = nodes.length - 1; position >= 0; position -= 1) {
        const entry = nodes[position]!;
        if (index >= entry.start) return { node: entry.node, offset: index - entry.start };
      }
      throw new Error("offset outside the paragraph");
    };
    /** The centre of the glyph at one character index, in viewport coordinates. */
    const pointOf = (index: number) => {
      const { node: target, offset } = locate(index);
      const range = document.createRange();
      range.setStart(target, offset);
      range.setEnd(target, Math.min(offset + 1, target.data.length));
      const box = range.getBoundingClientRect();
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        top: box.top,
        height: box.height,
      };
    };
    const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
      .filter((part) => part.isWordLike)
      .map((part) => ({
        start: part.index,
        end: part.index + part.segment.length,
        text: part.segment,
        point: pointOf(part.index + Math.floor(part.segment.length / 2)),
        // Whether the NEXT word butts against this one with no whitespace: the
        // difference between `alpha beta` and Thai's several words in one run of
        // letters, which is what makes the Thai case say something an ASCII one
        // cannot.
        joinedToNext: /\S/.test(text[part.index + part.segment.length] ?? ""),
      }));
    return {
      text,
      direction: getComputedStyle(paragraph).direction,
      textNodes: nodes.length,
      words,
    };
  }, lead);
}

type ParagraphWords = Awaited<ReturnType<typeof paragraphWords>>;

/**
 * The whole-word run the spec asks for, derived the way the engine derives it: the
 * claimed word is the anchor and only its far side may move, the word the finger
 * reached supplies that edge, and the slice stays in reading order — which for
 * Arabic is leftward on screen.
 */
function expectedRun(paragraph: ParagraphWords, claim: number, target: number): string {
  const words = paragraph.words;
  return target > claim
    ? paragraph.text.slice(words[claim]!.start, words[target]!.end)
    : paragraph.text.slice(words[target]!.start, words[claim]!.end);
}

/**
 * A body drag walked WORD BY WORD through one paragraph, with the engine's own
 * published range text read after every step.
 *
 * `rangeText` is what the engine is painting at that instant — not what a release
 * later committed — so a partial word would be observed at the step that produced
 * it rather than at the end of the gesture. The claim is taken the same way the
 * ASCII flow takes it (press, then a nudge INSIDE the claimed word), and every
 * step's span is both asserted and kept, so what the run PROVED is printed and
 * attached as a sequence rather than inferred from a green tick.
 */
async function walkWordDrag(
  page: Page,
  browserName: string,
  options: {
    surface: Locator;
    diagnosticsSurface: string;
    lead: string;
    claim: number;
    steps: number[];
    label: string;
  }
) {
  const { surface, diagnosticsSurface, lead, claim, steps, label } = options;
  const paragraph = await paragraphWords(surface, lead);
  const at = (index: number) => paragraph.words[index]!.point;
  const spans: Record<string, string | null> = {};
  const fingerAt: Record<string, { x: number; y: number }> = {};
  const live = async (key: string, finger: { x: number; y: number }) => {
    spans[key] = await liveSelectionText(page, diagnosticsSurface);
    fingerAt[key] = { x: Math.round(finger.x), y: Math.round(finger.y) };
    return spans[key];
  };

  const finger = await press(page, surface, browserName);
  await finger.down(at(claim));
  await finger.move({ x: at(claim).x + 3, y: at(claim).y });
  await nextFrames(page);
  expect(
    await live(`claim ${paragraph.words[claim]!.text}`, finger.at()),
    "the whole word under the press"
  ).toBe(paragraph.words[claim]!.text);

  for (const index of steps) {
    const word = paragraph.words[index]!;
    await finger.move(at(index));
    await nextFrames(page);
    expect(
      await live(`→ ${word.text} @${word.start}`, finger.at()),
      `reaching ${JSON.stringify(word.text)}`
    ).toBe(expectedRun(paragraph, claim, index));
  }
  await finger.release();
  await nextFrames(page);

  console.log(`[${label}] spans ${JSON.stringify(spans)} finger ${JSON.stringify(fingerAt)}`);
  return { spans, fingerAt };
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
    const marker = document.querySelector("[data-selection-loupe-marker]");
    const gripTick = document.querySelector(".selection-v2-grip-tick");
    const deviation = (element: Element | null): number => {
      if (!element) return -1;
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === "none") return 0;
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
      revision: marker?.getAttribute("data-snap-revision") ?? null,
      gripWitness:
        document
          .querySelector("[data-student-selection-handle] .selection-v2-grip")
          ?.getAttribute("data-selection-motion") ?? null,
      markerDeviations,
      gripDeviations,
    };
  }, frames);
}

/** The picture's own offset INSIDE the lens, as the string it is written with. */
async function loupeContentTransform(page: Page) {
  return page.evaluate(
    () =>
      (document.querySelector("[data-selection-loupe-content]") as HTMLElement | null)?.style
        .transform ?? null
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
async function lensMisalignment(
  page: Page,
  finger: { x: number; y: number },
  sourceSelector = '[data-sat-annotation-region="stimulus"]'
) {
  return page.evaluate(
    ({ point, sourceSelector }) => {
      const content = document.querySelector(
        "[data-selection-loupe-content]"
      ) as HTMLElement | null;
      const clone = document.querySelector("[data-selection-loupe-source]") as HTMLElement | null;
      const lens = document.querySelector("[data-selection-loupe]");
      const source = document.querySelector(sourceSelector);
      if (!content || !clone || !lens || !source) return null;
      const lensRect = lens.getBoundingClientRect();
      const picture = clone.getBoundingClientRect();
      const passage = source.getBoundingClientRect();
      const scale = new DOMMatrixReadOnly(getComputedStyle(content).transform).a;
      const translate = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(content.style.transform);
      return {
        scale,
        x: Math.abs(
          picture.left + (point.x - passage.left) * scale - (lensRect.left + lensRect.width / 2)
        ),
        y: Math.abs(
          picture.top + (point.y - passage.top) * scale - (lensRect.top + lensRect.height / 2)
        ),
        translate: translate ? { x: Number(translate[1]), y: Number(translate[2]) } : null,
      };
    },
    { point: finger, sourceSelector }
  );
}

/**
 * The centre of the lens on screen: where the tick points, and the point the
 * picture is asked to resolve. Read from the lens's box rather than from anything
 * the component says about itself.
 */
async function lensCentre(page: Page) {
  return page.evaluate(() => {
    const lens = document.querySelector("[data-selection-loupe]")!.getBoundingClientRect();
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
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
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
      return candidate!.nodeType === Node.ELEMENT_NODE
        ? (candidate as Element)
        : candidate!.parentElement;
    };
    const asPrecise = (candidate: Node | null, at: number): Text | null => {
      if (candidate?.nodeType !== Node.TEXT_NODE) return null;
      const run = candidate as Text;
      if (run.data.length === 0 || !inScope(run)) return null;
      hitOffset = Math.max(0, Math.min(run.data.length, Math.trunc(at)));
      return run;
    };

    if (typeof doc.caretPositionFromPoint === "function") {
      const position = doc.caretPositionFromPoint(point.x, point.y);
      hit = asPrecise(position?.offsetNode ?? null, position?.offset ?? 0);
      hint = elementFor(position?.offsetNode ?? null);
    }
    if (!hit && typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(point.x, point.y);
      if (range) {
        hit = asPrecise(range.startContainer, range.startOffset);
        hint = hint ?? elementFor(range.startContainer);
      }
    }

    const distanceToRect = (rect: DOMRect, x: number, y: number) =>
      Math.hypot(
        Math.max(rect.left - x, 0, x - (rect.left + rect.width)),
        Math.max(rect.top - y, 0, y - (rect.top + rect.height))
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
      if (!nearest)
        throw new Error("the platform answered with an element and no text measures inside it");
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
    if (!previous && !next) throw new Error("no measurable glyph beside the resolved caret");

    const rtl = getComputedStyle((node as Text).parentElement ?? scope).direction === "rtl";
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
    if (counted === null) throw new Error("the resolved caret is outside the passage under test");

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
    Boolean(value && value.trim() !== "" && !/^\p{M}/u.test(value));
  if (hasOwnGlyph(caret.charBefore)) return caret.index - 1;
  if (caret.charAfter && caret.charAfter.trim() !== "") return caret.index;
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
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          target.x >= rect.left &&
          target.x <= rect.right &&
          target.y >= rect.top &&
          target.y <= rect.bottom
        ) {
          hits.push({ index, char: node.data[offset] });
        }
        index += 1;
      }
    }
    return hits.find((hit) => hit.char.trim() !== "") ?? hits[0] ?? null;
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
test("the handles are painted and hittable, and dragging one moves only that end", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "Several researchers", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  const reach = await page.evaluate(() => {
    const layer = document.querySelector("[data-selection-floating-layer]")!;
    const box = layer.getBoundingClientRect();
    const targets = Array.from(document.querySelectorAll("[data-student-selection-handle]")).map(
      (element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        // The dot inside the control is what a point resolves to, so the check is
        // "is this handle an ancestor of what the point hit", not equality.
        return {
          edge: element.getAttribute("data-student-selection-handle"),
          hit: hit?.closest?.("[data-student-selection-handle]") === element,
        };
      }
    );
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      box: { width: Math.round(box.width), height: Math.round(box.height) },
      clips: getComputedStyle(layer).overflow,
      scrolls: layer.scrollWidth > layer.clientWidth || layer.scrollHeight > layer.clientHeight,
      targets,
    };
  });

  expect(reach.box, "the layer is the viewport, not the popover floor plan").toEqual(
    reach.viewport
  );
  expect(reach.clips).toBe("visible");
  expect(reach.scrolls, "nothing is scrolled out of a clipped box").toBe(false);
  expect(reach.targets.map((target) => target.edge).sort()).toEqual(["end", "start"]);
  expect(reach.targets.filter((target) => !target.hit)).toEqual([]);

  const before = await endpoints(page);
  await dragHandle(page, browserName, "end", 60);
  const afterEnd = await endpoints(page);
  expect(afterEnd.start, "the anchor did not move").toEqual(before.start);
  expect(afterEnd.end!.x, "the grabbed endpoint followed the finger").toBeGreaterThan(
    before.end!.x + 20
  );

  await dragHandle(page, browserName, "start", 40);
  const afterStart = await endpoints(page);
  expect(afterStart.end, "the other end stayed where it was left").toEqual(afterEnd.end);
  expect(afterStart.start!.x).toBeGreaterThan(afterEnd.start!.x + 10);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
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
    const surface = window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "SAT stimulus");
    const events = (surface?.["events"] ?? []) as { stage: string; pointerDownSeen?: boolean }[];
    // The hook's own record, not the diagnostics module's raw capture listener
    // (which sees every pointerdown whether or not the overlay consumed it).
    return events.filter((event) => event.stage === "pointerdown" && event.pointerDownSeen === true)
      .length;
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
 * WHICH ENDPOINT A PRESS GRABS IS A FACT ABOUT THE PAINT (docs/selectionui.md #8).
 *
 * A selection narrower than the 44px controls that adjust it puts both of their
 * boxes over the same coordinates, and the one the browser delivers a press to is
 * decided by render order. On a short enough line the END control's box reaches
 * above the line's top edge, over the whole of the START handle's outward zone:
 * a press there belongs to the START and is delivered to the END. An overlay that
 * asks only the control it was handed refuses it, consumes it as the selection's
 * body, and the handle the student aimed at never moves.
 *
 * The coordinate below is derived from the paint and asserted to be delivered to
 * the END control FIRST — with the same in-page measurement a student's finger
 * goes through — so the case cannot quietly become a test of something else.
 */
test("a short selection grabs the endpoint the press belongs to, not the one on top", async ({
  page,
  browserName,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  // A word in the middle of a line, so the START endpoint has room to be dragged
  // outward (left) as well as in: at a line's first word the pane's own edge is
  // 20px away and an outward drag has nowhere to go.
  await drag(page, region, "temperature", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  // The shell raises and settles its toolbar after the release; measure only once
  // that is done, so a settle cannot be mistaken for an endpoint moving.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await nextFrames(page, 4);
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));

  // Narrow it from the END until the two controls fight over one line — measured
  // from the paint rather than guessed, so the premise below is about this page.
  const width = await page.evaluate(() => {
    const centre = (edge: string) => {
      const rect = document
        .querySelector(`[data-student-selection-handle="${edge}"]`)!
        .getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    return { start: centre("start"), end: centre("end") };
  });
  await dragHandle(page, browserName, "end", width.start + 18 - width.end);
  await nextFrames(page, 4);

  const geometry = await page.evaluate(() => {
    const box = (edge: string) =>
      document.querySelector(`[data-student-selection-handle="${edge}"]`)!.getBoundingClientRect();
    const centre = (rect: DOMRect) => ({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const start = box("start");
    const end = box("end");
    const line = document.querySelector("[data-student-selection-line]")!.getBoundingClientRect();
    // 8px right of the start anchor and 1px below the line's top edge: inside the
    // start control's box and inside its outward zone (the zone reaches 2px past
    // the line's top, the same rounding allowance the engine uses).
    const probe = { x: centre(start).x + 8, y: line.top + 1 };
    const hit = document.elementFromPoint(probe.x, probe.y);
    const pane = document
      .querySelector('[data-sat-passage-scroll], [data-sat-annotation-region="stimulus"]')!
      .getBoundingClientRect();
    return {
      lineHeight: line.height,
      start: centre(start),
      end: centre(end),
      lineTop: line.top,
      paneLeft: pane.left,
      probe,
      deliveredTo:
        hit
          ?.closest?.("[data-student-selection-handle]")
          ?.getAttribute("data-student-selection-handle") ?? null,
    };
  });

  await info.attach("arbitration-geometry", {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });

  // The premises that make this case mean anything, each read off the page: the
  // selection is narrower than the controls that adjust it; the line is short
  // enough for the END control's box to reach past the line's top edge, over the
  // START handle's outward zone; there is room to drag the endpoint outward; and
  // the coordinate below really is delivered to the END control.
  expect(
    geometry.end.x - geometry.start.x,
    "the two controls must fight over the line"
  ).toBeLessThan(44);
  expect(geometry.lineHeight, "a 44px control must reach the other endpoint’s zone").toBeLessThan(
    24
  );
  expect(
    geometry.start.x - geometry.paneLeft,
    "room to drag the start endpoint outward"
  ).toBeGreaterThan(60);
  expect(geometry.deliveredTo, "the premise is a press the END control receives").toBe("end");
  expect(geometry.probe.x).toBeGreaterThan(geometry.start.x);
  expect(geometry.probe.y, "inside the start handle’s outward zone").toBeLessThanOrEqual(
    geometry.lineTop + 2
  );

  const claim = await liveSelectionText(page);
  // ABSOLUTE positions, not positions relative to the painted line: this press
  // takes the START endpoint, and the line's own left edge travels with it — a
  // relative reading would show the endpoint it belongs to standing still.
  const before = await endpoints(page);
  expect(before.start).not.toBeNull();
  expect(before.end).not.toBeNull();
  const intentsBefore = await pointerDownIntents(page);

  // 1. OUTWARD: the finger takes the press the END control was handed and drags
  // it left, away from the selection it belongs to.
  const finger = await press(page, region, browserName);
  await finger.down(geometry.probe);
  await finger.move({ x: geometry.probe.x - 60, y: geometry.probe.y });
  await nextFrames(page);
  await expect(
    page.locator("[data-selection-loupe]"),
    "a handle drag began, not a body press"
  ).toBeVisible();

  const outward = await endpoints(page);
  expect(outward.end, "the endpoint the finger did NOT take did not move").toEqual(before.end);
  expect(outward.start!.x, "the grabbed endpoint followed the finger outward").toBeLessThan(
    before.start!.x - 40
  );
  const grown = await liveSelectionText(page);
  expect(grown, "the span grew on the grabbed side only").not.toBe(claim);
  expect(
    grown!.endsWith(claim!),
    `${JSON.stringify({ claim, grown })}: the far endpoint stayed put`
  ).toBe(true);
  expect(
    await pointerDownIntents(page),
    "the press was a handle grab; it did not also reach the gesture as a body press"
  ).toBe(intentsBefore);

  // 2. INWARD: the same finger, still down, comes back the other way. The
  // acquired endpoint follows it in both directions; the other one still does not.
  // It stops 20px short of where it started, deliberately: an endpoint moved all
  // the way onto the fixed one is the crossover case, not this one.
  await finger.move({ x: geometry.probe.x - 20, y: geometry.probe.y });
  await nextFrames(page);
  const inward = await endpoints(page);
  expect(inward.end, "still the other endpoint").toEqual(before.end);
  expect(inward.start!.x, "the grabbed endpoint came back with the finger").toBeGreaterThan(
    outward.start!.x
  );
  await finger.release();
  await nextFrames(page);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  // 3. And the other endpoint, the ordinary way: outward then inward, with the
  // one the student did NOT take holding still through both.
  const beforeEnd = await endpoints(page);
  const end = await grabHandle(page, browserName, "end");
  await end.move(end.origin.x + 40, end.origin.y);
  await nextFrames(page);
  const out = await endpoints(page);
  expect(out.start, "the untouched endpoint did not move").toEqual(beforeEnd.start);
  expect(out.end!.x, "the grabbed endpoint followed the finger outward").toBeGreaterThan(
    beforeEnd.end!.x + 20
  );

  // Back in, but not past the other endpoint: a finger that crosses it hands the
  // drag to the opposite edge (the crossover rule), which is a different case.
  await end.move(end.origin.x + 10, end.origin.y);
  await nextFrames(page);
  const back = await endpoints(page);
  expect(back.start, "still untouched").toEqual(beforeEnd.start);
  expect(back.end!.x, "and it followed the finger inward as well").toBeLessThan(out.end!.x);
  await end.release();
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
});

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
test("a short selection's middle belongs to neither handle, and one press holds one intent", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "of", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  // The shell raises its toolbar after the release and settles it over the next
  // frames; sample geometry only once that is done, so a settle mid-gesture
  // cannot be mistaken for an endpoint moving.
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await nextFrames(page, 4);
  expectOwnedTouchSnapshot(await ownedSelectionSnapshot(page));
  expect(await liveSelectionText(page)).toBe("of");

  // The premise, measured rather than assumed: the two accessible boxes really
  // do overlap over the text — without this the case below would silently be
  // testing a wide selection instead.
  const overlap = await page.evaluate(() => {
    const start = document
      .querySelector('[data-student-selection-handle="start"]')!
      .getBoundingClientRect();
    const end = document
      .querySelector('[data-student-selection-handle="end"]')!
      .getBoundingClientRect();
    return start.right > end.left;
  });
  expect(overlap, "the two 44px targets must overlap for this case to mean anything").toBe(true);

  const before = await endpointGeometry(page);
  expect(before.start).not.toBeNull();
  expect(before.end).not.toBeNull();
  const line = await page.locator("[data-student-selection-line]").first().boundingBox();
  const midpoint = { x: line!.x + line!.width / 2, y: line!.y + line!.height / 2 };
  // The midpoint must be the selection itself: if the shell's toolbar covered
  // it, the press below would be a command on the menu rather than a press on
  // the selected text, and the case would prove nothing.
  const onToolbar = await page.evaluate((point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return !!hit?.closest("[data-sat-selection-toolbar], [data-selection-action-menu]");
  }, midpoint);
  expect(onToolbar, "the midpoint must resolve to the selection, not the toolbar").toBe(false);

  const intentsBefore = await pointerDownIntents(page);

  // 1. The middle: pressed, travelled 40px each way, released. Nothing may
  // move, no loupe may open, and the press may not also begin a new gesture.
  const finger = await press(page, region, browserName);
  await finger.down(midpoint);
  await finger.move({ x: midpoint.x - 40, y: midpoint.y });
  await finger.move({ x: midpoint.x + 40, y: midpoint.y });
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
  await finger.release();
  await nextFrames(page);

  expect(await endpointGeometry(page), "the pressed midpoint moved neither endpoint").toEqual(
    before
  );
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
  expect(
    await pointerDownIntents(page),
    "that press ended at the midpoint; it did not also begin a new gesture"
  ).toBe(intentsBefore);

  // 2. The visible end handle DOES acquire — and once acquired, the finger may
  // travel through the very midpoint that refused it.
  const handle = await grabHandle(page, browserName, "end");
  await handle.move(midpoint.x, midpoint.y);
  await nextFrames(page);
  const dragged = await endpointGeometry(page);
  expect(dragged!.start, "only the acquired endpoint moved").toEqual(before.start);
  expect(dragged!.end!.x, "the acquired endpoint followed the finger").toBeLessThan(before.end!.x);
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();

  // 3. Release over the prose (the finger is AT the midpoint), not over the
  // handle it started on: the loupe is gone within the next frame.
  await handle.release();
  await nextFrames(page, 1);
  expect(
    await page.locator("[data-selection-loupe]").count(),
    "gone within one frame of the release"
  ).toBe(0);
});

/**
 * A mark inside the prose is OUTSIDE the selection (docs/selectionui.md): the
 * tap is dismissed AND consumed in the overlay's capture pass, so the same
 * pointerdown can never begin the next selection — while the mark's own
 * command, its editor, still opens. One press, one intent per layer: the
 * selection layer reads dismissal, the product reads its click.
 */

test("a tap on a mark while a selection rests dismisses the selection and still opens that mark's editor", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  // 1. A mark exists: select the opening words and press a colour.
  await drag(page, region, "Several researchers", browserName, isMobile);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
  await page
    .locator('[data-sat-selection-toolbar="true"]')
    .getByRole("button", { name: /yellow/i })
    .click();
  const mark = region.locator('[data-sat-annotation-control="true"]');
  await expect(mark).toHaveText("Several researchers");

  // 2. The first span still rests after the colour was applied — its handles
  // stay painted. The doc's grammar, in order: a press on the prose OUTSIDE it
  // dismisses that selection and ends there (a prose drag would be consumed
  // the same way, which is why this is a plain tap),
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);
  const prose = await coordinates(region, "built environment");
  const finger = await press(page, region, browserName);
  await finger.down(prose.from);
  await finger.release();
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);

  // — and only the NEXT gesture creates the selection that will rest here.
  await drag(page, region, "built environment", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  // The mark must really be what is under the finger — if the resting
  // selection's toolbar covered it, the tap would be a command on the menu and
  // would prove nothing about a mark.
  const box = (await mark.boundingBox())!;
  const coveredBy = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      const markElement = document.querySelector('[data-sat-annotation-control="true"]')!;
      return markElement === hit || markElement.contains(hit)
        ? null
        : `${hit?.tagName ?? "nothing"}${hit?.closest('[data-sat-selection-toolbar="true"]') ? " (toolbar)" : ""}`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );
  expect(coveredBy, "the mark must be hittable, not behind the toolbar").toBeNull();

  // A real tap: real touch events, so the browser decides whether a click
  // follows the pointerdown the overlay is about to consume.
  await mark.tap();

  // The doc's half: dismissed in capture AND the pointerdown consumed — the
  // gesture's own handler never saw this press, so no hidden new selection
  // began under it (docs/selectionui.md, outside → dismiss + consume).
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(0);
  await expect(page.locator("[data-selection-loupe]")).toHaveCount(0);
  // The diagnostics wipe their buffer on every press INSIDE the root (this tap
  // included), so what remains is exactly what the tap itself produced: no
  // flagged `pointerdown` record means the gesture's own handler never ran.
  expect(await pointerDownIntents(page), "the consumed press reached no gesture").toBe(0);

  // The product's half: the mark's own command survives the consumed press —
  // its editor opens, exactly as it does with no selection on screen.
  await expect(mark).toHaveAttribute("data-sat-annotation-active", "true");
  await expect(page.locator('[data-sat-annotation-edit-controls="true"]')).toBeVisible();
});

test("preview keeps native selection and diagnostics are opt-in", async ({ page }) => {
  await page.goto(`${fixture}?preview=1&debug=0`);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator(passage)).not.toHaveAttribute("data-student-owned-touch-selection");
  expect(
    await page
      .locator(passage)
      .evaluate((root) => getComputedStyle(root).getPropertyValue("-webkit-user-select"))
  ).toBe("text");
  await expect(page.getByRole("region", { name: "Touch selection diagnostics" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__studentTouchSelectionDebug)).toBeUndefined();
});

test("IELTS real layout fallback works when native caret APIs are unavailable", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
  await page.addInitScript(() => {
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);
  await drag(page, surface, "beta gamma", browserName, isMobile);
  await expect(surface.locator("mark")).toHaveText("beta gamma");
  const result = await page.evaluate(() =>
    window.__studentTouchSelectionDebug
      ?.snapshot()
      .surfaces.find((item) => item["surface"] === "IELTS reading:passage:passage-1")
  );
  expect(result).toMatchObject({ captureSucceeded: true, mutationApplied: true });
  expect((result!["events"] as { stage: string }[]).map((event) => event.stage)).toContain(
    "geometry"
  );
});

for (const product of ["IELTS", "SAT"] as const) {
  test(`${product}: recovers from Safari returning a text caret outside the touched passage`, async ({
    page,
    browserName,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "Owned touch input is exercised in the mobile browser projects.");
    // Reproduce the supplied device trace: the standard API is unavailable,
    // and the legacy API returns a connected text node outside the exam root.
    // Layout and the pointer gesture still run through the actual components.
    await page.addInitScript(() => {
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(document, "caretRangeFromPoint", {
        configurable: true,
        value: () => {
          let outside = document.querySelector("[data-outside-caret-fixture]");
          if (!outside) {
            outside = document.createElement("span");
            outside.setAttribute("data-outside-caret-fixture", "");
            outside.setAttribute("aria-hidden", "true");
            outside.textContent = "Unrelated toolbar text";
            document.body.append(outside);
          }
          const range = document.createRange();
          range.setStart(outside.firstChild!, 0);
          range.collapse(true);
          return range;
        },
      });
    });
    await page.goto(product === "SAT" ? `${fixture}?product=sat&ownedTouchSelection=1` : fixture);
    await page
      .getByRole("button", {
        name: product === "SAT" ? /^Highlights & Notes/ : "Highlight",
        exact: product === "IELTS",
      })
      .click();
    const surface = page.locator(
      product === "SAT" ? '[data-sat-annotation-region="stimulus"]' : passage
    );
    const phrase = product === "SAT" ? "Several researchers" : "beta gamma";
    await drag(page, surface, phrase, browserName, isMobile);
    const snapshot = await page.evaluate(() => window.__studentTouchSelectionDebug?.snapshot());
    await info.attach("outside-caret-trace", {
      body: JSON.stringify(snapshot, null, 2),
      contentType: "application/json",
    });
    const selected = snapshot!.surfaces.find(
      (item) =>
        item["surface"] === (product === "SAT" ? "SAT stimulus" : "IELTS reading:passage:passage-1")
    );
    expect(selected).toMatchObject({
      startCaretInsideRoot: true,
      focusCaretInsideRoot: true,
      rangeText: phrase,
      captureSucceeded: true,
      pointerCancelSeen: false,
    });
    if (product === "SAT") {
      await page
        .locator('[data-sat-selection-toolbar="true"]')
        .getByRole("button", { name: /yellow/i })
        .click();
      await expect(surface.locator('[data-sat-highlight="true"]')).toHaveText(phrase);
    } else await expect(surface.locator("mark")).toHaveText(phrase);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
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

test("a 3.5px nudge inside one glyph moves the lens box and leaves the loupe content byte-identical", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');

  // The spec's case at real scale: 3–5px of finger travel that stays inside ONE
  // glyph, with both sample points on the same side of that glyph's midpoint —
  // which is where a caret position changes. The glyph is chosen from the
  // layout, and wide enough that "inside it" is a measurement, not a hope.
  const glyph = await widestGlyph(region, "extreme heat");
  expect(
    glyph.width,
    "the chosen glyph must hold a 3.5px nudge past its midpoint"
  ).toBeGreaterThanOrEqual(9);
  const claim = (await coordinates(region, "extreme heat")).from;
  const p1 = { x: glyph.x + glyph.width / 2 + 0.5, y: glyph.y + glyph.height / 2 };
  expect(
    p1.x - claim.x,
    "the claim move must exceed the 8px tolerance to own the gesture"
  ).toBeGreaterThan(8);
  const p2 = { x: p1.x + 3.5, y: p1.y };

  const finger = await press(page, region, browserName);
  await finger.down(claim);
  await finger.move(p1);
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  const before = await page.evaluate(() => ({
    content: (document.querySelector("[data-selection-loupe-content]") as HTMLElement).style
      .transform,
    box: document.querySelector("[data-selection-loupe]")!.getBoundingClientRect().left,
    revision:
      document.querySelector("[data-selection-loupe-marker]")?.getAttribute("data-snap-revision") ??
      null,
  }));
  const caretBefore = await resolvedCaretAt(page, region, p1);

  await finger.move(p2);
  await nextFrames(page);
  const after = await page.evaluate(() => ({
    content: (document.querySelector("[data-selection-loupe-content]") as HTMLElement).style
      .transform,
    box: document.querySelector("[data-selection-loupe]")!.getBoundingClientRect().left,
    revision:
      document.querySelector("[data-selection-loupe-marker]")?.getAttribute("data-snap-revision") ??
      null,
  }));
  const caretAfter = await resolvedCaretAt(page, region, p2);

  // The premise, from the independent oracle: one glyph, one boundary — the
  // resolved caret is the SAME position before and after the nudge.
  expect(
    caretAfter.index,
    'both points must resolve to the same caret for "inside one glyph" to mean anything'
  ).toBe(caretBefore.index);

  // The CONTENT is discrete: byte-identical transform, no sub-pixel creep, and
  // no snap event that would have said a new character was reached.
  expect(after.content, "loupe content must not move while the caret does not").toBe(
    before.content
  );
  expect(after.revision).toBe(before.revision);

  // The BOX is analog: it travelled the finger's own 3.5px.
  expect(after.box - before.box, "the lens box follows the finger, pixel for pixel").toBeCloseTo(
    3.5,
    1
  );

  await finger.release();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
});

test("a caret crossing is a measurable tick under the default preference — the sampler can see it", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "extreme heat", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  // The contrast half of the reduced-motion proof: without a sampler that CAN
  // see the bounce, "the bounce never appeared" would also describe a sampler
  // that never looked. Grab, cross, and watch from the very next frame.
  const handle = await grabHandle(page, browserName, "end");
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await nextFrames(page);
  const revision0 = await page
    .locator("[data-selection-loupe-marker]")
    .getAttribute("data-snap-revision");

  await handle.move(handle.origin.x + 55, handle.origin.y);
  const seen = await sampleTick(page);

  expect(seen.markerPresent, "the lens is open, so its marker is the tick's stage").toBe(true);
  expect(seen.gripPresent, "the dragged handle carries the other precision indicator").toBe(true);
  expect(Number(seen.revision), "the crossing must have arrived as an event").toBeGreaterThan(
    Number(revision0)
  );
  // Both indicators displaced and sprang back — the tick exists in a real
  // browser, at a magnitude no slow frame could mistake for stillness.
  expect(
    Math.max(...seen.markerDeviations),
    "the marker bounced under the default preference"
  ).toBeGreaterThan(0.001);
  expect(
    Math.max(...seen.gripDeviations),
    "the grip bounced under the default preference"
  ).toBeGreaterThan(0.001);

  await handle.release();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
});

test("reduced motion keeps the snap — event fired, content jumped — while the bounce never starts", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  // Before the document loads, the way the entrance test does it: motion reads
  // the preference once per document, so a student who has it set at the OS
  // level arrives to a document that already knows.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${fixture}?product=sat&ownedTouchSelection=1`);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const region = page.locator('[data-sat-annotation-region="stimulus"]');
  await drag(page, region, "extreme heat", browserName, isMobile);
  await expect(page.locator("[data-student-selection-handle]")).toHaveCount(2);

  const handle = await grabHandle(page, browserName, "end");
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await nextFrames(page);
  const revision0 = await page
    .locator("[data-selection-loupe-marker]")
    .getAttribute("data-snap-revision");
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
  expect(
    Number(seen.revision),
    "reduced motion must not swallow the snap: the caret change still happened"
  ).toBeGreaterThan(Number(revision0));
  expect(
    contentAfter,
    "the lens content still jumped to the new boundary — that is information, not decoration"
  ).not.toBe(contentBefore);
  expect(
    seen.gripWitness,
    "the platform preference reached the grip, as the entrance test proves for the frame"
  ).toBe("reduced");
  // The bounce, and only the bounce: identity on every frame of both indicators,
  // which the companion test above proves this sampler would catch if it ran.
  expect(
    Math.max(...seen.markerDeviations),
    "the marker never started its bounce"
  ).toBeLessThanOrEqual(0.001);
  expect(Math.max(...seen.gripDeviations), "the grip never started its bounce").toBeLessThanOrEqual(
    0.001
  );

  await handle.release();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
});

test("RTL: the caret the lens points at comes from real glyph edges in a right-to-left run", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  // Literals duplicated from e2e/fixtures/touch-selection/main.tsx, which owns
  // these paragraphs: a fixture cannot add passages to the SAT debug route (that
  // is product code), and the IELTS path renders any passage text through the
  // same surface, engine and lens.
  // Fixture paragraphs are placed FIRST (see fixtures/touch-selection/main.tsx):
  // the loupe clone drops container-scoped paragraph spacing, so any preceding
  // paragraph shifts the picture by 8px. Paragraph one has none — source and
  // clone agree exactly here, and every assertion below stays as strict as it
  // is for Latin text.
  const phrase = "هذا نص عربي بسيط عن الطقس والمدينة والحدائق والشوارع";
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);
  // CENTRED, not merely visible: these paragraphs are the pane's last, so
  // `scrollIntoViewIfNeeded` parks them at the bottom — inside the engine's 72px
  // edge band, where a held finger keeps auto-scrolling the passage and nothing
  // can rest long enough to be measured. Centering keeps the gesture clear of
  // both bands, the same rule the handle-drag test states for its positions.
  await page
    .locator("p")
    .filter({ hasText: phrase })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });
  // A fixture cannot put `dir` on a product-rendered <p>, so the RUN is
  // right-to-left: the paragraph and the lens's picture (mounted at the document
  // root, inheriting the same direction) flip together, and every computed
  // `direction` — the engine's edge rule and the oracle's — reads `rtl`.
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });

  const gesture = await drag(page, surface, phrase, browserName, isMobile, { hold: true });
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  // The claim, measured from actual DOM geometry: in RTL the boundary is the
  // SHARED edge the glyphs have — the preceding glyph's LEFT — and the lens's
  // picture sits on it to within the same 1.5px every other case uses.
  const caret = await resolvedCaretAt(page, surface, gesture.finger);
  const pointed = await lensMisalignment(page, caret, passage);
  expect(pointed!.x, "the picture is centred on the resolved caret of the RTL run").toBeLessThan(
    1.5
  );
  expect(pointed!.y, "the picture is centred on the resolved caret of the RTL run").toBeLessThan(
    1.5
  );
  const underTick = await characterUnder(
    page.locator("[data-selection-loupe-source]"),
    await lensCentre(page)
  );
  expect(underTick, "the tick sits on the caret the engine resolved").not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(caret));

  await gesture.finish();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
});

test("Thai: the caret the lens points at comes from real shaped clusters, not code units", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(!isMobile, "The magnifier only exists on the owned touch selection.");
  // Literals duplicated from e2e/fixtures/touch-selection/main.tsx — see the RTL
  // test above for why the fixture owns these paragraphs.
  const phrase = "ภาษาไทย คนในประเทศไทย พูดภาษาไทย ทุกวัน";
  await page.goto(fixture);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const surface = page.locator(passage);
  // Centred for the same reason as the RTL test: clear of the auto-scroll band.
  await page
    .locator("p")
    .filter({ hasText: phrase })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });

  const gesture = await drag(page, surface, phrase, browserName, isMobile, { hold: true });
  await expect(page.locator("[data-selection-loupe]")).toBeVisible();
  await expect.poll(() => loupeFrameScale(page)).toBe(1);
  await nextFrames(page);

  // A Thai cluster's rendered width has nothing to do with how many code units
  // it is made of — the one case `fontSize * characterIndex` cannot survive.
  // Both sides are the browser's own: the engine resolves the position with a
  // `Range`, the oracle measures the same position with `Range`s, and the lens
  // must sit on that boundary to within the shared tolerance.
  const caret = await resolvedCaretAt(page, surface, gesture.finger);
  const pointed = await lensMisalignment(page, caret, passage);
  expect(pointed!.x, "the picture is centred on the resolved caret of the Thai run").toBeLessThan(
    1.5
  );
  expect(pointed!.y, "the picture is centred on the resolved caret of the Thai run").toBeLessThan(
    1.5
  );
  const underTick = await characterUnder(
    page.locator("[data-selection-loupe-source]"),
    await lensCentre(page)
  );
  expect(underTick, "the tick sits on the caret the engine resolved").not.toBeNull();
  expect(underTick!.index).toBe(characterAtCaret(caret));

  await gesture.finish();
  await expect(page.locator("[data-selection-loupe]")).toBeHidden();
});
