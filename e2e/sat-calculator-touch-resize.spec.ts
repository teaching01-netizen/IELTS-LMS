/**
 * SAT calculator touch resize — iPad / mobile first.
 *
 * Executes docs/plans/2026-11-01-sat-calculator-touch-resize-e2e-plan.md.
 * The product promise under test: on a touch screen every resize target lives
 * in a band OUTSIDE the calculator window, so Desmos keeps all of its pixels,
 * while a 4px bracket tells the student exactly where to grab.
 *
 * Invariant IDs (I1–I16) are quoted in the test names so a failure points back
 * at the plan.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  backgroundAt,
  bandProbe,
  boxOf,
  brackets,
  centreWindow,
  calculator,
  coarsePointer,
  contrastRatio,
  drag,
  EDGE_NODE,
  expectCompactSheet,
  GEOMETRY_KEY,
  HANDLE_NODE,
  hitAt,
  hitScan,
  moveWindowBy,
  normalizeColor,
  openCalculator,
  readGeometry,
  tap,
  waitForDesmos,
  type Box,
} from "./helpers/satCalculatorTouch";

type Kind = "ipad" | "split" | "phone" | "desktop";

function kindOf(project: string): Kind {
  if (project.startsWith("desktop")) return "desktop";
  if (project.startsWith("ipad-split")) return "split";
  if (project.startsWith("ipad")) return "ipad";
  return "phone";
}

const project = () => test.info().project.name;
const kind = () => kindOf(project());
const chromiumProject = () => project().endsWith("-chromium");

const DIRECTIONS = [
  { edge: "n", dx: 0, dy: -1 },
  { edge: "s", dx: 0, dy: 1 },
  { edge: "e", dx: 1, dy: 0 },
  { edge: "w", dx: -1, dy: 0 },
  { edge: "ne", dx: 1, dy: -1 },
  { edge: "nw", dx: -1, dy: -1 },
  { edge: "sw", dx: -1, dy: 1 },
  { edge: "se", dx: 1, dy: 1 },
] as const;

type Edge = (typeof DIRECTIONS)[number]["edge"];

function bandPoint(box: Box, edge: Edge, out = 10): { x: number; y: number } {
  const { x, y, w, h } = box;
  switch (edge) {
    case "n":
      return { x: x + w / 2, y: y - out };
    case "s":
      return { x: x + w / 2, y: y + h + out };
    case "e":
      return { x: x + w + out, y: y + h / 2 };
    case "w":
      return { x: x - out, y: y + h / 2 };
    case "ne":
      return { x: x + w + out, y: y - out };
    case "nw":
      return { x: x - out, y: y - out };
    case "sw":
      return { x: x - out, y: y + h + out };
    case "se":
      return { x: x + w + out, y: y + h + out };
  }
}

/** Rect after an outward resize of `d` px on `edge` (d < 0 grows inward). */
function resizeExpectation(box: Box, edge: Edge, d: number): Box {
  const next = { ...box };
  if (edge.includes("e")) next.w += d;
  if (edge.includes("w")) {
    next.x -= d;
    next.w += d;
  }
  if (edge.includes("s")) next.h += d;
  if (edge.includes("n")) {
    next.y -= d;
    next.h += d;
  }
  return next;
}

