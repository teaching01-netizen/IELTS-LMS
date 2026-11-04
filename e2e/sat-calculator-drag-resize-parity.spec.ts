/**
 * SAT calculator drag/resize parity — E2EDD step 2 (failing-first) for
 * docs/plans/2026-11-04-sat-desmos-desktop-mobile-drag-resize-plan.md §2
 * FR-01..FR-05. No mocks of implementation, no unit tests: real Playwright
 * mouse events (down → stepped moves → up) against the dev-only
 * accessibility harness (`/__dev/sat-accessibility?mode=math`, same route
 * the burst spec uses). Desmos readiness is never awaited — geometry never
 * depends on the embed.
 *
 * EXPECTED FAILURES on current code (the point of step 2 — pins for the
 * unification PR, plan §6 step 6 flips them):
 * - 3a compact drag, 3b compact N-edge, 4b compact radiogroup-in-header:
 *   FAIL (compact guards: no grip/headerControls, no resize targets).
 * - 1 desktop drag+persist, 2 desktop SE+min-pin, 4a desktop header
 *   radiogroup, 5 desktop Esc-cancel: PASS (existing contract).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const ROUTE = "/__dev/sat-accessibility?mode=math";
const GEOMETRY_KEY =
  "sat-tool-geometry:v2:debug-schedule:debug-attempt:debug-module:calculator:portrait-v2";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const COMPACT_VIEWPORT = { width: 375, height: 667 };

function calculatorDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Calculator", exact: true });
}

async function openCalculator(page: Page): Promise<Locator> {
  await page.goto(`${ROUTE}&tool=calculator`);
  const panel = calculatorDialog(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

async function boxOf(panel: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await panel.boundingBox();
  if (!box) throw new Error("Calculator panel has no box");
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

async function centerOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Drag target has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real stepped mouse drag (no touchscreen/CDP): down → N moves → up. */
async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 12
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  await page.mouse.up();
}

/** Press-and-hold variant for mid-gesture cancellation (caller releases). */
async function mousePressAndMove(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 8
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
}

function expectDelta(received: number, expected: number, tol: number, what: string): void {
  expect(
    Math.abs(received - expected),
    `${what}: got ${received.toFixed(1)}, want ${expected.toFixed(1)} ±${tol}`
  ).toBeLessThanOrEqual(tol);
}

test("FR-01 desktop header drag is 1:1 and persists across close/reopen", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const panel = await openCalculator(page);
  const start = await boxOf(panel);

  const grip = panel.getByRole("button", { name: /Move Calculator/ });
  await expect(grip).toBeVisible();
  await mouseDrag(page, await centerOf(grip), 120, 40);

  await expect
    .poll(async () => (await boxOf(panel)).x, { timeout: 8_000 })
    .toBeCloseTo(start.x + 120, 0);
  const moved = await boxOf(panel);
  expectDelta(moved.x, start.x + 120, 4, "drag dx is 1:1");
  expectDelta(moved.y, start.y + 40, 4, "drag dy is 1:1");

  // Release persists: close + reopen restores the committed rect.
  await panel.getByRole("button", { name: "Close Calculator", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(panel).toBeVisible();
  const restored = await boxOf(panel);
  expectDelta(restored.x, moved.x, 4, "persisted x survives close/reopen");
  expectDelta(restored.y, moved.y, 4, "persisted y survives close/reopen");
  expectDelta(restored.w, moved.w, 4, "persisted w survives close/reopen");
  expectDelta(restored.h, moved.h, 4, "persisted h survives close/reopen");
});

test("FR-02 desktop SE resize is 1:1 and pins at the minimum", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const panel = await openCalculator(page);

  const se = panel.locator('[data-sat-resize-handle="se"]');
  await expect(se).toBeVisible();
  const start = await boxOf(panel);
  await mouseDrag(page, await centerOf(se), 80, 60);

  await expect
    .poll(async () => (await boxOf(panel)).w, { timeout: 8_000 })
    .toBeCloseTo(start.w + 80, 0);
  const grown = await boxOf(panel);
  expectDelta(grown.w, start.w + 80, 5, "SE resize dw is 1:1");
  expectDelta(grown.h, start.h + 60, 5, "SE resize dh is 1:1");

  // Minimum pin: a huge inward drag clamps (no collapse/inversion), and a
  // second inward push changes nothing (stability = the pin proof).
  const corner = { x: grown.x + grown.w - 22, y: grown.y + grown.h - 22 };
  await mouseDrag(page, corner, -500, -500);
  const pinned = await boxOf(panel);
  expect(pinned.w, `no width collapse (pinned at ${pinned.w.toFixed(0)})`).toBeGreaterThanOrEqual(380);
  expect(pinned.h, `no height collapse (pinned at ${pinned.h.toFixed(0)})`).toBeGreaterThanOrEqual(380);
  test.info().annotations.push({
    type: "min-pin",
    description: `pinned at ${pinned.w.toFixed(0)}x${pinned.h.toFixed(0)}`,
  });
  const corner2 = { x: pinned.x + pinned.w - 22, y: pinned.y + pinned.h - 22 };
  await mouseDrag(page, corner2, -200, -200);
  const repinned = await boxOf(panel);
  expectDelta(repinned.w, pinned.w, 2, "min width is stable under further inward drag");
  expectDelta(repinned.h, pinned.h, 2, "min height is stable under further inward drag");
});

