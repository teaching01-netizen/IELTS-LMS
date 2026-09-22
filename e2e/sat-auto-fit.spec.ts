import { expect, test, type Page } from "@playwright/test";

/**
 * Auto-fit screen zoom, checked where its premise lives: a browser that really
 * lays the exam out.
 *
 * Unit tests can prove the policy and the walk; they cannot prove the geometry
 * the whole feature rests on — that `zoom` scales what is inside the exam's
 * content box and leaves the box itself the size of the pane region, so zooming
 * out reveals more of the question instead of drawing a shrunken page with
 * bands of empty paper around it. That claim is only answerable here.
 *
 * Viewport: 1920x1080, the size the default was tuned against.
 */
const DEBUG_ROUTE = "/__dev/sat-accessibility";

test.use({ viewport: { width: 1920, height: 1080 } });

interface ExamGeometry {
  paneRegion: { width: number; height: number } | null;
  contentBox: { width: number; height: number } | null;
  zoom: number | null;
  probing: string | null;
  zoomStyle: string | null;
  /** scrollHeight - clientHeight per pane: what the fit's predicate looks at. */
  overflow: number[];
}

async function readExamGeometry(page: Page): Promise<ExamGeometry> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-sat-content-zoom]");
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
    return {
      paneRegion: rect(document.querySelector("[data-sat-annotation-bounds]")),
      contentBox: rect(box),
      zoom: box ? Number(box.getAttribute("data-sat-content-zoom")) : null,
      probing: box ? box.getAttribute("data-sat-fit-probing") : null,
      zoomStyle: box ? box.style.zoom : null,
      overflow: panes.map((pane) => pane.scrollHeight - pane.clientHeight),
    };
  });
}

async function settled(page: Page): Promise<ExamGeometry> {
  await expect(page.locator("[data-sat-content-zoom]")).toHaveAttribute(
    "data-sat-fit-probing",
    "false",
  );
  return readExamGeometry(page);
}

test.describe("SAT auto-fit screen zoom (1920x1080)", () => {
  test("rests at 100% when the question already fits", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?autoFit=1`);

    const geometry = await settled(page);

    expect(geometry.zoom).toBe(1);
    expect(geometry.zoomStyle).toBe("1");
    // Nothing was written, so the exam is still the student's: no zoom to step
    // away from, no Reset to explain.
    await expect(page.locator("[data-sat-content-zoom]")).toHaveAttribute(
      "data-sat-content-zoom",
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
  });

  test("leaves the same passage alone when the fit is not asked for", async ({ page }) => {
    await page.goto(`${DEBUG_ROUTE}?long=2`);

    await expect(page.locator("[data-sat-content-zoom]")).toHaveAttribute(
      "data-sat-content-zoom",
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
    await expect(page.locator("[data-sat-content-zoom]")).toHaveAttribute(
      "data-sat-content-zoom",
      "1",
    );

    await page.getByRole("button", { name: "Display" }).click();
    await page.getByRole("button", { name: "Fit to screen" }).click();

    const geometry = await settled(page);

    expect(geometry.zoom).toBeLessThan(1);
    expect(Math.max(0, ...geometry.overflow)).toBeLessThanOrEqual(4);
  });
});