function near(actual: number, expected: number, label: string, tol = 1.5) {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${Math.round(expected)} ±${tol}, got ${Math.round(actual)}`
  ).toBeLessThanOrEqual(tol);
}

async function expectRect(actual: Box, expected: Box, label = "rect") {
  near(actual.x, expected.x, `${label}.x`);
  near(actual.y, expected.y, `${label}.y`);
  near(actual.w, expected.w, `${label}.w`);
  near(actual.h, expected.h, `${label}.h`);
}

async function panelIframe(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return boxOf(page.locator('iframe[data-desmos-mode="graphing"]'));
}

async function viewport(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

/* ── Gate ───────────────────────────────────────────────────────────────── */

test.describe("harness gate", () => {
  test("project really is a coarse-pointer touch device with a resizable window", async ({
    page,
  }) => {
    test.skip(kind() === "desktop", "Desktop is the fine-pointer guard.");
    test.skip(kind() === "phone" || kind() === "split", "Compact sheet has no resize band.");
    const panel = await openCalculator(page);
    expect(await coarsePointer(page), "pointer: coarse drives the whole touch design").toBe(true);
    await expect(panel).toHaveAttribute("data-sat-tool-resizable", "true");
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "floating");
    // A silent failure here would make every assertion below test the desktop CSS.
    await expect(panel.locator(EDGE_NODE)).toHaveCount(7);
    await expect(panel.locator(HANDLE_NODE)).toHaveCount(1);
  });
});

/* ── A. Interior is never captured (I1, I15) ────────────────────────────── */

test.describe("A. interior is never captured", () => {
  test("A1/A2/A6 graphing and scientific: zero interior capture", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const scans: Record<string, unknown> = {};
    scans["graphing"] = (await hitScan(page, panel, { step: 4, ringStep: 2 })).slice(0, 8);
    await page.getByRole("radio", { name: "Scientific", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Scientific", exact: true })).toBeChecked();
    scans["scientific"] = (await hitScan(page, panel, { step: 4, ringStep: 2 })).slice(0, 8);
    expect(scans, `resize layer captured interior points: ${JSON.stringify(scans)}`).toEqual({
      graphing: [],
      scientific: [],
    });
    const box = await boxOf(panel);
    for (const [label, x, y] of [
      ["top-left", box.x + 6, box.y + 6],
      ["bottom-left", box.x + 6, box.y + box.h - 6],
      ["bottom-right", box.x + box.w - 6, box.y + box.h - 6],
      ["close", box.x + box.w - 6, box.y + 6],
    ] as const) {
      const hit = await hitAt(page, x, y);
      expect(hit.resize, `${label} resolves to a resize node`).toBeNull();
    }
  });

  test("A3/A4 zero interior capture at the minimum and maximum size", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const size = await viewport(page);
    await centreWindow(page, panel, { w: 400, h: 560 });
    let box = await boxOf(panel);
    // Maximum.
    let from = bandPoint(box, "se", 10);
    await drag(page, from, { x: from.x + 1900, y: from.y + 1900 });
    const max = await boxOf(panel);
    expect(max.w, "reached the max width").toBeGreaterThan(size.w - 80);
    expect(await hitScan(page, panel, { step: 4, ringStep: 2 }), "max size scan").toEqual([]);
    // Minimum.
    from = bandPoint(max, "se", 10);
    await drag(page, from, { x: max.x + 20, y: max.y + 20 });
    box = await boxOf(panel);
    near(box.w, 400, "min width");
    near(box.h, 400, "min height");
    expect(await hitScan(page, panel, { step: 4, ringStep: 2 }), "min size scan").toEqual([]);
  });

  test("A5 zero interior capture at Display 50 / 150 / 200%", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    await openCalculator(page);
    for (const zoom of [0.5, 1.5, 2]) {
      // At 810px portrait the window covers the toolbar row, so zoom while it
      // is closed and reopen at the new Display setting.
      await page.getByRole("button", { name: "Close Calculator", exact: true }).click();
      await displayZoom(page, zoom);
      await page.getByRole("button", { name: "Calculator", exact: true }).click();
      const panel = calculator(page);
      await expect(panel).toBeVisible();
      const offenders = await hitScan(page, panel, { step: 5, ringStep: 3 });
      expect(offenders, `display ${zoom * 100}%: ${JSON.stringify(offenders.slice(0, 4))}`).toEqual([]);
    }
  });
});

/* ── B. Eight directions resize from outside (I2, I4) ───────────────────── */

test.describe("B. eight directions from the outside band", () => {
  test("B1 every direction resizes out and back, opposite edge fixed", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    for (const direction of DIRECTIONS) {
      await test.step(direction.edge, async () => {
        await centreWindow(page, panel, { w: 400, h: 560 });
        for (const distance of [40, -40]) {
          const start = await boxOf(panel);
          const from = bandPoint(start, direction.edge, 10);
          const to = {
            x: from.x + direction.dx * distance,
            y: from.y + direction.dy * distance,
          };
          let mid: string | null = null;
          await drag(page, from, to, {
            mid: async () => {
              mid = await panel.getAttribute("data-sat-resizing");
            },
          });
          expect(mid, `${direction.edge} ${distance}: data-sat-resizing during drag`).toBe("true");
          await expect(panel).not.toHaveAttribute("data-sat-resizing", "true");
          const expected = resizeExpectation(start, direction.edge, distance);
          await expectRect(await boxOf(panel), expected, `${direction.edge} ${distance}`);
          // The opposite edge must not have moved (it is encoded in the rect,
          // this spells it out for the failure message).
          const now = await boxOf(panel);
          if (direction.edge === "e" || direction.edge === "ne" || direction.edge === "se")
            near(now.x, start.x, `${direction.edge}: west edge fixed`);
          if (direction.edge === "w" || direction.edge === "nw" || direction.edge === "sw")
            near(now.x + now.w, start.x + start.w, `${direction.edge}: east edge fixed`);
          if (direction.edge === "n" || direction.edge === "ne" || direction.edge === "nw")
            near(now.y + now.h, start.y + start.h, `${direction.edge}: south edge fixed`);
          if (direction.edge === "s" || direction.edge === "se" || direction.edge === "sw")
            near(now.y, start.y, `${direction.edge}: north edge fixed`);
        }
      });
    }
  });

  test("B2 each L-shaped corner arm still resizes both axes", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    for (const edge of ["ne", "nw", "sw", "se"] as const) {
      await test.step(edge, async () => {
        const box = await centreWindow(page, panel, { w: 400, h: 560 });
        const probe = await bandProbe(page, box);
        expect(probe[edge].resize, `${edge} diagonal probe`).toBe(edge);
        // Both ends of both arms belong to the same corner.
        const { x, y, w, h } = box;
        const points: { x: number; y: number; label: string }[] =
          edge === "ne"
            ? [
                { x: x + w + 10, y: y + 20, label: "east arm, inside end" },
                { x: x + w - 20, y: y - 10, label: "north arm, inside end" },
                { x: x + w + 10, y: y - 10, label: "diagonal" },
              ]
            : edge === "nw"
              ? [
                  { x: x - 10, y: y + 20, label: "west arm, inside end" },
                  { x: x + 20, y: y - 10, label: "north arm, inside end" },
                  { x: x - 10, y: y - 10, label: "diagonal" },
                ]
              : edge === "sw"
                ? [
                    { x: x - 10, y: y + h - 20, label: "west arm, inside end" },
                    { x: x + 20, y: y + h + 10, label: "south arm, inside end" },
                    { x: x - 10, y: y + h + 10, label: "diagonal" },
                  ]
                : [
                    { x: x + w + 10, y: y + h - 20, label: "east arm, inside end" },
                    { x: x + w - 20, y: y + h + 10, label: "south arm, inside end" },
                    { x: x + w + 10, y: y + h + 10, label: "diagonal" },
                  ];
        for (const point of points) {
          const hit = await hitAt(page, point.x, point.y);
          expect(hit.resize, `${edge} ${point.label}`).toBe(edge);
        }
        const from = points[0];
        await drag(page, from, { x: from.x + (edge.includes("e") ? 40 : -40), y: from.y + (edge.includes("n") ? -40 : 40) });
        const after = await boxOf(panel);
        expect(after.w, `${edge}: width changed`).toBeGreaterThan(box.w + 20);
        expect(after.h, `${edge}: height changed`).toBeGreaterThan(box.h + 20);
      });
    }
  });

  test("B3 touch targets: corner arms ≥44px, edge bands ≥20px", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const box = await centreWindow(page, panel, { w: 400, h: 560 });
    const measured = await page.evaluate(
      ({ box }) => {
        const kindAt = (x: number, y: number) => {
          const node = document.elementFromPoint(x, y);
          const resize = node?.closest?.("[data-sat-resize-edge],[data-sat-resize-handle]") as
            | HTMLElement
            | null;
          return resize
            ? resize.getAttribute("data-sat-resize-edge") ??
                resize.getAttribute("data-sat-resize-handle")
            : null;
        };
        const run = (start: number, end: number, at: (value: number) => [number, number], want: string) => {
          let first = Number.NaN;
          let last = Number.NaN;
          for (let value = start; value <= end; value += 1) {
            if (kindAt(...at(value)) === want) {
              if (Number.isNaN(first)) first = value;
              last = value;
            }
          }
          return Number.isNaN(first) ? 0 : last - first + 1;
        };
        const { x, y, w, h } = box;
        return {
          ne: {
            horizontal: run(x + w - 60, x + w + 30, (v) => [v, y - 10], "ne"),
            vertical: run(y - 60, y + 30, (v) => [x + w + 10, v], "ne"),
          },
          nw: {
            horizontal: run(x - 30, x + 60, (v) => [v, y - 10], "nw"),
            vertical: run(y - 60, y + 30, (v) => [x - 10, v], "nw"),
          },
          sw: {
            horizontal: run(x - 30, x + 60, (v) => [v, y + h + 10], "sw"),
            vertical: run(y + h - 30, y + h + 60, (v) => [x - 10, v], "sw"),
          },
          se: {
            horizontal: run(x + w - 60, x + w + 30, (v) => [v, y + h + 10], "se"),
            vertical: run(y + h - 30, y + h + 60, (v) => [x + w + 10, v], "se"),
          },
          east: run(x + w - 1, x + w + 40, (v) => [v, y + h / 2], "e"),
          west: run(x - 40, x + 1, (v) => [v, y + h / 2], "w"),
          north: run(y - 40, y + 1, (v) => [x + w / 2, v], "n"),
          south: run(y + h - 1, y + h + 40, (v) => [x + w / 2, v], "s"),
        };
      },
      { box }
    );
    for (const corner of ["ne", "nw", "sw", "se"] as const) {
      expect(measured[corner].horizontal, `${corner} horizontal arm`).toBeGreaterThanOrEqual(44);
      expect(measured[corner].vertical, `${corner} vertical arm`).toBeGreaterThanOrEqual(44);
    }
    for (const edge of ["east", "west", "north", "south"] as const) {
      expect(measured[edge], `${edge} band depth`).toBeGreaterThanOrEqual(20);
    }
  });

  test("B4/B5 minimum clamp pins the opposite corner", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const size = await viewport(page);
    const start = await centreWindow(page, panel, { w: 400, h: 560 });
    // Grow first so the shrink has somewhere to go.
    let from = bandPoint(start, "se", 10);
    await drag(page, from, { x: from.x + 1900, y: from.y + 1900 });
    const large = await boxOf(panel);
    expect(large.w).toBeGreaterThan(size.w - 80);
    // B4: SE inward past the content minimum.
    from = bandPoint(large, "se", 10);
    await drag(page, from, { x: large.x + 20, y: large.y + 20 });
    const small = await boxOf(panel);
    near(small.w, 400, "B4 width clamps at the content minimum");
    near(small.h, 400, "B4 height clamps at the content minimum");
    near(small.x, large.x, "B4 north-west x fixed");
    near(small.y, large.y, "B4 north-west y fixed");
    // B5: NW inward past the minimum; the SE corner must stay put.
    from = bandPoint(small, "nw", 10);
    await drag(page, from, { x: small.x + small.w - 20, y: small.y + small.h - 20 });
    const pinned = await boxOf(panel);
    near(pinned.w, 400, "B5 width clamps");
    near(pinned.h, 400, "B5 height clamps");
    near(pinned.x + pinned.w, small.x + small.w, "B5 south-east x fixed");
    near(pinned.y + pinned.h, small.y + small.h, "B5 south-east y fixed");
  });

  test("B6 maximum clamp keeps the whole window and its bands on screen", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const start = await centreWindow(page, panel, { w: 400, h: 560 });
    const from = bandPoint(start, "se", 10);
    await drag(page, from, { x: from.x + 1400, y: from.y + 1400 });
    const big = await boxOf(panel);
    const size = await viewport(page);
    expect(big.x, "left edge on screen").toBeGreaterThanOrEqual(19);
    expect(big.y, "top edge on screen").toBeGreaterThanOrEqual(19);
    expect(big.x + big.w, "right edge leaves the 20px band on screen").toBeLessThanOrEqual(size.w - 19);
    expect(big.y + big.h, "bottom edge leaves the 20px band on screen").toBeLessThanOrEqual(size.h - 19);
    for (const direction of DIRECTIONS) {
      const point = bandPoint(big, direction.edge);
      const probe = await hitAt(page, point.x, point.y);
      expect(probe.resize, `${direction.edge} band still reachable at max size`).toBe(direction.edge);
    }
  });
});

/* ── C. Visible affordance (I3) ─────────────────────────────────────────── */

test.describe("C. visible affordance", () => {
  test("C1 four brackets are painted outside every corner", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const box = await boxOf(panel);
    const size = await viewport(page);
    const painted = await brackets(page, panel);
    expect(painted.map((bracket) => bracket.corner).sort()).toEqual(["ne", "nw", "se", "sw"]);
    for (const bracket of painted) {
      expect(bracket.opacity, `${bracket.corner} bracket visible`).toBe("1");
      expect(bracket.strokes.length, `${bracket.corner} has two painted strokes`).toBe(2);
      for (const stroke of bracket.strokes) {
        expect(stroke.x).toBeGreaterThanOrEqual(0);
        expect(stroke.y).toBeGreaterThanOrEqual(0);
        expect(stroke.x + stroke.w).toBeLessThanOrEqual(size.w);
        expect(stroke.y + stroke.h).toBeLessThanOrEqual(size.h);
      }
      const tolerant = 0.6;
      if (bracket.corner === "ne") {
        expect(bracket.strokes.some((s) => s.y + s.h <= box.y + tolerant), "ne arm above the window").toBe(true);
        expect(bracket.strokes.some((s) => s.x >= box.x + box.w - tolerant), "ne arm right of the window").toBe(true);
      }
      if (bracket.corner === "nw") {
        expect(bracket.strokes.some((s) => s.y + s.h <= box.y + tolerant), "nw arm above the window").toBe(true);
        expect(bracket.strokes.some((s) => s.x + s.w <= box.x + tolerant), "nw arm left of the window").toBe(true);
      }
      if (bracket.corner === "sw") {
        expect(bracket.strokes.some((s) => s.y >= box.y + box.h - tolerant), "sw arm below the window").toBe(true);
        expect(bracket.strokes.some((s) => s.x + s.w <= box.x + tolerant), "sw arm left of the window").toBe(true);
      }
      if (bracket.corner === "se") {
        expect(bracket.strokes.some((s) => s.y >= box.y + box.h - tolerant), "se arm below the window").toBe(true);
        expect(bracket.strokes.some((s) => s.x >= box.x + box.w - tolerant), "se arm right of the window").toBe(true);
      }
    }
  });

  test("C2 brackets meet the 3:1 non-text contrast minimum", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const painted = await brackets(page, panel);
    for (const bracket of painted) {
      const stroke = bracket.strokes[0];
      const behind = await backgroundAt(page, stroke.x + 4, stroke.y + stroke.h / 2);
      const ratio = await contrastRatio(page, bracket.color, behind);
      expect(ratio, `${bracket.corner} bracket contrast ${bracket.color} on ${behind}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("C3/C4 the SE bracket turns focus-coloured while resizing and focused", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const box = await boxOf(panel);
    const focus = await normalizeColor(
      page,
      await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--sat-focus").trim())
    );
    const atRest = await brackets(page, panel);
    const seAtRest = atRest.find((bracket) => bracket.corner === "se")!;
    expect(await normalizeColor(page, seAtRest.color)).not.toBe(focus);

    // C3: during a touch resize the bracket advertises the live gesture.
    const from = bandPoint(box, "se", 10);
    let during: string | null = null;
    await drag(page, from, { x: from.x + 40, y: from.y + 40 }, {
      mid: async () => {
        const live = await brackets(page, panel);
        during = live.find((bracket) => bracket.corner === "se")!.color;
      },
    });
    expect(await normalizeColor(page, during!), "SE bracket during resize").toBe(focus);

    // C4: keyboard focus reaches the separator and shows the same colour.
    await panel.getByRole("radio", { name: "Graphing", exact: true }).focus();
    let reached = false;
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab");
      if (await panel.locator(HANDLE_NODE).evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached, "Tab reaches the resize separator").toBe(true);
    // border-color transitions over --sat-tool-edge-reveal; poll past it.
    await expect
      .poll(
        async () => {
          const focused = (await brackets(page, panel)).find((bracket) => bracket.corner === "se")!;
          return normalizeColor(page, focused.color);
        },
        { message: "SE bracket turns focus-coloured while focused" }
      )
      .toBe(focus);
  });

  test("C5 window chrome visual snapshot", async ({ page }) => {
    test.skip(kind() !== "ipad" || !chromiumProject(), "Chromium iPad baselines only.");
    const panel = await openCalculator(page);
    // A locator screenshot clips to the window, and the whole point of the
    // affordance is that it is painted OUTSIDE the window — so snapshot the
    // page with a 28px collar around the rectangle.
    const clip = async () => {
      const box = await boxOf(panel);
      return { x: Math.max(0, box.x - 28), y: Math.max(0, box.y - 28), width: box.w + 56, height: box.h + 56 };
    };
    await expect(page).toHaveScreenshot("calculator-window-graphing.png", {
      clip: await clip(),
      mask: [page.locator('iframe[data-desmos-mode]')],
    });
    await page.getByRole("radio", { name: "Scientific", exact: true }).click();
    await expect(page).toHaveScreenshot("calculator-window-scientific.png", {
      clip: await clip(),
      mask: [page.locator('iframe[data-desmos-mode]')],
    });
  });

  test("C6 first open shows no teaching chip on touch and mobile", async ({ page }) => {
    test.skip(kind() === "desktop", "Touch and mobile presentations only.");
    await page.goto("/__dev/sat-accessibility?mode=math");
    await waitForDesmos(page);
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    const panel = calculator(page);
    await expect(panel).toBeVisible();
    // First-open helper text was removed on every breakpoint (iPad + phone):
    // the corners and edge bands stay directly grabbable, with no chip.
    await expect(panel.locator("[data-sat-tool-hint]")).toHaveCount(0);
    await expect(panel.locator(".sat-tool-hint")).toHaveCount(0);
    await expect(panel.locator("[data-sat-tool-teaching]")).toHaveCount(0);
  });
});