test("FR-03a compact sheet drag moves y with width centered (NEW parity)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  const panel = await openCalculator(page);
  await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");

  const start = await boxOf(panel);
  expectDelta(start.x, (COMPACT_VIEWPORT.width - start.w) / 2, 4, "sheet starts centered");

  // Draggable y, recentered x, fixed width (plan §5 compact trace).
  const header = panel.locator("[data-sat-tool-compact-header]");
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("Compact header has no box");
  await mouseDrag(page, { x: headerBox.x + 20, y: headerBox.y + headerBox.height / 2 }, 0, 60);

  await expect
    .poll(async () => (await boxOf(panel)).y, { timeout: 8_000 })
    .toBeCloseTo(start.y + 60, 0);
  const moved = await boxOf(panel);
  expectDelta(moved.y, start.y + 60, 4, "sheet drag dy moves y 1:1");
  expectDelta(moved.x, (COMPACT_VIEWPORT.width - moved.w) / 2, 4, "sheet x recenters");
  expectDelta(moved.w, start.w, 4, "sheet width stays fixed while dragging");
});

test("FR-03b compact N-edge height resize (NEW parity)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  const panel = await openCalculator(page);
  await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");

  const nEdge = panel.locator('[data-sat-resize-edge="n"]');
  await expect(nEdge, "sheet exposes the N height edge").toHaveCount(1, { timeout: 5_000 });

  const start = await boxOf(panel);
  await mouseDrag(page, await centerOf(nEdge), 0, 40);

  await expect
    .poll(async () => (await boxOf(panel)).h, { timeout: 8_000 })
    .toBeCloseTo(start.h - 40, 0);
  const resized = await boxOf(panel);
  expectDelta(resized.h, start.h - 40, 5, "N-edge drag shrinks height 1:1");
  expectDelta(resized.y, start.y + 40, 5, "N-edge drag moves top edge down");
  expectDelta(resized.w, start.w, 4, "N-edge resize keeps width fixed");
  expectDelta(resized.x, (COMPACT_VIEWPORT.width - resized.w) / 2, 4, "sheet stays centered");
});

test("FR-04a desktop mode radiogroup lives in the header", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const panel = await openCalculator(page);

  const groups = panel.getByRole("radiogroup", { name: "Calculator type" });
  await expect(groups, "exactly one mode selector").toHaveCount(1);
  await expect(
    panel.locator('[data-sat-tool-header] [role="radiogroup"][aria-label="Calculator type"]'),
    "mode selector renders in the header slot"
  ).toHaveCount(1);
  await expect(panel.getByRole("radio", { name: "Graphing" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Scientific" })).toBeVisible();
});

test("FR-04b compact mode radiogroup lives in the header (NEW parity)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  const panel = await openCalculator(page);
  await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");

  const groups = panel.getByRole("radiogroup", { name: "Calculator type" });
  await expect(groups, "exactly one mode selector").toHaveCount(1);
  await expect(
    panel.locator('[data-sat-tool-compact-header] [role="radiogroup"]'),
    "mode selector renders in the compact header slot (not the body strip)"
  ).toHaveCount(1, { timeout: 5_000 });
});

test("FR-05 Esc cancels a live desktop drag without persist or close", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const panel = await openCalculator(page);
  const start = await boxOf(panel);
  const storedBefore = await page.evaluate((key) => window.localStorage.getItem(key), GEOMETRY_KEY);

  const grip = panel.getByRole("button", { name: /Move Calculator/ });
  await mousePressAndMove(page, await centerOf(grip), 80, 30);
  // LIVE evidence before cancelling: the window tracks the pointer.
  await expect
    .poll(async () => (await boxOf(panel)).x, { timeout: 8_000 })
    .toBeGreaterThan(start.x + 10);

  await page.keyboard.press("Escape");
  await page.mouse.up();

  const restored = await boxOf(panel);
  expectDelta(restored.x, start.x, 3, "Esc restores origin x");
  expectDelta(restored.y, start.y, 3, "Esc restores origin y");
  expectDelta(restored.w, start.w, 3, "Esc restores origin w");
  expectDelta(restored.h, start.h, 3, "Esc restores origin h");
  await expect(panel, "Esc never closes the tool").toBeVisible();
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), GEOMETRY_KEY),
    "cancelled gesture persists nothing"
  ).toBe(storedBefore);
});
