import { expect, test } from "@playwright/test";
import { ROUTE, GEOMETRY_KEY, VIEW_KEY, displayZoom, checkSheet } from "./helpers/satReference";

test.use({ viewport: { width: 1194, height: 834 } });
for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
  test(`portrait sidebar and expansion at Display ${zoom * 100}%`, async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify({ v: 2, x: 25, y: 120, w: 920, h: 477 }));
    }, GEOMETRY_KEY);
    await page.goto(ROUTE);
    await displayZoom(page, zoom);
    const question = page.locator("[data-sat-question-seat]");
    const node = await question.elementHandle();
    const before = (await question.boundingBox())!;
    await page.getByRole("radio", { name: "Option A. 3", exact: true }).press("Space");
    await page.getByRole("button", { name: "Reference", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "sidebar");
    expect(await question.evaluate((current, original) => current === original, node)).toBe(true);
    expect((await question.boundingBox())!.width).toBeLessThan(before.width - 300);
    await expect(page.getByRole("radio", { name: "Option A. 3", exact: true })).toBeChecked();
    const body = (await page.locator("#sat-question-content").boundingBox())!;
    const side = (await panel.boundingBox())!;
    expect(side.width).toBeCloseTo(420, 0);
    expect(side.height).toBeCloseTo(body.height, 0);
    expect(side.x + side.width).toBeCloseTo(body.x + body.width, 0);
    await checkSheet(panel);
    await expect(panel.locator("[data-sat-ref-canvas]")).toHaveAttribute(
      "data-sat-ref-layout",
      "portrait"
    );
    await expect(panel.getByRole("separator")).toHaveCount(0);
    const scroll = panel.locator("[data-sat-tool-scroll]");
    await scroll.evaluate((node) => {
      node.scrollTop = 100;
    });
    await expect
      .poll(() =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).scrollTop, VIEW_KEY)
      )
      .toBeGreaterThan(0);
    const savedScroll = await scroll.evaluate((node) => node.scrollTop);
    await panel.getByRole("button", { name: "Expand Reference Sheet" }).click();
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "expanded");
    await expect(question).toHaveAttribute("inert");
    await expect(panel.locator("[data-sat-ref-canvas]")).toHaveAttribute(
      "data-sat-ref-layout",
      "landscape"
    );
    expect((await panel.boundingBox())!.width).toBeCloseTo(body.width, 0);
    await checkSheet(panel);
    await panel.getByRole("button", { name: "Restore Reference Sheet" }).click();
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(savedScroll, 0);
    await expect(question).not.toHaveAttribute("inert");
    await panel.getByRole("button", { name: "Close Reference Sheet" }).click();
    expect((await question.boundingBox())!.width).toBeCloseTo(before.width, 0);
    await page.getByRole("button", { name: "Reference", exact: true }).click();
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "sidebar");
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(savedScroll, 0);
  });
}

test("reference keyboard zoom, complete formula access, and independent tool closure", async ({
  page,
}) => {
  await page.goto(ROUTE);
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
  const scroll = panel.getByRole("region", { name: "Reference sheet content" });
  await scroll.press("Control+=");
  await expect(panel.getByText("125%", { exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "Zoom in" }).click();
  await expect(panel.getByText("200%", { exact: true })).toBeVisible();
  await checkSheet(panel, false);
  await expect(panel.locator("math")).toHaveCount(11);
  await scroll.press("Control+0");
  await scroll.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Calculator", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "Close Calculator", exact: true }).click();
  await expect(panel).toBeVisible();
});