/* ── D. Desmos and header keep their pixels (I5, I6) ────────────────────── */

test.describe("D. Desmos and header own their pixels", () => {
  test("D1 Desmos keeps all four corners (no resize starts inside)", async ({ page }) => {
    test.skip(kind() !== "ipad" || !chromiumProject(), "CDP touch, iPad only.");
    const panel = await openCalculator(page);
    const geometryBefore = await readGeometry(page);
    const frame = await panelIframe(page);
    for (const [label, from] of [
      ["top-left", { x: frame.x + 8, y: frame.y + 8 }],
      ["top-right", { x: frame.x + frame.w - 8, y: frame.y + 8 }],
      ["bottom-left", { x: frame.x + 8, y: frame.y + frame.h - 8 }],
      ["bottom-right", { x: frame.x + frame.w - 8, y: frame.y + frame.h - 8 }],
    ] as const) {
      const before = await boxOf(panel);
      // I5: the pixel belongs to Desmos, not to a resize layer...
      const owner = await hitAt(page, from.x, from.y);
      expect(owner.tag, `D1 ${label}: Desmos owns the corner pixel`).toContain("IFRAME");
      let resizing: string | null = null;
      await drag(page, from, { x: from.x + (label.includes("left") ? 80 : -80), y: from.y - 80 }, {
        mid: async () => {
          resizing = await panel.getAttribute("data-sat-resizing");
        },
      });
      expect(resizing, `D1 ${label}: no resize gesture`).toBeNull();
      await expectRect(await boxOf(panel), before, `D1 ${label}: window must not resize`);
      expect(await readGeometry(page), `D1 ${label}: no geometry persisted`).toEqual(geometryBefore);
    }
  });

  test("D2/D3/D4 edge taps: expression list, close and mode tabs", async ({ page }) => {
    test.skip(kind() !== "ipad" || !chromiumProject(), "CDP touch, iPad only.");
    const panel = await openCalculator(page);
    const frameLocator = page.frameLocator('iframe[data-desmos-mode="graphing"]');
    const field = frameLocator.locator(".dcg-mq-editable-field").first();
    const fieldBox = await boxOf(field);
    const frameBox = await panelIframe(page);
    // D2: 4px inside the expression field's left border.
    await tap(page, frameBox.x + fieldBox.x + 6, frameBox.y + fieldBox.y + fieldBox.h / 2);
    const active = await frameLocator.locator("body").evaluate((body) => {
      const el = body.ownerDocument.activeElement;
      return el ? `${el.tagName}:${el.className}` : "none";
    });
    expect(active, `expression list focused, got ${active}`).not.toMatch(/^BODY/);

    // D3: close button at its top-right 4px.
    const close = await boxOf(panel.locator("[data-sat-tool-close]"));
    await tap(page, close!.x + close!.w - 4, close!.y + 4);
    await expect(calculator(page)).toBeHidden();

    // D4: mode tab at its outer 4px, after re-opening.
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    const scientific = await boxOf(
      page.getByRole("radio", { name: "Scientific", exact: true })
    );
    await tap(page, scientific!.x + scientific!.w - 4, scientific!.y + 3);
    await expect(page.getByRole("radio", { name: "Scientific", exact: true })).toBeChecked();
  });

  test("D5 two-finger pinch inside the graph never resizes", async ({ page }) => {
    test.skip(kind() !== "ipad" || !chromiumProject(), "CDP multi-touch, iPad only.");
    const panel = await openCalculator(page);
    const before = await boxOf(panel);
    const frame = await panelIframe(page);
    const centre = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: centre.x - 20, y: centre.y },
        { x: centre.x + 20, y: centre.y },
      ],
    });
    for (let step = 1; step <= 6; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: centre.x - 20 - step * 10, y: centre.y },
          { x: centre.x + 20 + step * 10, y: centre.y },
        ],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expectRect(await boxOf(panel), before, "D5 pinch");
    expect(await readGeometry(page), "D5 pinch persisted nothing").toBeNull();
  });
});

