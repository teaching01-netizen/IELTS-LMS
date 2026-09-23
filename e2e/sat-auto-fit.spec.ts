import { expect, test, type Page } from "@playwright/test";

/**
 * Auto-fit screen zoom, checked where its premise lives: a browser that really
 * lays the exam out.
 *
 * Unit tests can prove the policy and the walk; they cannot prove the geometry
 * the whole feature rests on — one logical exam plane expands inversely and
 * scales back to the physical viewport, while the panes lay out at logical
 * size. Browser geometry can prove the shell fills its viewport and the
 * question body gains room without a gutter; state-only tests cannot.
 *
 * Viewport: 1920x1080, the size the default was tuned against.
 */
const DEBUG_ROUTE = "/__dev/sat-accessibility";

test.use({ viewport: { width: 1920, height: 1080 } });

interface ExamGeometry {
  viewport: { width: number; height: number } | null;
  zoomPlane: { width: number; height: number } | null;
  paneRegion: { width: number; height: number } | null;
  contentBox: { width: number; height: number } | null;
  topbar: { width: number; height: number } | null;
  main: { width: number; height: number } | null;
  footer: { width: number; height: number } | null;
  passageClientHeight: number;
  rangeBox: { width: number; height: number } | null;
  documentWidth: number;
  zoom: number | null;
  probing: string | null;
  planeTransform: string | null;
  planeWidth: string | null;
  planeHeight: string | null;
  /** scrollHeight - clientHeight per pane: what the fit's predicate looks at. */
  overflow: number[];
}

async function readExamGeometry(page: Page): Promise<ExamGeometry> {
  return page.evaluate(() => {
    const plane = document.querySelector<HTMLElement>("[data-sat-zoom-plane]");
    const rect = (element: Element | null) => {
      if (!element) return null;
      const measured = element.getBoundingClientRect();
      return { width: measured.width, height: measured.height };
    };
    const panes = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-sat-passage-scroll], [data-sat-question-scroll]",
      ),
    );
    const passage = document.querySelector<HTMLElement>("[data-sat-passage-scroll]");
    const walker = passage ? document.createTreeWalker(passage, NodeFilter.SHOW_TEXT) : null;
    let node = walker?.nextNode() ?? null;
    while (node && !(node.nodeValue ?? "").includes("canopy density")) node = walker?.nextNode() ?? null;
    let rangeBox = null;
    if (node) {
      const text = node as Text;
      const start = text.data.indexOf("canopy density");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "canopy density".length);
      const rect = range.getBoundingClientRect();
      rangeBox = { width: rect.width, height: rect.height };
    }
    return {
      viewport: rect(document.querySelector("[data-sat-exam-viewport]")),
      zoomPlane: rect(plane),
      paneRegion: rect(document.querySelector("[data-sat-annotation-bounds]")),
      contentBox: rect(document.querySelector("[data-sat-fit-root]")),
      topbar: rect(document.querySelector(".sat-exam-topbar")),
      main: rect(document.querySelector("#sat-question-content")),
      footer: rect(document.querySelector(".sat-exam-footer")),
      passageClientHeight: passage?.clientHeight ?? 0,
      rangeBox,
      documentWidth: document.documentElement.scrollWidth,
      zoom: plane ? Number(plane.getAttribute("data-sat-screen-zoom")) : null,
      probing: document.querySelector("[data-sat-fit-root]")?.getAttribute("data-sat-fit-probing") ?? null,
      planeTransform: plane?.style.transform ?? null,
      planeWidth: plane?.style.width ?? null,
      planeHeight: plane?.style.height ?? null,
      overflow: panes.map((pane) => pane.scrollHeight - pane.clientHeight),
    };
  });
}

async function settled(page: Page): Promise<ExamGeometry> {
  await expect(page.locator("[data-sat-fit-root]")).toHaveAttribute(
    "data-sat-fit-probing",
    "false",
  );
  return readExamGeometry(page);
}

