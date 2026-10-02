import { expect, test, type Locator } from "@playwright/test";
import { ROUTE, displayZoom, checkSheet } from "./helpers/satReference";

async function touchTargets(panel: Locator) {
  for (const button of await panel.locator("button").all()) {
    const rect = (await button.boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(43.9);
    expect(rect.height).toBeGreaterThanOrEqual(43.9);
  }
}
for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
  test(`touch, rotation, and compact reference at Display ${zoom * 100}%`, async ({ page }) => {
    const landscape = page.viewportSize()!;
    await page.goto(ROUTE);
    await displayZoom(page, zoom);
    await page.getByRole("button", { name: "Reference", exact: true }).tap();
    const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    await checkSheet(panel);
    await touchTargets(panel);
    const stage = (await panel.locator("[data-sat-tool-scroll]").boundingBox())!;
    await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + 30);
    await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + 30);
    await expect(panel.getByText("200%", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Fit sheet" }).tap();
    await page.setViewportSize({ width: landscape.height, height: landscape.width });
    await checkSheet(panel);
    await touchTargets(panel);
    await panel.getByRole("button", { name: "Expand Reference Sheet" }).tap();
    await expect(panel.locator("[data-sat-ref-canvas]")).toHaveAttribute(
      "data-sat-ref-layout",
      "portrait"
    );
    await checkSheet(panel);
    await panel.getByRole("button", { name: "Close Reference Sheet" }).tap();
    await page.setViewportSize(landscape);
    await page.getByRole("button", { name: "Reference", exact: true }).tap();
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "sidebar");
    await page.setViewportSize({ width: 500, height: landscape.width });
    await expect(page.locator("[data-sat-question-seat]")).toHaveAttribute("inert");
    await checkSheet(panel);
    await touchTargets(panel);
    await page.setViewportSize({ width: landscape.width, height: 520 });
    await expect(page.locator("[data-sat-question-seat]")).toHaveAttribute("inert");
    await checkSheet(panel);
    await touchTargets(panel);
  });
}