/* ── E. Page outside the window (I11, I12) ──────────────────────────────── */

test.describe("E. the page outside the window", () => {
  test("E1 a tap 24px outside the window still selects an answer", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const choice = page.locator("label.sat-answer-choice").first();
    const choiceBox = await boxOf(choice);
    const box = await boxOf(panel);
    // The choice runs from 192 to 836 on the 1080px iPad; the window covers its
    // left end. 24px clear of the window is still on the choice.
    const tapX = box.x + box.w + 24;
    expect(tapX, "24px outside the window is still on the answer choice").toBeLessThan(
      choiceBox.x + choiceBox.w
    );
    await tap(page, tapX, choiceBox.y + choiceBox.h / 2);
    await expect(page.locator('input[data-testid="sat-answer-control"]').first()).toBeChecked();
    await expect(panel).not.toHaveAttribute("data-sat-resizing", "true");
  });

  test("E2 a no-move tap in a band changes nothing", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const before = await boxOf(panel);
    for (const direction of DIRECTIONS) {
      const point = bandPoint(before, direction.edge, 10);
      await tap(page, point.x, point.y);
      await expectRect(await boxOf(panel), before, `E2 ${direction.edge} tap`);
      expect(await readGeometry(page), `E2 ${direction.edge} wrote no storage`).toBeNull();
      await expect(panel).not.toHaveAttribute("data-sat-resizing", "true");
    }
  });

  test("E3 bands own their gesture (touch-action none, page never scrolls)", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const actions = await panel.evaluate((root) =>
      [...root.querySelectorAll("[data-sat-resize-edge],[data-sat-resize-handle]")].map(
        (el) => getComputedStyle(el).touchAction
      )
    );
    expect(actions.every((action) => action === "none"), `touch-action: ${actions.join(",")}`).toBe(true);
    const box = await boxOf(panel);
    const scrollBefore = await page.evaluate(() => ({
      doc: document.scrollingElement?.scrollTop ?? 0,
      win: window.scrollY,
    }));
    const from = bandPoint(box, "s", 10);
    await drag(page, from, { x: from.x, y: from.y + 80 });
    const scrollAfter = await page.evaluate(() => ({
      doc: document.scrollingElement?.scrollTop ?? 0,
      win: window.scrollY,
    }));
    expect(scrollAfter, "dragging a band must not scroll the exam").toEqual(scrollBefore);
  });

  test("E4 pointercancel restores the pre-gesture rect", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    await centreWindow(page, panel, { w: 400, h: 560 });
    for (const edge of ["ne", "nw", "sw", "se"] as const) {
      await test.step(edge, async () => {
        const before = await boxOf(panel);
        const storedBefore = await readGeometry(page);
        const from = bandPoint(before, edge, 10);
        await drag(
          page,
          from,
          { x: from.x + (edge.includes("e") ? 60 : -60), y: from.y + (edge.includes("n") ? -60 : 60) },
          { cancel: true }
        );
        await expectRect(await boxOf(panel), before, `E4 ${edge} restored`);
        expect(await readGeometry(page), `E4 ${edge} wrote no storage`).toEqual(storedBefore);
        await expect(panel).not.toHaveAttribute("data-sat-resizing", "true");
      });
    }
  });

  test("E5 a second finger never jumps the resize", async ({ page }) => {
    test.skip(kind() !== "ipad" || !chromiumProject(), "CDP multi-touch, iPad only.");
    const panel = await openCalculator(page);
    const box = await centreWindow(page, panel, { w: 400, h: 560 });
    const from = bandPoint(box, "se", 10);
    const second = { x: box.x - 60, y: box.y + box.h + 40 };
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from.x, y: from.y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + 20, y: from.y + 20 },
        { x: second.x, y: second.y },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + 40, y: from.y + 40 },
        { x: second.x + 40, y: second.y - 40 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const after = await boxOf(panel);
    near(after.w, box.w + 40, "E5 width follows the resizing finger");
    near(after.h, box.h + 40, "E5 height follows the resizing finger");
    near(after.x, box.x, "E5 window does not jump");
    near(after.y, box.y, "E5 window does not jump");
  });

  test("E6 backgrounding cancels the gesture", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    await centreWindow(page, panel, { w: 400, h: 560 });
    for (const interruption of ["blur", "visibilitychange"] as const) {
      await test.step(interruption, async () => {
        const before = await boxOf(panel);
        const storedBefore = await readGeometry(page);
        const from = bandPoint(before, "se", 10);
        await drag(page, from, { x: from.x + 60, y: from.y + 60 }, {
          mid: async () => {
            await page.evaluate((mode) => {
              if (mode === "blur") {
                window.dispatchEvent(new Event("blur"));
                return;
              }
              Object.defineProperty(document, "visibilityState", {
                configurable: true,
                get: () => "hidden",
              });
              document.dispatchEvent(new Event("visibilitychange"));
            }, interruption);
          },
        });
        await expectRect(await boxOf(panel), before, `E6 ${interruption} restored`);
        expect(await readGeometry(page), `E6 ${interruption} wrote no storage`).toEqual(storedBefore);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "visible",
          });
        });
      });
    }
  });
});

