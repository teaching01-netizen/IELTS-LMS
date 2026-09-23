import { expect, test, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type Point = { x: number; y: number };

async function setScreenZoom(page: Page, target: number) {
  const plane = page.locator('[data-sat-zoom-plane]');
  const current = Number(await plane.getAttribute('data-sat-screen-zoom'));
  const steps = Math.round(Math.abs(target - current) / 0.25);
  if (steps > 0) {
    await page.getByRole('button', { name: 'Display', exact: true }).click();
    const display = page.getByRole('dialog', { name: 'Display' });
    expect(await display.evaluate((element) => element.closest('[data-sat-exam-overlay-root]') !== null)).toBe(true);
    const action = target < current ? 'Decrease screen zoom' : 'Increase screen zoom';
    for (let step = 0; step < steps; step += 1) {
      await display.getByRole('button', { name: action }).click();
    }
    await expect(plane).toHaveAttribute('data-sat-screen-zoom', String(target));
    await display.getByRole('button', { name: 'Close display settings' }).click();
  }
  await expect(plane).toHaveAttribute('data-sat-screen-zoom', String(target));
}

async function readShellGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    return {
      zoom: Number(document.querySelector('[data-sat-zoom-plane]')?.getAttribute('data-sat-screen-zoom')),
      viewport: box('[data-sat-exam-viewport]'),
      topbar: box('.sat-exam-topbar'),
      footer: box('.sat-exam-footer'),
      main: box('#sat-question-content'),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

async function stimulusDragPoints(page: Page): Promise<{ from: Point; to: Point }> {
  return page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const words: Array<{ x: number; y: number }> = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const matcher = /\S+/g;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(node.data))) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          words.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }
      }
    }
    for (let index = 0; index < words.length - 1; index += 1) {
      const first = words[index]!;
      const second = words[index + 1]!;
      if (Math.abs(first.y - second.y) < 32 && Math.abs(second.x - first.x) > 6) {
        return { from: { x: first.x, y: first.y }, to: { x: second.x, y: second.y } };
      }
    }
    throw new Error('The visible SAT stimulus did not contain two measurable adjacent words.');
  });
}

async function touchDrag(page: Page, browserName: string, points: { from: Point; to: Point }) {
  const { from, to } = points;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: from.x + (to.x - from.x) * step / 8,
          y: from.y + (to.y - from.y) * step / 8,
          id: 1,
        }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }

  const surface = page.locator('[data-sat-annotation-region="stimulus"]');
  await surface.dispatchEvent('pointerdown', {
    pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1,
    clientX: from.x, clientY: from.y,
  });
  for (let step = 1; step <= 8; step += 1) {
    await surface.dispatchEvent('pointermove', {
      pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1,
      clientX: from.x + (to.x - from.x) * step / 8,
      clientY: from.y + (to.y - from.y) * step / 8,
    });
  }
  await surface.dispatchEvent('pointerup', {
    pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 0,
    clientX: to.x, clientY: to.y,
  });
}

async function selectionGeometry(page: Page) {
  return page.evaluate(() => {
    const handle = (edge: 'start' | 'end') => {
      const element = document.querySelector<HTMLElement>(`[data-student-selection-handle="${edge}"]`);
      if (!element) return null;
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(element.style.transform);
      const target = element.getBoundingClientRect();
      const grip = element.querySelector('.selection-v2-grip-visual')?.getBoundingClientRect();
      return {
        x: match ? Number(match[1]) : null,
        y: match ? Number(match[2]) : null,
        width: target.width,
        height: target.height,
        gripWidth: grip?.width ?? 0,
      };
    };
    const loupe = document.querySelector<HTMLElement>('[data-selection-loupe]');
    const loupeBox = loupe?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>('[data-selection-loupe-content]');
    const transform = content ? getComputedStyle(content).transform : 'none';
    const contentScale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    return {
      start: handle('start'),
      end: handle('end'),
      loupe: loupeBox ? { width: loupeBox.width, height: loupeBox.height } : null,
      loupeContentScale: contentScale,
    };
  });
}

