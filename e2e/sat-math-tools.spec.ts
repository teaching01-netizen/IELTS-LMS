import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTE, displayZoom } from "./helpers/satReference";

const CALC_KEY =
  "sat-tool-geometry:v2:debug-schedule:debug-attempt:debug-module:calculator:portrait-v2";
const calculator = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Calculator", exact: true });

test("warmed Desmos opens within 100ms, retains real expressions and both iframe nodes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(ROUTE);
  const warm = page.locator('[data-sat-trusted-tool="desmos"]');
  await expect(warm).toHaveAttribute("data-desmos-both-modes-ready", "true", { timeout: 60_000 });
  const scientific = page.frameLocator('iframe[data-desmos-mode="scientific"]');
  const frames = await page.locator("iframe[data-desmos-mode]").elementHandles();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("desmos.com") &&
      ["document", "script", "stylesheet"].includes(request.resourceType())
    )
      requests.push(request.url());
  });
  // Measure the UI reveal from actual click dispatch to the next painted frame.
  const latency = await page.getByRole("button", { name: "Calculator", exact: true }).evaluate(
    (button) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        button.addEventListener(
          "click",
          () =>
            requestAnimationFrame(() => {
              const visible =
                getComputedStyle(document.querySelector('[data-sat-tool-window="Calculator"]')!)
                  .visibility === "visible";
              resolve(visible ? performance.now() - start : Number.POSITIVE_INFINITY);
            }),
          { once: true }
        );
        (button as HTMLElement).click();
      })
  );
  expect(latency).toBeLessThan(100);
  await expect(calculator(page).locator("[data-desmos-loading]")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Graphing", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Scientific", exact: true }).click();
  await expect(scientific.getByRole("application")).toBeVisible();
  await scientific.getByRole("button", { name: "1", exact: true }).click();
  await scientific.getByRole("button", { name: "Plus", exact: true }).click();
  await scientific.getByRole("button", { name: "2", exact: true }).click();
  await scientific.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(
    scientific.getByRole("textbox", { name: "Expression 1: 1 plus 2 equals 3", exact: true })
  ).toHaveCount(1);
  await expect(
    scientific.getByRole("region", { name: "Expression List" }).getByText("3", { exact: true })
  ).toBeVisible();
  await page.getByRole("radio", { name: "Graphing", exact: true }).click();
  await expect(
    page.frameLocator('iframe[data-desmos-mode="graphing"]').getByRole("application")
  ).toBeVisible();
  await page.getByRole("radio", { name: "Scientific", exact: true }).click();
  await page.getByRole("button", { name: "Close Calculator", exact: true }).click();
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(scientific.getByRole("textbox", { name: /1 plus 2 equals 3/ })).toHaveCount(1);
  for (let i = 0; i < frames.length; i++)
    expect(
      await page
        .locator("iframe[data-desmos-mode]")
        .nth(i)
        .evaluate((current, original) => current === original, frames[i])
    ).toBe(true);
  expect(requests).toEqual([]);
});

for (const zoom of [0.5, 1, 1.5, 2]) {
  test(`calculator grip drag, resize and bounds at Display ${zoom * 100}%`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(ROUTE);
    await displayZoom(page, zoom);
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    const panel = calculator(page);
    const body = (await page.locator("#sat-question-content").boundingBox())!;
    const initial = (await panel.boundingBox())!;
    expect(initial.x).toBeCloseTo(body.x + 8, 0);
    expect(initial.y).toBeCloseTo(body.y + 8, 0);
    expect(initial.width).toBeGreaterThanOrEqual(399);
    expect(initial.width).toBeLessThanOrEqual(441);
    expect(initial.height).toBeCloseTo(body.height - 16, 0);
    for (const control of await panel
      .locator('[role="radio"], [role="button"], [role="separator"], [data-sat-tool-close]')
      .all()) {
      const size = (await control.boundingBox())!;
      expect(size.width).toBeGreaterThanOrEqual(43.9);
      expect(size.height).toBeGreaterThanOrEqual(43.9);
    }
    const grip = panel.getByRole("button", { name: /Move Calculator/ });
    const hit = (await grip.boundingBox())!;
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x + hit.width / 2 + 120, hit.y + hit.height / 2, { steps: 5 });
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(initial.x + 120, 0);
    expect(await page.evaluate((key) => localStorage.getItem(key), CALC_KEY)).toBeNull();
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).x, CALC_KEY))
      .toBeCloseTo(initial.x + 120, 0);
    await grip.press("ArrowRight");
    expect((await panel.boundingBox())!.x).toBeCloseTo(initial.x + 128, 0);
    const resize = panel.getByRole("separator", { name: /Resize Calculator/ });
    await resize.press("ArrowRight");
    expect((await panel.boundingBox())!.width).toBeCloseTo(initial.width + 8, 0);
    if (isMobile) {
      await grip.tap();
      await expect(panel).toHaveAttribute("data-sat-touch-interaction", "true");
      await expect(panel.locator(".sat-tool-tip").first()).toBeHidden();
    }
  });
}

test("popover priority and accessibility with both tools open", async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  const panel = calculator(page);
  const grip = panel.getByRole("button", { name: /Move Calculator/ });
  // Position the tool under Display to prove overlays win hit testing.
  for (let i = 0; i < 25; i++) await grip.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("button", { name: "Increase screen zoom" }).click();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.addScriptTag({
    content: readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8"),
  });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Element,
            options: unknown
          ) => Promise<{ violations: { id: string; impact: string }[] }>;
        };
      }
    ).axe;
    return (
      await axe.run(document.body, {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa"],
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => v.id);
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: "test-results/sat-math-tools.png" });
});

test("proctor pause keeps both frames inert and blocks calculator interaction", async ({
  page,
}) => {
  await page.goto(`${ROUTE}&paused=1&tool=calculator`);
  const panel = page.locator('[data-sat-tool-window="Calculator"]');
  await expect(panel).toHaveAttribute("inert");
  await expect(page.locator("iframe[data-desmos-mode]")).toHaveCount(2);
  for (const iframe of await page.locator("iframe[data-desmos-mode]").all()) {
    await expect(iframe).toHaveAttribute("inert");
    await expect(iframe).toHaveAttribute("tabindex", "-1");
  }
  await expect(page.getByText("Accessibility harness pause", { exact: true })).toBeVisible();
});

test("native touch drags the dot grip without showing touch hints", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Native multi-point touch dispatch uses Chromium CDP.");
  await page.goto(ROUTE);
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  const panel = calculator(page);
  const before = (await panel.boundingBox())!;
  const handle = (await panel.getByRole("button", { name: /Move Calculator/ }).boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + step * 24, y }],
    });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(before.x + 120, 0);
  await expect(panel).toHaveAttribute("data-sat-touch-interaction", "true");
  for (const hint of await panel.locator(".sat-tool-tip, .sat-tool-hint").all())
    await expect(hint).toBeHidden();
  await session.detach();
});