/* ── F. Screen edges and rotation (I10, I12) ────────────────────────────── */

test.describe("F. screen edges and rotation", () => {
  test("F1 first open leaves every band and bracket reachable", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const box = await boxOf(panel);
    const probe = await bandProbe(page, box);
    for (const direction of DIRECTIONS) {
      expect(
        probe[direction.edge].resize,
        `${direction.edge} band reachable at first open (${JSON.stringify(probe[direction.edge])})`
      ).toBe(direction.edge);
    }
    const size = await viewport(page);
    for (const bracket of await brackets(page, panel)) {
      for (const stroke of bracket.strokes) {
        expect(stroke.x, `${bracket.corner} bracket x`).toBeGreaterThanOrEqual(0);
        expect(stroke.y, `${bracket.corner} bracket y`).toBeGreaterThanOrEqual(0);
        expect(stroke.x + stroke.w, `${bracket.corner} bracket right`).toBeLessThanOrEqual(size.w);
        expect(stroke.y + stroke.h, `${bracket.corner} bracket bottom`).toBeLessThanOrEqual(size.h);
      }
    }
  });

  test("F2 dragging to each screen edge keeps that band reachable", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const size = await viewport(page);
    const edges = [
      { edge: "n" as const, dx: 0, dy: -2000 },
      { edge: "w" as const, dx: -2000, dy: 0 },
      { edge: "s" as const, dx: 0, dy: 2000 },
      { edge: "e" as const, dx: 2000, dy: 0 },
    ];
    for (const target of edges) {
      await test.step(target.edge, async () => {
        const box = await boxOf(panel);
        // Clamp the travel inside the viewport so pointer input stays valid.
        const reachX = target.edge === "e" ? size.w - box.x - box.w - 24 : -2000;
        const reachY = target.edge === "s" ? size.h - box.y - box.h - 24 : -2000;
        const dx = target.edge === "w" ? -(box.x - 24) : target.edge === "e" ? reachX : 0;
        const dy = target.edge === "n" ? -(box.y - 24) : target.edge === "s" ? reachY : 0;
        await moveWindowBy(page, panel, dx, dy);
        const moved = await boxOf(panel);
        const probe = await bandProbe(page, moved);
        expect(probe[target.edge].resize, `${target.edge} band reachable at the edge`).toBe(target.edge);
        expect(moved.x, "window stays on screen").toBeGreaterThanOrEqual(19);
        expect(moved.y, "window stays on screen").toBeGreaterThanOrEqual(19);
        expect(moved.x + moved.w).toBeLessThanOrEqual(size.w - 19);
        expect(moved.y + moved.h).toBeLessThanOrEqual(size.h - 19);
      });
    }
  });

  test("F3 rotation keeps the window clamped, brackets visible, interior clean", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const start = await viewport(page);
    const targetW = Math.min(700, start.w - 80);
    const box = await centreWindow(page, panel, { w: targetW, h: 560 });
    near(box.w, targetW, "pre-rotation width");
    const sizes = [
      { width: start.h, height: start.w },
      { width: start.w, height: start.h },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
      await expect
        .poll(async () => {
          const current = await boxOf(panel);
          return current.x + current.w <= size.width + 1 && current.y + current.h <= size.height + 1;
        }, { message: `window clamped inside ${size.width}x${size.height}` })
        .toBe(true);
      const current = await boxOf(panel);
      expect(current.x, "left on screen").toBeGreaterThanOrEqual(19);
      expect(current.y, "top on screen").toBeGreaterThanOrEqual(19);
      expect(await hitScan(page, panel, { step: 6, ringStep: 3 }), "no interior capture").toEqual([]);
      expect((await brackets(page, panel)).length, "four brackets after rotation").toBe(4);
      const probe = await bandProbe(page, current);
      for (const direction of DIRECTIONS) {
        expect(probe[direction.edge].resize, `${direction.edge} band reachable after rotation`).toBe(
          direction.edge
        );
      }
    }
  });

  test("F4 the footer stays clear of the south band", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const box = await boxOf(panel);
    const footer = await boxOf(page.locator(".sat-exam-footer"));
    expect(footer, "footer rendered").not.toBeNull();
    expect(box.y + box.h + 20, "south band sits above the footer").toBeLessThanOrEqual(footer!.y + 1);
    const next = page.getByRole("button", { name: "Next question" });
    await next.tap();
    await expect(
      page.getByRole("button", { name: /Open question navigator. Question 2 of 3/ })
    ).toBeVisible();
  });

  test("F5 the toolbar stays clear of the north band", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    await openCalculator(page);
    const toggle = page.getByRole("button", { name: "Calculator", exact: true });
    const toggleBox = await boxOf(toggle);
    const hit = await hitAt(page, toggleBox!.x + toggleBox!.w / 2, toggleBox!.y + 4);
    expect(hit.resize, "north band does not cover the toolbar").toBeNull();
    await toggle.tap();
    await expect(calculator(page)).toBeHidden();
    await toggle.tap();
    await expect(calculator(page)).toBeVisible();
  });
});

