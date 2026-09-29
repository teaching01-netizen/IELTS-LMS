import { expect, test, type Page } from "@playwright/test";

/**
 * One measured layout, four consumers.
 *
 * The policy itself is pinned by the resolver's unit matrix (two dozen widths,
 * text sizes and ratios, in milliseconds); what only a browser can show is that
 * the REAL panes obey it — that the grid, the width control, the Notes column,
 * Display and the auto-fit all hear the same answer — and that nothing the
 * student has done is lost when that answer changes. So this file stays narrow on
 * purpose: one case per consumer, plus the state-preservation case that is the
 * whole reason the reflow is a layout change rather than a remount.
 *
 * The dev harness (`/__dev/sat-accessibility`) is the exam itself: same shell,
 * same workspace, same panes.
 */

const HARNESS = "/__dev/sat-accessibility";

async function openHarness(
  page: Page,
  viewport: { width: number; height: number },
  options: { query?: string } = {},
) {
  await page.setViewportSize(viewport);
  await page.goto(`${HARNESS}${options.query ? `?${options.query}` : ""}`);
  await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 15_000 });
  // The workspace registers itself on mount; wait for the measurement to land
  // rather than racing the first frame.
  await expect(page.locator("[data-sat-reading-layout-measured]")).toHaveAttribute(
    "data-sat-reading-layout-measured",
    "true",
  );
}

const workspace = (page: Page) => page.locator("[data-sat-reading-layout]");
const splitHandle = (page: Page) => page.locator("[data-sat-reading-split-handle]");

async function expectLayout(page: Page, presentation: "single" | "split" | "stacked") {
  await expect(workspace(page)).toHaveAttribute("data-sat-reading-layout", presentation);
}

async function openDisplay(page: Page) {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  return page.getByRole("dialog", { name: "Display" });
}

async function stepTextSize(page: Page, direction: "Increase" | "Decrease", steps: number) {
  for (let step = 0; step < steps; step += 1) {
    await page.getByRole("button", { name: `${direction} text size` }).click();
  }
}

/**
 * The exam is one viewport with its own scrolling panes, so `body.scrollWidth`
 * proves nothing here — the workspace is the surface that must never scroll
 * sideways, and the panes are what must stay inside it.
 */
async function expectNoSatHorizontalOverflow(page: Page) {
  const result = await page.locator("[data-sat-reading-layout]").evaluate((element) => {
    const workspaceBox = element.getBoundingClientRect();
    const panes = Array.from(
      element.querySelectorAll<HTMLElement>("[data-sat-passage-scroll], [data-sat-question-scroll]"),
    ).map((pane) => ({
      scrollWidth: pane.scrollWidth,
      clientWidth: pane.clientWidth,
      right: pane.getBoundingClientRect().right,
    }));
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      workspaceRight: workspaceBox.right,
      panes,
    };
  });
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  for (const pane of result.panes) {
    expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
    expect(pane.right).toBeLessThanOrEqual(result.workspaceRight + 1);
  }
}

/** The app's own selection gesture: a real range plus the pointerup that ends it. */
async function selectPassageText(page: Page, requested: string) {
  await page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.nodeValue ?? "").includes(value)) node = walker.nextNode();
    if (!node) throw new Error(`Could not find passage text: ${value}`);
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