async function dragStartHandle(page: Page, browserName: string, screenZoom: number) {
  const handle = page.locator('[data-student-selection-handle="start"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('The start selection handle has no rendered box.');
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const destination = { x: origin.x + 24 * screenZoom, y: origin.y };

  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 2 }] });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: origin.x + (destination.x - origin.x) * step / 6,
          y: origin.y,
          id: 2,
        }],
      });
    }
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
  }

  await handle.dispatchEvent('pointerdown', {
    pointerId: 2, pointerType: 'touch', isPrimary: true, buttons: 1,
    clientX: origin.x, clientY: origin.y,
  });
  for (let step = 1; step <= 6; step += 1) {
    await handle.dispatchEvent('pointermove', {
      pointerId: 2, pointerType: 'touch', isPrimary: true, buttons: 1,
      clientX: origin.x + (destination.x - origin.x) * step / 6,
      clientY: origin.y,
    });
  }
  return async () => {
    await handle.dispatchEvent('pointerup', {
      pointerId: 2, pointerType: 'touch', isPrimary: true, buttons: 0,
      clientX: destination.x, clientY: destination.y,
    });
  };
}

async function exerciseSelectionAtZoom(page: Page, browserName: string, screenZoom: number) {
  const stimulus = page.locator('[data-sat-annotation-region="stimulus"]');
  await expect(stimulus).toBeVisible();
  await expect(stimulus).toHaveAttribute('data-student-owned-touch-selection', 'true');
  const points = await stimulusDragPoints(page);
  await touchDrag(page, browserName, points);

  const selectionToolbar = page.locator('[data-sat-selection-toolbar="true"]');
  await expect(selectionToolbar).toBeVisible();
  const handles = page.locator('[data-student-selection-handle]');
  await expect(handles).toHaveCount(2);
  const before = await selectionGeometry(page);
  expect(before.start).not.toBeNull();
  expect(before.end).not.toBeNull();
  for (const handle of [before.start!, before.end!]) {
    expect(handle.width).toBe(44);
    expect(handle.height).toBe(44);
    expect(handle.gripWidth).toBeCloseTo(12 * screenZoom, 0);
  }

  const release = await dragStartHandle(page, browserName, screenZoom);
  try {
    await expect(page.locator('[data-selection-loupe]')).toBeVisible();
    const viewport = await page.locator('[data-sat-exam-viewport]').boundingBox();
    expect(viewport).not.toBeNull();
    const expectedLens = Math.round(Math.min(150, Math.max(120, Math.min(viewport!.width, viewport!.height) * 0.34)));
    const during = await selectionGeometry(page);
    expect(during.loupe?.width).toBe(expectedLens);
    expect(during.loupe?.height).toBe(expectedLens);
    expect(during.loupeContentScale).toBeCloseTo(screenZoom * 1.5, 2);
    expect(during.start!.x).toBeGreaterThan(before.start!.x);
    expect(during.end!.x).toBe(before.end!.x);
    expect(during.start!.y).toBe(before.start!.y);
    expect(during.end!.y).toBe(before.end!.y);
  } finally {
    await release();
  }
  await expect(page.locator('[data-selection-loupe]')).toHaveCount(0);
  return selectionToolbar;
}

async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-save-state', 'idle', {
    timeout: 30_000,
  });
}