test.describe("SAT auto-fit screen zoom (1920x1080)", () => {
  test("50% scales the whole shell while the plane still fills the physical viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(DEBUG_ROUTE);
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible();

    const at100 = await readExamGeometry(page);
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("button", { name: "Decrease screen zoom" }).click();
    await page.getByRole("button", { name: "Decrease screen zoom" }).click();
    await expect(page.locator("[data-sat-zoom-plane]")).toHaveAttribute("data-sat-screen-zoom", "0.5");
    await page.getByRole("button", { name: "Close display settings" }).click();

    const at50 = await readExamGeometry(page);
    expect(at50.topbar!.height).toBeCloseTo(at100.topbar!.height / 2, 0);
    expect(at50.footer!.height).toBeCloseTo(at100.footer!.height / 2, 0);
    expect(at50.rangeBox!.height).toBeCloseTo(at100.rangeBox!.height / 2, 0);
    expect(at50.main!.height).toBeGreaterThan(at100.main!.height);
    expect(at50.passageClientHeight).toBeGreaterThan(at100.passageClientHeight * 1.5);
    expect(at50.planeWidth).toBe("200%");
    expect(at50.planeHeight).toBe("200%");
    expect(at50.zoomPlane!.width).toBeCloseTo(at50.viewport!.width, 0);
    expect(at50.zoomPlane!.height).toBeCloseTo(at50.viewport!.height, 0);
    expect(at50.documentWidth).toBeLessThanOrEqual(1025);
  });

  test("every supported zoom step scales the shell and keeps the plane on screen", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(DEBUG_ROUTE);
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible();

    const baseline = await readExamGeometry(page);
    let currentZoom = 1;
    for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      const steps = Math.round(Math.abs(zoom - currentZoom) / 0.25);
      if (steps > 0) {
        await page.getByRole("button", { name: "Display", exact: true }).click();
        const action = zoom < currentZoom ? "Decrease screen zoom" : "Increase screen zoom";
        for (let step = 0; step < steps; step += 1) {
          await page.getByRole("button", { name: action }).click({ force: true });
        }
        await expect(page.locator("[data-sat-zoom-plane]")).toHaveAttribute(
          "data-sat-screen-zoom",
          String(zoom),
        );
        await page.getByRole("button", { name: "Close display settings" }).click();
      }
      currentZoom = zoom;

      const geometry = await readExamGeometry(page);
      expect(geometry.topbar!.height).toBeCloseTo(baseline.topbar!.height * zoom, 0);
      expect(geometry.footer!.height).toBeCloseTo(baseline.footer!.height * zoom, 0);
      expect(geometry.main!.height).toBeGreaterThan(0);
      if (zoom < 1) expect(geometry.main!.height).toBeGreaterThan(baseline.main!.height);
      if (zoom > 1) expect(geometry.main!.height).toBeLessThan(baseline.main!.height);
      expect(geometry.zoomPlane!.width).toBeCloseTo(geometry.viewport!.width, 0);
      expect(geometry.zoomPlane!.height).toBeCloseTo(geometry.viewport!.height, 0);
      expect(Number.parseFloat(geometry.planeWidth!)).toBeCloseTo(100 / zoom, 3);
      expect(Number.parseFloat(geometry.planeHeight!)).toBeCloseTo(100 / zoom, 3);
      expect(geometry.documentWidth).toBeLessThanOrEqual(1025);
    }
  });

  test("rests at 100% when the question already fits", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?autoFit=1`);

    const geometry = await settled(page);

    expect(geometry.zoom).toBe(1);
    expect(geometry.planeTransform).toBe("scale(1)");
    // Nothing was written, so the exam is still the student's: no zoom to step
    // away from, no Reset to explain.
    await expect(page.locator("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1",
    );
  });

  test("keeps the content box exactly the size of the pane region", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?autoFit=1`);
    const geometry = await settled(page);

    // zoom scales what is INSIDE the box. The box stays the pane region, which
    // is why a smaller zoom shows more of the question rather than a smaller
    // exam floating in white space.
    expect(geometry.contentBox!.width).toBeCloseTo(geometry.paneRegion!.width, 0);
    expect(geometry.contentBox!.height).toBeCloseTo(geometry.paneRegion!.height, 0);
    expect(geometry.zoomPlane!.width).toBeCloseTo(geometry.viewport!.width, 0);
    expect(geometry.zoomPlane!.height).toBeCloseTo(geometry.viewport!.height, 0);
  });

  test("opens an oversized passage smaller instead of scrolling it", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?long=2&autoFit=1`);

    const geometry = await settled(page);

    // Smaller than the resting point, and it stopped the scrolling: the fit did
    // something real, with the same tolerance the domain applies.
    expect(geometry.zoom).toBeLessThan(1);
    expect(Math.max(0, ...geometry.overflow)).toBeLessThanOrEqual(4);
    // And it did it without shrinking the box: at a smaller zoom the exam still
    // fills its panes edge to edge.
    expect(geometry.contentBox!.width).toBeCloseTo(geometry.paneRegion!.width, 0);
    expect(geometry.contentBox!.height).toBeCloseTo(geometry.paneRegion!.height, 0);
    expect(geometry.zoomPlane!.width).toBeCloseTo(geometry.viewport!.width, 0);
    expect(geometry.zoomPlane!.height).toBeCloseTo(geometry.viewport!.height, 0);
  });

  test("leaves the same passage alone when the fit is not asked for", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?long=2`);

    await expect(page.locator("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1",
    );
    const geometry = await readExamGeometry(page);

    // Overflowing at the resting zoom is what makes the case above meaningful:
    // the smaller zoom is the fit's doing, not a layout accident.
    expect(geometry.zoom).toBe(1);
    expect(Math.max(...geometry.overflow)).toBeGreaterThan(4);
  });

  test("keeps the zoom it decided when the page is reloaded", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?long=2&autoFit=1`);
    const decided = await settled(page);
    expect(decided.zoom).toBeLessThan(1);

    await page.reload();
    const afterReload = await settled(page);

    // The decision outlived the page: a fresh load finds it in the attempt's own
    // preferences and shows it, rather than re-deciding. (That the fit does not
    // run a second time is asserted where it can be observed — the measurement
    // count in the route test.)
    expect(afterReload.zoom).toBe(decided.zoom);
  });

  test("re-measures from the Display panel's Fit to screen control", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?long=2`);
    await expect(page.locator("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1",
    );

    await page.getByRole("button", { name: "Display" }).click();
    await page.getByRole("button", { name: "Fit to screen" }).click();

    const geometry = await settled(page);

    expect(geometry.zoom).toBeLessThan(1);
    expect(Math.max(0, ...geometry.overflow)).toBeLessThanOrEqual(4);
  });
});