async function armHighlights(page: Page) {
  const toggle = page.getByRole("button", { name: /^Highlights & Notes/ });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

/**
 * A reading pane's own reading position.
 *
 * Height against height, so this holds under screen zoom whether an engine
 * reports lengths scaled or not, and read off the pane the student is actually
 * scrolling rather than the page around it.
 */
async function paneScrollTop(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((pane) => pane.scrollTop);
}

async function paneScrolls(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((pane) => pane.scrollHeight > pane.clientHeight);
}

test.describe("SAT adaptive reading layout", () => {
  test.describe.configure({ timeout: 90_000 });

  test("stacks a phone with no width control and nothing scrolling sideways", async ({ page }) => {
    await openHarness(page, { width: 390, height: 844 });

    await expectLayout(page, "stacked");
    await expect(workspace(page)).toHaveAttribute(
      "data-sat-reading-layout-reason",
      "insufficient-pane-width",
    );
    // An unusable slider is absent, not merely hidden.
    await expect(splitHandle(page)).toHaveCount(0);
    // Both panes are still there, one above the other.
    await expect(page.locator("[data-sat-passage-scroll]")).toBeVisible();
    await expect(page.locator("[data-sat-question-scroll]")).toBeVisible();
    await expectNoSatHorizontalOverflow(page);
  });

  test("splits a tablet, and reflows to stacked when 200% text needs more than half the width", async ({
    page,
  }) => {
    await openHarness(page, { width: 1024, height: 768 });
    await expectLayout(page, "split");
    await expect(splitHandle(page)).toBeVisible();

    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();

    // 1024px in two panes is 511px each; 200% text needs 720px before a pane is
    // worth reading, so the panes stack instead of shrinking the type.
    await expectLayout(page, "stacked");
    await expect(splitHandle(page)).toHaveCount(0);
    // The answer is still reachable at the size the student asked for.
    await expect(page.getByRole("radio", { name: /Option A/ })).toBeVisible();
    await expectNoSatHorizontalOverflow(page);

    // Back down: the panes fit side by side again, with the width control.
    await openDisplay(page);
    await stepTextSize(page, "Decrease", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "split");
    await expect(splitHandle(page)).toBeVisible();
  });

  test("never rewrites the saved split ratio, and restores it when the panes fit again", async ({
    page,
  }) => {
    await openHarness(page, { width: 1024, height: 768 });
    const handle = splitHandle(page);
    await handle.focus();
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "62");

    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "stacked");

    await openDisplay(page);
    await stepTextSize(page, "Decrease", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();

    await expectLayout(page, "split");
    // The student's 62/38 is back, untouched by anything the reflow did.
    await expect(splitHandle(page)).toHaveAttribute("aria-valuenow", "62");
  });

  test("moves Display from a panel to a sheet, keeping the panel and the student's focus", async ({
    page,
  }) => {
    await openHarness(page, { width: 1440, height: 900 });
    await expectLayout(page, "split");
    const dialog = await openDisplay(page);
    await expect(dialog).toHaveAttribute("data-sat-popover-panel", "anchored");
    // Mark the node: the presentation may change, the panel may not.
    await dialog.evaluate((element) => element.setAttribute("data-test-panel-identity", "kept"));

    const increase = page.getByRole("button", { name: "Increase text size" });
    await increase.focus();
    // Driven from the keyboard on purpose: WebKit does not focus a control on
    // mouse press (the press blurs to <body>), so a click would measure Safari's
    // pointer focus rule instead of the shell's. Keyboarding the same control is
    // the case where "the panel changed how it presents itself under me" is the
    // only thing that could move focus.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    // 130% text raises the readable budget past what the anchored 320px panel
    // would leave of the question, so it presents as a sheet instead.
    await expect(dialog).toHaveAttribute("data-sat-popover-panel", "modal");
    await expect(dialog).toHaveAttribute("data-test-panel-identity", "kept");
    // The open lifecycle is the panel's, not its presentation's: focus stays on
    // the control the student was adjusting.
    await expect(increase).toBeFocused();

    await page.getByRole("button", { name: "Close display settings" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Display", exact: true })).toBeFocused();
  });

  test("places the Notes column from the same decision as the panes", async ({ page }) => {
    await openHarness(page, { width: 1024, height: 768 });
    await page.locator("[data-sat-notes-disclosure]").click();
    await expect(page.getByRole("complementary", { name: "Notes" })).toBeVisible();
    await expect(workspace(page)).toHaveAttribute("data-sat-notes-placement", "column");

    // Display is an exclusive exam surface, so it takes the column with it while
    // it is open (the shell's contract, unchanged here); the question is what the
    // column does with THIS layout when it comes back.
    await page.locator("[data-sat-notes-disclosure]").click();
    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "stacked");

    await page.locator("[data-sat-notes-disclosure]").click();
    // Stacked panes have no edge for a column to stand on: the notes stack with
    // them, still in the exam rather than over it.
    await expect(workspace(page)).toHaveAttribute("data-sat-notes-placement", "row");
    await expect(page.getByRole("complementary", { name: "Notes" })).toBeVisible();
    await expectNoSatHorizontalOverflow(page);
  });

  test("keeps the student's work and their reading position across the reflow", async ({ page }) => {
    // A passage longer than any pane, so "did the reflow jump back to the top?"
    // is a question the page can actually answer.
    // Both panes are longer than the room they have (`?long=3`), so "did the
    // reflow put me back at the top?" is a question this page can answer about
    // the passage AND the question, not just about whichever one had enough text.
    await openHarness(page, { width: 1024, height: 768 }, { query: "long=3" });
    await expectLayout(page, "split");

    // An answer, a crossed-out choice, a highlight, and a written note. The
    // answer is chosen through its own card, the way a student chooses it.
    await page
      .locator("label", { hasText: "All cities experience identical temperature changes" })
      .click();
    await expect(page.getByRole("radio", { name: /Option B/ })).toBeChecked();
    await page.getByRole("button", { name: "Turn on cross-out mode" }).click();
    await page.getByRole("button", { name: "Eliminate option D" }).click();
    await armHighlights(page);
    await selectPassageText(page, "urban tree cover");
    await page
      .getByRole("toolbar", { name: "Selected text actions" })
      .getByRole("button", { name: "Highlight Yellow" })
      .click();
    await page.locator("[data-sat-notes-disclosure]").click();
    await page.getByRole("button", { name: "Add question note" }).click();
    const noteField = page.getByRole("textbox", { name: "This question" });
    await noteField.fill("Compare canopy density with paving.");
    await noteField.blur();

    // The nodes themselves are tagged: identity, not just presence, is what the
    // reflow must preserve.
    await page.evaluate(() => {
      document
        .querySelector("[data-sat-passage-scroll]")
        ?.setAttribute("data-test-pane-identity", "passage");
      document
        .querySelector("[data-sat-question-scroll]")
        ?.setAttribute("data-test-pane-identity", "question");
    });
    for (const selector of ["[data-sat-passage-scroll]", "[data-sat-question-scroll]"]) {
      expect(await paneScrolls(page, selector), `${selector} has somewhere to have been`).toBe(true);
      await page.locator(selector).evaluate((pane) => pane.scrollBy(0, 240));
      expect(await paneScrollTop(page, selector), `${selector} scrolled`).toBeGreaterThan(0);
    }

    const assertWorkSurvived = async (stage: string) => {
      await expect(page.getByRole("radio", { name: /Option B/ }), `${stage}: answer`).toBeChecked();
      await expect(page.locator('[data-sat-elimination-line="true"]'), `${stage}: cross-out`).toHaveCount(1);
      await expect(page.locator('[data-sat-highlight-color="yellow"]'), `${stage}: highlight`).toHaveText(
        /urban tree cover/i,
      );
      await expect(
        page.locator('[data-sat-highlight="true"]'),
        `${stage}: the mark is still painted`,
      ).toHaveCount(1);
      await expect(
        page.locator('[data-sat-passage-scroll][data-test-pane-identity="passage"]'),
        `${stage}: same passage pane`,
      ).toHaveCount(1);
      await expect(
        page.locator('[data-sat-question-scroll][data-test-pane-identity="question"]'),
        `${stage}: same question pane`,
      ).toHaveCount(1);
      await expect(
        page.getByRole("textbox", { name: "This question" }),
        `${stage}: note text`,
      ).toHaveValue("Compare canopy density with paving.");
      // Same DOM is what makes this hold: re-wrapping moves the offset, but the
      // student must not be back at the beginning of either pane.
      for (const selector of ["[data-sat-passage-scroll]", "[data-sat-question-scroll]"]) {
        expect(await paneScrollTop(page, selector), `${stage}: ${selector} position`).toBeGreaterThan(0);
      }
    };

    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "stacked");
    // Display is an exclusive surface, so the column closed while it was open;
    // the note it holds is the exam's, not the panel's, and comes back with it.
    await page.locator("[data-sat-notes-disclosure]").click();
    await assertWorkSurvived("stacked");

    await openDisplay(page);
    await stepTextSize(page, "Decrease", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "split");
    await page.locator("[data-sat-notes-disclosure]").click();
    await assertWorkSurvived("split again");
  });

  test("wraps a token no pane can fit instead of widening the pane", async ({ page }) => {
    // The reading surface owns its wrap rule, and `anywhere` is the value that
    // lowers min-content width — so the one long URL in the passage breaks where
    // it stands. Were it not so, the pane would grow a horizontal scrollbar at
    // best and push the exam wider at worst; either way the student's reading
    // column would stop being the column the layout promised.
    await openHarness(page, { width: 1024, height: 768 }, { query: "unbreakable=1" });
    await expectLayout(page, "split");
    await expectNoSatHorizontalOverflow(page);

    // The same token at 200% text, where the pane can spare even less room.
    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();
    await expectLayout(page, "stacked");
    await expectNoSatHorizontalOverflow(page);
  });

  test("does not let the automatic zoom fit undo the reading reflow", async ({ page }) => {
    // A passage no pane can hold, with auto-fit on, opened on a phone: the panes
    // have already stacked to give the student readable text, so the automatic
    // pass answers "no automatic zoom" instead of shrinking the exam.
    await openHarness(page, { width: 390, height: 844 }, { query: "long=2&autoFit=1" });
    await expectLayout(page, "stacked");
    await expect(page.locator("[data-sat-fit-probing]")).toHaveAttribute(
      "data-sat-fit-probing",
      "false",
    );
    await expect(page.locator("[data-sat-screen-zoom]")).toHaveAttribute("data-sat-screen-zoom", "1");

    // The student's own request still fits the exam whenever they ask for it.
    const dialog = await openDisplay(page);
    await dialog.getByRole("button", { name: "Fit to screen" }).click();
    await expect
      .poll(async () =>
        Number(await page.locator("[data-sat-screen-zoom]").getAttribute("data-sat-screen-zoom")),
      )
      .toBeLessThan(1);
  });

  test("keeps a wide desktop side by side at 150% text", async ({ page }) => {
    // The other half of the 200% case: a text size that raises the budget without
    // exhausting it. 1440px in two panes is 719px each, and 150% text needs 540 —
    // so the layout must NOT reflow just because the text grew.
    await openHarness(page, { width: 1440, height: 900 });
    await expectLayout(page, "split");

    await openDisplay(page);
    await stepTextSize(page, "Increase", 3); // 100% -> 150%
    await page.getByRole("button", { name: "Close display settings" }).click();

    await expectLayout(page, "split");
    await expect(splitHandle(page)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Option A/ })).toBeVisible();
    await expectNoSatHorizontalOverflow(page);
  });

  test("keeps the student's place through a rotation, both ways", async ({ page }) => {
    // A phone held upright is stacked; on its side it is wide enough for two panes.
    // Rotating is therefore a reflow in both directions, and the one thing it must
    // never do is lose the answer, the mark, or either pane's reading position.
    await openHarness(page, { width: 390, height: 844 }, { query: "long=3" });
    await expectLayout(page, "stacked");

    await page
      .locator("label", { hasText: "All cities experience identical temperature changes" })
      .click();
    await expect(page.getByRole("radio", { name: /Option B/ })).toBeChecked();
    await armHighlights(page);
    await selectPassageText(page, "urban tree cover");
    await page
      .getByRole("toolbar", { name: "Selected text actions" })
      .getByRole("button", { name: "Highlight Yellow" })
      .click();

    // Tagged so "the same pane" is asserted as identity rather than as presence.
    await page.evaluate(() => {
      document
        .querySelector("[data-sat-passage-scroll]")
        ?.setAttribute("data-test-pane-identity", "passage");
      document
        .querySelector("[data-sat-question-scroll]")
        ?.setAttribute("data-test-pane-identity", "question");
    });
    await page.locator("[data-sat-passage-scroll]").evaluate((pane) => pane.scrollBy(0, 200));

    const assertWorkSurvived = async (stage: string) => {
      await expect(page.getByRole("radio", { name: /Option B/ }), `${stage}: answer`).toBeChecked();
      await expect(
        page.locator('[data-sat-highlight-color="yellow"]'),
        `${stage}: highlight`,
      ).toHaveText(/urban tree cover/i);
      await expect(
        page.locator('[data-sat-passage-scroll][data-test-pane-identity="passage"]'),
        `${stage}: same passage pane`,
      ).toHaveCount(1);
      await expect(
        page.locator('[data-sat-question-scroll][data-test-pane-identity="question"]'),
        `${stage}: same question pane`,
      ).toHaveCount(1);
    };

    // Landscape: 844px is two readable panes.
    await page.setViewportSize({ width: 844, height: 390 });
    await expectLayout(page, "split");
    await assertWorkSurvived("landscape");
    await expectNoSatHorizontalOverflow(page);

    // And back, which is the harder direction: the panes have to stack again
    // without the student losing anything they did while they were side by side.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectLayout(page, "stacked");
    await assertWorkSurvived("upright again");
    expect(await paneScrollTop(page, "[data-sat-passage-scroll]")).toBeGreaterThan(0);
    await expectNoSatHorizontalOverflow(page);
  });

  test("keeps an equation intact and inside its pane at 200% text", async ({ page }) => {
    // A math question is one pane with an expression in it (`?mode=math`), and an
    // expression is exactly the content the prose wrap rule must not be allowed to
    // break: the exemption makes the equation keep its shape, so the question is
    // whether it still fits the pane the student has at 200% text.
    await openHarness(page, { width: 1024, height: 768 }, { query: "mode=math" });
    await expectLayout(page, "single");

    await openDisplay(page);
    await stepTextSize(page, "Increase", 5);
    await page.getByRole("button", { name: "Close display settings" }).click();

    await expectLayout(page, "single");
    const equation = page.locator('[role="math"]').first();
    await expect(equation).toBeVisible();
    const [pane, equationBox] = await Promise.all([
      page.locator("[data-sat-question-scroll]").boundingBox(),
      equation.boundingBox(),
    ]);
    expect(pane).not.toBeNull();
    expect(equationBox).not.toBeNull();
    expect(equationBox!.x).toBeGreaterThanOrEqual(pane!.x - 1);
    expect(equationBox!.x + equationBox!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1);
    await expectNoSatHorizontalOverflow(page);
  });

  test("still fits the exam automatically when the reading layout is split", async ({ page }) => {
    // The same oversized passage on a desktop: nothing about the reading layout
    // replaces the fit where a fit is what the student needs.
    await openHarness(page, { width: 1440, height: 900 }, { query: "long=2&autoFit=1" });
    await expectLayout(page, "split");
    await expect
      .poll(async () =>
        Number(await page.locator("[data-sat-screen-zoom]").getAttribute("data-sat-screen-zoom")),
      )
      .toBeLessThan(1);
  });
});
