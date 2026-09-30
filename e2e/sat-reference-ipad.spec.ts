import { expect, test, type Locator } from '@playwright/test';
import { ROUTE, GEOMETRY_KEY, VIEW_KEY, displayZoom, checkSheet } from './helpers/satReference';

async function checkTouchChrome(panel: Locator, floating = true) {
  await expect.poll(() => panel.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  for (const control of await panel.locator('button, [role="button"], [role="separator"]').all()) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44 - 1e-7);
    expect(bounds.height).toBeGreaterThanOrEqual(44 - 1e-7);
  }
  if (floating) {
    expect((await panel.locator('[data-sat-tool-header]').boundingBox())!.height).toBeCloseTo(44, 0);
    expect((await panel.locator('[data-sat-ref-toolbar]').boundingBox())!.height).toBeCloseTo(53, 0);
    await expect(panel.locator('[data-sat-resize-edge]')).toHaveCount(0);
    const resize = panel.getByRole('separator', { name: /Resize Reference Sheet/ });
    const gripBounds = (await resize.boundingBox())!;
    const windowBounds = (await panel.boundingBox())!;
    const border = await panel.evaluate((node) => {
      const scale = Number(node.closest('[data-sat-zoom-plane]')?.getAttribute('data-sat-screen-zoom') ?? 1);
      const style = getComputedStyle(node);
      return { right: Number.parseFloat(style.borderRightWidth) * scale, bottom: Number.parseFloat(style.borderBottomWidth) * scale };
    });
    expect(gripBounds.x + gripBounds.width).toBeCloseTo(windowBounds.x + windowBounds.width - border.right, 0);
    expect(gripBounds.y + gripBounds.height).toBeCloseTo(windowBounds.y + windowBounds.height - border.bottom, 0);
    const value = Number(await resize.getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThanOrEqual(Number(await resize.getAttribute('aria-valuemin')));
    expect(value).toBeLessThanOrEqual(Number(await resize.getAttribute('aria-valuemax')));
  }
}

const sizes = {
  min: { w: 700, h: 477 },
  default: null,
  max: { w: 920, h: 1000 },
  'restored-smaller': { w: 480, h: 360 },
};
for (const [name, geometry] of Object.entries(sizes)) {
  for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    test(`${name} at ${zoom * 100}%: resize, rotate open/closed, Split View and Stage Manager`, async ({ page }) => {
      const landscape = page.viewportSize()!;
      const portrait = { width: landscape.height, height: landscape.width };
      await page.addInitScript(({ geometry, zoom, geometryKey, viewKey }) => {
        localStorage.clear();
        if (geometry) localStorage.setItem(geometryKey, JSON.stringify({ v: 2, x: 100, y: 120, w: geometry.w / zoom, h: geometry.h / zoom }));
        localStorage.setItem(viewKey, JSON.stringify({ zoom: 1, hasBeenMoved: true, hasBeenResized: true }));
      }, { geometry, zoom, geometryKey: GEOMETRY_KEY, viewKey: VIEW_KEY });
      await page.goto(ROUTE);
      await displayZoom(page, zoom);
      const open = () => page.getByRole('button', { name: 'Reference', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Reference Sheet', exact: true });
      await open();
      await checkSheet(panel);
      await checkTouchChrome(panel);

      // Native touch input verifies double-tap reaches physical 200%.
      const touchBounds = (await panel.getByRole('region', { name: 'Reference sheet content' }).boundingBox())!;
      const x = touchBounds.x + touchBounds.width / 2;
      const y = touchBounds.y + touchBounds.height / 2;
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);
      await expect(panel.getByText('200%', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Fit sheet' })).toHaveAttribute('aria-pressed', 'false');
      await panel.getByRole('button', { name: 'Fit sheet' }).click();
      const stage = panel.locator('[data-sat-tool-scroll]');
      const before = await stage.evaluate((node) => ({ w: node.clientWidth, h: node.clientHeight }));
      const resize = panel.getByRole('separator', { name: /Resize Reference Sheet/ });
      const width = Number(await resize.getAttribute('aria-valuenow'));
      const min = Number(await resize.getAttribute('aria-valuemin'));
      const grip = (await resize.boundingBox())!;
      const direction = width > min + 8 ? -1 : 1;
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 + direction * 16, grip.y + grip.height / 2, { steps: 3 });
      await page.mouse.up();
      const after = await stage.evaluate((node) => ({ w: node.clientWidth, h: node.clientHeight }));
      expect(after.w !== before.w || after.h !== before.h).toBe(true);
      await checkSheet(panel);

      await page.setViewportSize(portrait);
      await checkSheet(panel);
      await checkTouchChrome(panel);
      await panel.getByRole('button', { name: 'Close Reference Sheet', exact: true }).click();
      await expect(panel).toHaveCount(0);
      await page.setViewportSize(landscape);
      await open();
      await checkSheet(panel);
      await checkTouchChrome(panel);

      const flags = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), VIEW_KEY);
      await page.setViewportSize({ width: 500, height: portrait.height });
      await expect(panel).toHaveAttribute('data-sat-tool-presentation', 'compact-sheet');
      await checkSheet(panel);
      await checkTouchChrome(panel, false);
      await panel.getByRole('button', { name: 'Reduce sheet' }).click();
      await expect(panel).toHaveAttribute('data-sat-tool-detent', 'medium');
      await checkSheet(panel);
      await panel.getByRole('button', { name: 'Expand sheet' }).click();
      await checkSheet(panel);
      await page.setViewportSize({ width: landscape.width, height: 520 });
      await expect(panel).toHaveAttribute('data-sat-tool-presentation', 'compact-sheet');
      await checkSheet(panel);
      await page.setViewportSize(landscape);
      await expect(panel).toHaveAttribute('data-sat-tool-presentation', 'floating');
      await checkSheet(panel);
      const restoredFlags = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), VIEW_KEY);
      expect(restoredFlags.hasBeenMoved).toBe(flags.hasBeenMoved);
      expect(restoredFlags.hasBeenResized).toBe(flags.hasBeenResized);
    });
  }
}

test('simulated home-screen safe areas protect the window and grip after drag, rotation and compact detents', async ({ page }) => {
  // Desktop WebKit cannot verify installed iPad web-app browser chrome.
  // Inject resolved env tokens to exercise the application's safe-area math.
  await page.goto(ROUTE);
  await page.addStyleTag({ content: ':root { --student-safe-top: 24px; --student-safe-bottom: 34px; --student-safe-left: 20px; --student-safe-right: 20px; }' });
  const landscape = page.viewportSize()!;
  const panel = page.getByRole('dialog', { name: 'Reference Sheet', exact: true });
  for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    await displayZoom(page, zoom);
    await page.getByRole('button', { name: 'Reference', exact: true }).click();
    await checkSheet(panel);
    const move = panel.getByRole('button', { name: /Move Reference Sheet/ });
    for (let step = 0; step < 8; step++) await move.press('Shift+ArrowDown');
    const bounds = (await panel.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(landscape.height - 34);
    await page.setViewportSize({ width: landscape.height, height: landscape.width });
    await checkSheet(panel);
    await page.setViewportSize({ width: 500, height: landscape.width });
    await checkSheet(panel);
    expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThanOrEqual(landscape.width - 33.9);
    await panel.getByRole('button', { name: 'Close Reference Sheet', exact: true }).click();
    await page.setViewportSize(landscape);
  }
});