/* ── G. Persistence (I9) ────────────────────────────────────────────────── */

test.describe("G. persistence", () => {
  test("G1/G2 geometry persists on release only", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const before = await boxOf(panel);
    const from = bandPoint(before, "se", 10);
    let during: Box | null = null;
    await drag(page, from, { x: from.x + 50, y: from.y + 50 }, {
      mid: async () => {
        during = await readGeometry(page);
      },
    });
    expect(during, "no storage write while the finger is down").toBeNull();
    const after = await boxOf(panel);
    const stored = await readGeometry(page);
    expect(stored, "geometry written on release").not.toBeNull();
    near(stored!.x, after.x, "stored x");
    near(stored!.y, after.y, "stored y");
    near(stored!.w, after.w, "stored w");
    near(stored!.h, after.h, "stored h");
    expect(await page.evaluate((key) => localStorage.getItem(key), GEOMETRY_KEY)).toContain('"v":2');
  });

  test("G3 reload restores the resized rect", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const before = await boxOf(panel);
    const from = bandPoint(before, "se", 10);
    await drag(page, from, { x: from.x + 60, y: from.y + 40 });
    const resized = await boxOf(panel);
    await page.reload();
    await waitForDesmos(page);
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    const restored = await boxOf(calculator(page));
    await expectRect(restored, resized, "restored after reload");
    expect(await hitScan(page, calculator(page), { step: 6, ringStep: 3 })).toEqual([]);
    expect((await brackets(page, calculator(page))).length).toBe(4);
  });

  test("G4 switching modes keeps the resized rect", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const before = await boxOf(panel);
    const from = bandPoint(before, "se", 10);
    await drag(page, from, { x: from.x + 60, y: from.y + 40 });
    const resized = await boxOf(panel);
    await page.getByRole("radio", { name: "Scientific", exact: true }).click();
    await expectRect(await boxOf(panel), resized, "after switching to scientific");
    await page.getByRole("radio", { name: "Graphing", exact: true }).click();
    await expectRect(await boxOf(panel), resized, "after switching back to graphing");
  });
});

