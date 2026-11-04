import { expect, test } from "@playwright/test";

// E2EDD: armed highlight must not steal vertical scroll on SAT mobile.
// Fixture: long passage ensures the pane is scrollable in any viewport.
const fixture = "/e2e/fixtures/touch-selection/index.html?product=sat&ownedTouchSelection=1&long=1";

test("SAT armed highlight still allows vertical passage scrolling from text", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || !isMobile, "Requires browser-generated touch events.");
  await page.goto(fixture);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");
  const pane = page.locator("[data-sat-passage-scroll]");
  await expect(pane).toBeVisible();
  const range = await pane.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(range, "passage must be scrollable for this case to mean anything").toBeGreaterThan(0);

  // Start the gesture on real text, not on a gutter.
  const point = await surface.locator('[data-content-text-node]').first().evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode() as Text | null;
    if (!node) throw new Error("missing text");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const box = range.getBoundingClientRect();
    return { x: box.left + 2, y: box.top + box.height / 2 };
  });
  // Ensure the touch point is inside the visible pane.
  await pane.evaluate((el) => {
    el.scrollTop = 0;
  });
  const before = await pane.evaluate((el) => el.scrollTop);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id: 1 }],
  });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y - step * 10, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();

  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toHaveCount(0);
  await expect(page.locator("[data-student-selection-line]")).toHaveCount(0);
});

test("SAT armed highlight still claims an horizontal drag from text", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || !isMobile, "Requires browser-generated touch events.");
  await page.goto(fixture);
  await page.getByRole("button", { name: /^Highlights & Notes/ }).click();
  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await expect(surface).toHaveAttribute("data-student-selection-owner", "app");

  const { from, to } = await surface.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    while ((node = walker.nextNode() as Text | null)) {
      if ((node.data ?? "").includes("researchers")) break;
    }
    if (!node) throw new Error("missing phrase");
    const start = node.data.indexOf("researchers");
    const point = (offset: number) => {
      const r = document.createRange();
      r.setStart(node!, offset);
      r.setEnd(node!, offset + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    };
    return { from: point(start), to: point(start + 8) };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / 8,
          y: from.y + ((to.y - from.y) * step) / 8,
          id: 1,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();

  await expect(page.locator('[data-sat-selection-toolbar="true"]')).toBeVisible();
});
