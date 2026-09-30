import { expect, type Locator, type Page } from "@playwright/test";

export const ROUTE = "/__dev/sat-accessibility?mode=math";
export const GEOMETRY_KEY = "sat-tool-geometry:v2:debug-schedule:debug-attempt:debug-module:reference";
export const VIEW_KEY = "sat-tool-view:v1:debug-schedule:debug-attempt:debug-module:reference";

export async function displayZoom(page: Page, zoom: number) {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const display = page.getByRole("dialog", { name: "Display", exact: true });
  const current = Number(await page.locator('[data-sat-zoom-plane]').first().getAttribute('data-sat-screen-zoom'));
  for (let step = 0; step < Math.round(Math.abs(zoom - current) / 0.25); step++) {
    await display.getByRole("button", { name: zoom > current ? "Increase screen zoom" : "Decrease screen zoom" }).click();
  }
  await expect(page.locator('[data-sat-zoom-plane]').first()).toHaveAttribute('data-sat-screen-zoom', String(zoom));
  await display.getByRole("button", { name: "Close display settings" }).click();
}

export async function checkSheet(panel: Locator) {
  await expect.poll(() => panel.locator("[data-sat-tool-scroll]").evaluate((stage) => {
    const canvas = stage.querySelector<HTMLElement>("[data-sat-ref-canvas]")!;
    const facts = canvas.querySelector<HTMLElement>('section[aria-label="Angle and circle facts"] p:last-child')!;
    const triangles = canvas.querySelector<HTMLElement>("#sat-special-triangles")!;
    const bounds = stage.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const bodyScale = canvasBounds.width / canvas.offsetWidth;
    const physicalScale = bounds.width / stage.clientWidth;
    const overflow = getComputedStyle(stage).overflow;
    const reachable = [facts, triangles].every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.left >= bounds.left - 1 &&
        rect.bottom <= bounds.top + stage.scrollHeight * physicalScale + 1 &&
        rect.right <= bounds.left + stage.scrollWidth * physicalScale + 1;
    });
    const canFit = bounds.width >= 700 && bounds.height >= 392;
    const fitsWhenPossible = !canFit || (canvasBounds.width <= bounds.width + 1 && canvasBounds.height <= bounds.height + 1);
    return overflow === "auto" && reachable && fitsWhenPossible &&
      Number.parseFloat(getComputedStyle(facts).fontSize) * bodyScale >= 11;
  })).toBe(true);
  const stage = panel.locator("[data-sat-tool-scroll]");
  await expect.poll(() => stage.evaluate((node) => {
    // Rotation can still commit a newer stage size after the fit assertion.
    // Pan against the current scroll span, rather than a pre-settle span.
    node.scrollTop = node.scrollHeight;
    node.scrollLeft = node.scrollWidth;
    const fact = node.querySelector('section[aria-label="Angle and circle facts"] p:last-child')!.getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    return {
      fullyVisible: fact.bottom <= bounds.bottom + 1 && fact.right <= bounds.right + 1,
      bottomGap: fact.bottom - bounds.bottom,
      rightGap: fact.right - bounds.right,
      scrollTop: node.scrollTop,
      scrollLeft: node.scrollLeft,
    };
  })).toMatchObject({ fullyVisible: true });
  await stage.evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0; });
}