/* ── H. Exam state, a11y, other tools (I13, I14, I16) ───────────────────── */

test.describe("H. exam state, accessibility and other tools", () => {
  test("H1 a paused exam blocks every band", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    await page.goto("/__dev/sat-accessibility?mode=math&paused=1&tool=calculator");
    await waitForDesmos(page);
    const panel = page.locator('[data-sat-tool-window="Calculator"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-sat-tool-interaction-disabled", "true");
    await expect(panel).toHaveAttribute("inert", "");
    const before = await boxOf(panel);
    for (const direction of DIRECTIONS) {
      const from = bandPoint(before, direction.edge, 10);
      await drag(page, from, {
        x: from.x + direction.dx * 40,
        y: from.y + direction.dy * 40,
      });
    }
    await expectRect(await boxOf(panel), before, "paused: no resize");
    expect(await readGeometry(page)).toBeNull();
  });

  test("H2 the separator keeps its ARIA and keyboard contract", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    const handle = panel.getByRole("separator", { name: /Resize Calculator/ });
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-valuemin", /\d+/);
    await expect(handle).toHaveAttribute("aria-valuemax", /\d+/);
    await expect(handle).toHaveAttribute("aria-valuenow", /\d+/);
    await expect(handle).toHaveAttribute("aria-valuetext", /^\d+ by \d+ pixels$/);
    const before = await boxOf(panel);
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    near((await boxOf(panel)).w, before.w + 8, "ArrowRight grows by 8px");
    await page.keyboard.press("ArrowLeft");
    near((await boxOf(panel)).w, before.w, "ArrowLeft shrinks by 8px");
  });

  test("H3 the Reference sheet keeps no outside bands", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    await expect(panel.locator(EDGE_NODE)).toHaveCount(7);
    await page.getByRole("button", { name: "Reference", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    await expect(reference).toBeVisible();
    // I16: on a coarse pointer the Reference sheet has no outside band at all
    // (it is its own surface, so it has no resize targets either).
    await expect(reference.locator(EDGE_NODE)).toHaveCount(0);
    await expect(reference.locator(HANDLE_NODE)).toHaveCount(0);
  });

  test("H4 both tools open: the calculator band never owns the Reference chrome", async ({ page }) => {
    test.skip(kind() !== "ipad", "iPad is where resize exists.");
    const panel = await openCalculator(page);
    await page.getByRole("button", { name: "Reference", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    await expect(reference).toBeVisible();
    const close = reference.getByRole("button", { name: /Close Reference/ });
    const closeBox = await boxOf(close);
    const hit = await hitAt(page, closeBox.x + closeBox.w / 2, closeBox.y + closeBox.h / 2);
    expect(hit.resize, "the calculator's outside band does not reach the Reference chrome").toBeNull();
    await close.tap();
    await expect(reference).toBeHidden();
    // The calculator is untouched and still fully resizable.
    await expect(panel).toBeVisible();
    await expect(panel.locator(EDGE_NODE)).toHaveCount(7);
  });
});

/* ── I. Phones and Split View (I7) ──────────────────────────────────────── */

test.describe("I. compact sheet on phones and Split View", () => {
  test("I1 no resize nodes and no outside overflow on the compact sheet", async ({ page }) => {
    test.skip(kind() !== "phone" && kind() !== "split", "Compact presentation only.");
    const panel = await openCalculator(page);
    await expectCompactSheet(page, panel);
    expect(await coarsePointer(page)).toBe(true);
    const box = await boxOf(panel);
    const size = await viewport(page);
    expect(box.x, "sheet starts inside the viewport").toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(size.w + 1);
  });

  test("I2 rotating a phone keeps the compact sheet usable", async ({ page }) => {
    test.skip(kind() !== "phone", "Phone rotation only.");
    await openCalculator(page);
    const size = await viewport(page);
    await page.setViewportSize({ width: size.h, height: size.w });
    await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
    const rotated = await viewport(page);
    await expect
      .poll(async () => {
        const box = await boxOf(calculator(page));
        return box.x >= -1 && box.y >= -1 && box.x + box.w <= rotated.w + 1 && box.y + box.h <= rotated.h + 1;
      }, { message: "sheet stays on screen after rotation" })
      .toBe(true);
    await expectCompactSheet(page, calculator(page));
  });
});

/* ── J. Desktop guard (I8) ──────────────────────────────────────────────── */

test.describe("J. desktop guard", () => {
  test("J2 desktop keeps the legacy inside-the-window handles", async ({ page }) => {
    test.skip(kind() !== "desktop", "Fine-pointer guard.");
    const panel = await openCalculator(page);
    expect(await coarsePointer(page)).toBe(false);
    await expect(panel).toHaveAttribute("data-sat-tool-resizable", "true");
    const box = await boxOf(panel);
    // Legacy desktop band: 10px inside the window, 4px outside. This capture is
    // documented (not a bug) and must stay exactly as main has it. (The NE
    // corner sits under the close button by design, so probe the E band and the
    // SE grip, which are the reachable legacy targets.)
    const eastInside = await hitAt(page, box.x + box.w - 6, box.y + box.h / 2);
    expect(eastInside.resize, "desktop east band still captures 6px inside").toBe("e");
    const seInside = await hitAt(page, box.x + box.w - 6, box.y + box.h - 6);
    expect(seInside.resize, "desktop SE grip still captures 6px inside").not.toBeNull();
    expect((await brackets(page, panel)).length, "desktop brackets exist but are the old ones").toBe(4);
  });
});

/* ── Zoom helper (shared with the a11y suite) ───────────────────────────── */

async function displayZoom(page: Page, zoom: number): Promise<void> {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const display = page.getByRole("dialog", { name: "Display", exact: true });
  const current = Number(
    await page.locator("[data-sat-zoom-plane]").first().getAttribute("data-sat-screen-zoom")
  );
  for (let step = 0; step < Math.round(Math.abs(zoom - current) / 0.25); step += 1) {
    await display
      .getByRole("button", {
        name: zoom > current ? "Increase screen zoom" : "Decrease screen zoom",
      })
      .click();
  }
  await expect(page.locator("[data-sat-zoom-plane]").first()).toHaveAttribute(
    "data-sat-screen-zoom",
    String(zoom)
  );
  await display.getByRole("button", { name: "Close display settings" }).click();
}
