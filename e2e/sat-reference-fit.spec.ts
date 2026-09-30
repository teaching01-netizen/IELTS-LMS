import { expect, test } from "@playwright/test";
import { SAT_REFERENCE_HEADER_HEIGHT, SAT_REFERENCE_TOUCH_HEADER_HEIGHT, SAT_REFERENCE_TOOLBAR_HEIGHT } from "../src/features/student-delivery/domain/satToolSizePolicy";

import { ROUTE, GEOMETRY_KEY, VIEW_KEY, displayZoom, checkSheet } from './helpers/satReference';
test.use({ viewport: { width: 1920, height: 1440 } });

const sizes = {
  min: { x: 100, y: 120, w: 700, h: 477 },
  default: null,
  max: { x: 100, y: 120, w: 920, h: 1000 },
  "restored-smaller": { x: 100, y: 120, w: 480, h: 360 },
};
for (const [name, geometry] of Object.entries(sizes)) {
  for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    test(`${name} window at Display ${zoom * 100}%: open → resize → close → reopen`, async ({ page }) => {
      await page.addInitScript(({ geometry, geometryKey, viewKey }) => {
        localStorage.clear();
        if (geometry) localStorage.setItem(geometryKey, JSON.stringify({ ...geometry, v: 2 }));
        localStorage.setItem(viewKey, JSON.stringify({ zoom: 1, hasBeenMoved: true, hasBeenResized: true }));
      }, { geometry, geometryKey: GEOMETRY_KEY, viewKey: VIEW_KEY });
      await page.goto(ROUTE);
      await displayZoom(page, zoom);
      await page.getByRole("button", { name: "Reference", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
      await checkSheet(panel);
      await expect(panel.locator("[data-sat-tool-header]")).toHaveJSProperty("offsetHeight", Math.round(SAT_REFERENCE_HEADER_HEIGHT / zoom));
      await expect(panel.locator("[data-sat-ref-toolbar]")).toHaveJSProperty("offsetHeight", Math.round(SAT_REFERENCE_TOOLBAR_HEIGHT / zoom));
      const stage = panel.locator("[data-sat-tool-scroll]");
      const before = await stage.evaluate((node) => ({ w: node.clientWidth, h: node.clientHeight }));
      const resize = panel.getByRole("separator", { name: /Resize Reference Sheet/ });
      await resize.focus();
      await resize.press(name === "min" || name === "restored-smaller" ? "ArrowDown" : "ArrowUp");
      await expect.poll(() => stage.evaluate((node) => node.clientHeight)).not.toBe(before.h);
      await checkSheet(panel);
      await panel.getByRole("button", { name: "Close Reference Sheet", exact: true }).click();
      await expect(panel).toHaveCount(0);
      await page.getByRole("button", { name: "Reference", exact: true }).click();
      await checkSheet(panel);
    });
  }
}

test("touch controls, readable compact detents, and presentation changes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:3000${ROUTE}&tool=reference`);
    const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    await checkSheet(panel);
    await expect(panel.locator("[data-sat-tool-header]")).toHaveJSProperty("offsetHeight", SAT_REFERENCE_TOUCH_HEADER_HEIGHT);
    await expect.poll(() => panel.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
    for (const control of await panel.locator('button, [role="button"], [role="separator"]').all()) {
      const rect = await control.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    await checkSheet(panel);
    await panel.getByRole("button", { name: "Reduce sheet", exact: true }).click();
    await expect(panel).toHaveAttribute("data-sat-tool-detent", "medium");
    await checkSheet(panel);
    await panel.getByRole("button", { name: "Expand sheet", exact: true }).click();
    await expect(panel).toHaveAttribute("data-sat-tool-detent", "large");
    await checkSheet(panel);
    await page.setViewportSize({ width: 1280, height: 520 });
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    await checkSheet(panel);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(panel).toHaveAttribute("data-sat-tool-presentation", "floating");
    await checkSheet(panel);
  } finally { await context.close(); }
});

test("keyboard and double-click zoom to actual 200% and reset both scroll axes", async ({ page }) => {
  await page.goto(`${ROUTE}&tool=reference`);
  const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
  const stage = panel.getByRole("region", { name: "Reference sheet content" });
  await stage.dblclick({ position: { x: 120, y: 120 } });
  await expect(panel.getByText("200%", { exact: true })).toBeVisible();
  await expect(panel.getByText("Maximum zoom", { exact: true })).toBeVisible();
  await stage.evaluate((node) => { node.scrollLeft = 100; node.scrollTop = 100; });
  await stage.focus();
  await stage.press("Control+0");
  await expect(panel.getByRole("button", { name: "Fit sheet" })).toHaveAttribute("aria-pressed", "true");
  await expect(stage).toHaveJSProperty("scrollTop", 0);
  await expect(stage).toHaveJSProperty("scrollLeft", 0);
  await stage.press("Control+Equal");
  await expect(panel.getByRole("button", { name: "Fit sheet" })).toHaveAttribute("aria-pressed", "false");
  await stage.press("Control+Minus");
  await expect(panel.getByRole("button", { name: "Fit sheet" })).toHaveAttribute("aria-pressed", "true");
  await stage.dblclick({ position: { x: 120, y: 120 } });
  await stage.dblclick({ position: { x: 120, y: 120 } });
  await expect(panel.getByRole("button", { name: "Fit sheet" })).toHaveAttribute("aria-pressed", "true");
  await checkSheet(panel);
});

test("native pinch and double-tap zoom the compact sheet", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Native multi-touch input uses Chromium's CDP driver.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:3000${ROUTE}&tool=reference`);
    const panel = page.getByRole("dialog", { name: "Reference Sheet", exact: true });
    const stage = panel.getByRole("region", { name: "Reference sheet content" });
    await expect(stage).toBeVisible();
    const rect = (await stage.boundingBox())!;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const cdp = await context.newCDPSession(page);
    const points = (radius: number) => [{ x: x - radius, y, id: 1 }, { x: x + radius, y, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(40) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(60) });
    await expect(panel.getByText("105%", { exact: true })).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(80) });
    await expect(panel.getByText("140%", { exact: true })).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await panel.getByRole("button", { name: "Fit sheet" }).tap();
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(panel.getByText("200%", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});