test.describe('SAT screen zoom', () => {
  test.describe.configure({ timeout: 240_000 });

  test('keeps owned selection handles and loupe aligned from 50% through 150%', async ({
    page,
    browserName,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Owned touch selection is only used on coarse pointers.');
    await page.setViewportSize({ width: 412, height: 915 });
    let selectionToolbar: Locator;
    for (const zoom of [0.5, 0.75, 1.5]) {
      // A fresh page clears the prior transient selection so each zoom gets a
      // real, independent touch gesture instead of a drag outside the toolbar.
      await page.goto('/__dev/sat-accessibility?ownedTouchSelection=1');
      await expect(page.getByTestId('sat-exam-shell')).toBeVisible();
      await setScreenZoom(page, zoom);
      const annotationToggle = page.getByRole('button', { name: /^Highlights & Notes/ });
      await annotationToggle.click();
      await expect(annotationToggle).toHaveAttribute('aria-pressed', 'true');
      selectionToolbar = await exerciseSelectionAtZoom(page, browserName, zoom);
    }

    await selectionToolbar!.getByRole('button', { name: 'Highlight Yellow' }).click();
    await expect(page.locator('[data-sat-annotation-region="stimulus"] [data-sat-highlight="true"]')).toHaveCount(1);
  });

  test('scales the shell, supports touch annotation, and preserves settings and answers', async ({
    page,
    browser,
    browserName,
    isMobile,
  }, testInfo) => {
    // The admin workflow needs desktop room; the student gets the project's
    // actual phone or iPad viewport in a separate context below.
    await page.setViewportSize({ width: 1280, height: 900 });
    const studentViewport = testInfo.project.name === 'webkit-ipad'
      ? { width: 1024, height: 768 }
      : { width: 412, height: 915 };
    const studentContext: BrowserContextOptions = {
      viewport: studentViewport,
      deviceScaleFactor: testInfo.project.name === 'webkit-ipad' ? 2 : 2.625,
      isMobile,
      hasTouch: isMobile,
    };
    const { studentContext: context, studentPage, scheduleId } = await createRunningSatSession(
      browser,
      page,
      { label: 'screen-zoom', studentContext },
    );

    try {
      const shell = studentPage.getByTestId('sat-exam-shell');
      const firstOption = studentPage.locator('input[type="radio"]').first();
      await firstOption.check();
      await expect(firstOption).toBeChecked();
      await waitForSatSaved(studentPage);

      // Set an independent text size and return screen scale to a known
      // baseline even when delivery's first auto-fit decision chose 75%.
      const startingZoom = Number(await studentPage.locator('[data-sat-zoom-plane]').getAttribute('data-sat-screen-zoom'));
      await studentPage.getByRole('button', { name: 'Display', exact: true }).click();
      const display = studentPage.getByRole('dialog', { name: 'Display' });
      await display.getByRole('button', { name: 'Increase text size' }).click();
      const zoomSteps = Math.round(Math.abs(1 - startingZoom) / 0.25);
      const zoomAction = startingZoom < 1 ? 'Increase screen zoom' : 'Decrease screen zoom';
      for (let step = 0; step < zoomSteps; step += 1) {
        await display.getByRole('button', { name: zoomAction }).click();
      }
      await expect(studentPage.locator('[data-sat-zoom-plane]')).toHaveAttribute('data-sat-screen-zoom', '1');
      await display.getByRole('button', { name: 'Close display settings' }).click();
      const baseline = await readShellGeometry(studentPage);
      expect(baseline.topbar).not.toBeNull();
      expect(baseline.footer).not.toBeNull();

      // A browser-generated touch drag on Chromium proves the production route
      // resolves a real selection at 50%; the WebKit run also verifies layout
      // with synthetic pointer input, while hardware Safari remains a release gate.
      await setScreenZoom(studentPage, 0.5);

      const directionsTrigger = studentPage.getByRole('button', { name: 'Directions' }).first();
      await directionsTrigger.click();
      const directions = studentPage.getByRole('dialog', { name: 'Directions' });
      await expect(directions).toBeVisible();
      expect(await directions.evaluate((element) => element.closest('[data-sat-exam-overlay-root]') !== null)).toBe(true);
      await studentPage.keyboard.press('Escape');

      await studentPage.getByRole('button', { name: 'More tools' }).click();
      const moreMenu = studentPage.getByRole('menu', { name: 'More tools' });
      await expect(moreMenu).toBeVisible();
      expect(await moreMenu.evaluate((element) => element.closest('[data-sat-exam-overlay-root]') !== null)).toBe(true);
      await studentPage.keyboard.press('Escape');

      await studentPage.getByRole('button', { name: /open question navigator/i }).click();
      const navigator = studentPage.locator('[data-sat-navigator-presentation]');
      await expect(navigator).toBeVisible();
      expect(await navigator.evaluate((element) => element.closest('[data-sat-exam-overlay-root]') !== null)).toBe(true);
      const navigatorBox = await navigator.boundingBox();
      expect(navigatorBox).not.toBeNull();
      expect(navigatorBox!.x).toBeGreaterThanOrEqual(0);
      expect(navigatorBox!.y).toBeGreaterThanOrEqual(0);
      expect(navigatorBox!.x + navigatorBox!.width).toBeLessThanOrEqual(studentViewport.width + 1);
      expect(navigatorBox!.y + navigatorBox!.height).toBeLessThanOrEqual(studentViewport.height + 1);
      await studentPage.keyboard.press('Escape');

      const highlightToggle = studentPage.getByRole('button', { name: /^Highlights & Notes/ });
      await highlightToggle.click();
      const selectionZooms = [0.5, 0.75, 1.5];
      let selectionToolbar: Locator;
      for (const zoom of selectionZooms) {
        if (zoom !== 0.5) await setScreenZoom(studentPage, zoom);
        selectionToolbar = await exerciseSelectionAtZoom(studentPage, browserName, zoom);
        const geometry = await readShellGeometry(studentPage);
        expect(geometry.zoom).toBe(zoom);
        expect(geometry.topbar!.height).toBeCloseTo(baseline.topbar!.height * zoom, 0);
        expect(geometry.footer!.height).toBeCloseTo(baseline.footer!.height * zoom, 0);
        expect(geometry.main!.height).toBeGreaterThan(0);
        expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      }

      const stimulus = studentPage.locator('[data-sat-annotation-region="stimulus"]');
      await selectionToolbar!.getByRole('button', { name: 'Highlight Yellow' }).click();
      await expect(stimulus.locator('[data-sat-highlight="true"]')).toHaveCount(1);
      await waitForSatSaved(studentPage);

      const savedPreferences = await studentPage.evaluate((id) => {
        const prefix = `sat-reading-preferences:v1:${id}:`;
        const key = Object.keys(localStorage).find((candidate) => candidate.startsWith(prefix));
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') as { examZoom?: number; textScale?: number } : null;
      }, scheduleId);
      expect(savedPreferences?.examZoom).toBe(1.5);
      expect(savedPreferences?.textScale).toBeGreaterThan(1);

      await studentPage.getByRole('button', { name: 'Next question' }).click();
      await expect(studentPage.locator('[data-sat-zoom-plane]')).toHaveAttribute('data-sat-screen-zoom', '1.5');
      await studentPage.getByRole('button', { name: 'Previous question' }).click();
      await expect(firstOption).toBeChecked();
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(shell).toBeVisible();
      await expect(studentPage.locator('[data-sat-zoom-plane]')).toHaveAttribute('data-sat-screen-zoom', '1.5');
      await expect(studentPage.locator('input[type="radio"]').first()).toBeChecked();
      await expect(studentPage.locator('[data-sat-annotation-region="stimulus"] [data-sat-highlight="true"]')).toHaveCount(1);
      await studentPage.getByRole('button', { name: 'Display', exact: true }).click();
      const restoredDisplay = studentPage.getByRole('dialog', { name: 'Display' });
      await expect(restoredDisplay).toContainText('150%');
      await expect(restoredDisplay).toContainText('115%');
    } finally {
      await context.close();
    }
  });
});
