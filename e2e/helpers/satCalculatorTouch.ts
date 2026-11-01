/**
 * Helpers for the SAT calculator touch-resize suite.
 *
 * Every measurement is taken from the real rendered window, never from the
 * policy tables: the point of the suite is that the *pixels* the student gets
 * match the contract in docs/plans/2026-11-01-sat-calculator-touch-resize-e2e-plan.md.
 *
 * Touch input: Chromium drives native multi-point touch through CDP (the same
 * path e2e/sat-math-tools.spec.ts already uses). WebKit has no CDP, so input
 * there goes through Playwright pointer input while the *rendering* and the
 * `pointer: coarse` media query are the emulated iPad ones — which is exactly
 * what the plan's §4 gate decided once WebKit turned out to report coarse.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const ROUTE = "/__dev/sat-accessibility?mode=math";
export const CALC_TOOL = "calculator:portrait-v2";
export const GEOMETRY_KEY = `sat-tool-geometry:v2:debug-schedule:debug-attempt:debug-module:${CALC_TOOL}`;
export const VIEW_KEY = "sat-tool-view:v1:debug-schedule:debug-attempt:debug-module";
export const HINT_KEY = "sat-tool-hint-seen:v1:Calculator";

export const RESIZE_NODE = "[data-sat-resize-edge],[data-sat-resize-handle]";
export const EDGE_NODE = "[data-sat-resize-edge]";
export const HANDLE_NODE = "[data-sat-resize-handle]";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function calculator(page: Page): Locator {
  return page.getByRole("dialog", { name: "Calculator", exact: true });
}

export function isChromium(page: Page): boolean {
  return page.context().browser()?.browserType().name() === "chromium";
}

/** True when the page reports a coarse primary pointer (the CSS gate). */
export async function coarsePointer(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia("(pointer: coarse)").matches);
}

/** True when the context was created with a touch device profile. */
export async function hasTouch(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.maxTouchPoints > 0);
}

/**
 * Readiness gate. The harness mounts the real Desmos embed, so a test that
 * measured before the calculator frame settled would be measuring a skeleton.
 * Fails loudly instead of skipping: a silent skip would hide a broken harness.
 */
export async function waitForDesmos(page: Page, timeout = 60_000): Promise<void> {
  const warm = page.locator('[data-sat-trusted-tool="desmos"]');
  await warm.waitFor({ state: "attached", timeout });
  await expect
    .poll(
      () => warm.getAttribute("data-desmos-both-modes-ready"),
      { timeout, message: "Desmos did not finish loading; the calculator harness needs network access." }
    )
    .toBe("true");
}

export interface OpenOptions {
  /** Extra query string appended to ROUTE, e.g. "&paused=1". */
  query?: string;
  /** Open through the toolbar button (default) or straight from ?tool=calculator. */
  via?: "button" | "query";
  /** Clear tool geometry, view state and hint memory before opening. */
  reset?: boolean;
}

/** Clear every piece of tool state the calculator persists. */
export async function resetToolStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sat-tool-")) window.localStorage.removeItem(key);
    }
  });
}

/**
 * Open the calculator and return its dialog. `page.goto` is the only
 * navigation, so callers that need a clean slate reset storage *inside* the
 * page before opening.
 */
export async function openCalculator(page: Page, options: OpenOptions = {}): Promise<Locator> {
  const query = options.query ?? "";
  const via = options.via ?? "button";
  await page.goto(`${ROUTE}${query}${via === "query" ? "&tool=calculator" : ""}`);
  if (options.reset) await resetToolStorage(page);
  await waitForDesmos(page);
  if (via === "button") {
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
  }
  const panel = calculator(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-sat-tool-window", "Calculator");
  return panel;
}

/** The element's border box in CSS pixels, in the suite's {x,y,w,h} shape. */
export async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Element has no box");
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** The calculator's inner edge/resize layer. */
export function nonResizing(node: Element | null): boolean {
  return !node?.closest?.(RESIZE_NODE);
}

export interface Hit {
  x: number;
  y: number;
  tag: string;
  resize: string | null;
}

/**
 * Walk the window's padding box and report every point whose topmost element
 * is a resize node. The 1px border is excluded by design: the touch bands
 * overlay it, and the border is chrome, not Desmos.
 */
export async function hitScan(
  page: Page,
  panel: Locator,
  options: { step?: number; ring?: number; ringStep?: number } = {}
): Promise<Hit[]> {
  void page;
  return panel.evaluate((panelEl, { step, ring, ringStep }) => {
    const isResize = (node: Element | null) =>
      node?.closest?.("[data-sat-resize-edge],[data-sat-resize-handle]") ?? null;
    const box = panelEl.getBoundingClientRect();
    const style = getComputedStyle(panelEl);
    // The window border is chrome, not Desmos: the touch bands may sit on it.
    // The border is a CSS length inside the zoom plane, so convert it to screen
    // pixels, then allow 1px of sub-pixel hit-test rounding at the seam.
    const scale = panelEl.offsetWidth > 0 ? box.width / panelEl.offsetWidth : 1;
    const edge = (cssPx: number) => (Number.parseFloat(String(cssPx)) || 0) * scale + 1;
    const inset = {
      left: edge(style.borderLeftWidth),
      top: edge(style.borderTopWidth),
      right: edge(style.borderRightWidth),
      bottom: edge(style.borderBottomWidth),
    };
    const x0 = Math.ceil(box.left + inset.left + 0.5);
    const y0 = Math.ceil(box.top + inset.top + 0.5);
    const x1 = Math.floor(box.right - inset.right - 0.5);
    const y1 = Math.floor(box.bottom - inset.bottom - 0.5);
    const points: { x: number; y: number; tag: string; resize: string | null }[] = [];
    const inRing = (x: number, y: number) =>
      x - x0 < ring || y - y0 < ring || x1 - x < ring || y1 - y < ring;
    const probe = (x: number, y: number) => {
      const node = document.elementFromPoint(x, y);
      const resize = isResize(node);
      if (!resize) return;
      const kind =
        resize.getAttribute("data-sat-resize-edge") ??
        resize.getAttribute("data-sat-resize-handle");
      points.push({
        x,
        y,
        tag: node ? `${node.tagName}.${String(node.className).slice(0, 40)}` : "null",
        resize: kind,
      });
    };
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        if (inRing(x, y)) continue;
        probe(x, y);
      }
    }
    for (let y = y0; y <= y1; y += ringStep) {
      for (let x = x0; x <= x1; x += ringStep) {
        if (!inRing(x, y)) continue;
        probe(x, y);
      }
    }
    // Always probe the padding-box extremes themselves.
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ] as const)
      probe(x, y);
    return points;
  }, { step: options.step ?? 4, ring: options.ring ?? 48, ringStep: options.ringStep ?? 2 });
}

/** What sits under a point, expressed as a resize kind when it is one. */
export async function hitAt(page: Page, x: number, y: number): Promise<Hit> {
  return page.evaluate(
    ({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      const resize = node?.closest?.("[data-sat-resize-edge],[data-sat-resize-handle]") ?? null;
      return {
        x,
        y,
        tag: node ? `${node.tagName}.${String(node.className).slice(0, 40)}` : "null",
        resize: resize
          ? resize.getAttribute("data-sat-resize-edge") ??
            resize.getAttribute("data-sat-resize-handle")
          : null,
      };
    },
    { x, y }
  );
}

/** Probe points 10px outside each edge/corner of the window. */
export async function bandProbe(page: Page, box: Box): Promise<Record<string, Hit>> {
  const { x, y, w, h } = box;
  const points: Record<string, [number, number]> = {
    n: [x + w / 2, y - 10],
    s: [x + w / 2, y + h + 10],
    e: [x + w + 10, y + h / 2],
    w: [x - 10, y + h / 2],
    ne: [x + w + 10, y - 10],
    nw: [x - 10, y - 10],
    se: [x + w + 10, y + h + 10],
    sw: [x - 10, y + h + 10],
  };
  const result: Record<string, Hit> = {};
  for (const [key, [px, py]] of Object.entries(points)) {
    result[key] = await hitAt(page, px, py);
  }
  return result;
}

/* ── Input ──────────────────────────────────────────────────────────────── */

const cdpSessions = new WeakMap<Page, Promise<Awaited<ReturnType<import("@playwright/test").BrowserContext["newCDPSession"]>>>>();

async function cdp(page: Page) {
  const existing = cdpSessions.get(page);
  if (existing) return existing;
  const created = page.context().newCDPSession(page);
  cdpSessions.set(page, created);
  return created;
}

export interface DragOptions {
  steps?: number;
  /** End the gesture with pointercancel / touchCancel instead of release. */
  cancel?: boolean;
  /** `mouse` forces pointer input even on Chromium (for :hover/:active checks). */
  input?: "touch" | "mouse";
  /** Runs while the pointer is still down, after the moves. */
  mid?: () => Promise<void>;
}

/**
 * Drag from one viewport point to another using the project's native input.
 * Chromium gets real multi-point touch events; WebKit gets Playwright pointer
 * input, which exercises the same React pointer handlers.
 */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: DragOptions = {}
): Promise<void> {
  const steps = options.steps ?? 8;
  const useTouch = (options.input ?? "touch") === "touch" && (await hasTouch(page)) && isChromium(page);
  if (useTouch) {
    const session = await cdp(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from.x, y: from.y }],
    });
    for (let step = 1; step <= steps; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          },
        ],
      });
    }
    if (options.cancel) {
      if (options.mid) await options.mid();
      await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    } else {
      if (options.mid) await options.mid();
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    return;
  }
  await page.mouse.move(from.x, from.y);
  await watchPointerId(page);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
  }
  if (options.mid) await options.mid();
  if (options.cancel) {
    await cancelPointerGesture(page, from);
  } else {
    await page.mouse.up();
  }
}

/**
 * Cancel an in-flight pointer gesture. Mouse input has no native cancel, so
 * the pointercancel that iOS would fire is dispatched at the pre-gesture
 * point, which is where capture still routes it.
 */
export async function cancelPointerGesture(page: Page, at: { x: number; y: number }) {
  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const pointerId = (window as unknown as { __satPointerId?: number }).__satPointerId ?? 1;
      target?.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId,
          bubbles: true,
          cancelable: true,
          isPrimary: true,
          pointerType: "touch",
        })
      );
    },
    at
  );
}

/** Remember the pointerId of the gesture that starts at `at`. */
export async function watchPointerId(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __satPointerId?: number };
    w.__satPointerId = undefined;
    document.addEventListener(
      "pointerdown",
      (event) => {
        (window as unknown as { __satPointerId?: number }).__satPointerId = event.pointerId;
      },
      { capture: true, once: true }
    );
  });
}

/** Tap without moving (a finger press and lift). */
export async function tap(page: Page, x: number, y: number): Promise<void> {
  if (await hasTouch(page)) {
    await page.touchscreen.tap(x, y);
    return;
  }
  await page.mouse.click(x, y);
}

/* ── Geometry ───────────────────────────────────────────────────────────── */

export async function readGeometry(page: Page): Promise<Box | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { x: number; y: number; w: number; h: number };
      if (![parsed.x, parsed.y, parsed.w, parsed.h].every((n) => Number.isFinite(n))) return null;
      return { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h };
    } catch {
      return null;
    }
  }, GEOMETRY_KEY);
}

/** Seed a window rect (physical px) and reload so it is the restored one. */
export async function placeWindow(page: Page, box: Box, _query = ""): Promise<Locator> {
  await page.evaluate(
    ({ key, box }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), v: 2 })
      );
    },
    { key: GEOMETRY_KEY, box }
  );
  await page.reload();
  await waitForDesmos(page);
  const panel = calculator(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** Move the window by dragging its header grip (pointer input). */
export async function moveWindowBy(page: Page, panel: Locator, dx: number, dy: number): Promise<void> {
  const grip = panel.locator("[data-sat-tool-drag-handle]");
  const gripBox = await boxOf(grip);
  const from = { x: gripBox.x + gripBox.w / 2, y: gripBox.y + gripBox.h / 2 };
  await drag(page, from, { x: from.x + dx, y: from.y + dy }, { steps: 10, input: "mouse" });
}

/** Put the window at a known centred rect (drag, not reload). */
export async function centreWindow(page: Page, panel: Locator, size?: { w: number; h: number }): Promise<Box> {
  const viewport = page.viewportSize()!;
  let box = await boxOf(panel);
  const targetW = size?.w ?? box.w;
  const targetH = size?.h ?? box.h;
  const targetX = Math.round((viewport.width - targetW) / 2);
  const targetY = Math.round((viewport.height - targetH) / 2);
  if (Math.abs(targetW - box.w) > 1 || Math.abs(targetH - box.h) > 1) {
    // Resize first through the SE band so both axes land where asked.
    const from = { x: box.x + box.w + 10, y: box.y + box.h + 10 };
    await drag(page, from, { x: from.x + (targetW - box.w), y: from.y + (targetH - box.h) });
    box = await boxOf(panel);
  }
  const dx = targetX - box.x;
  const dy = targetY - box.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) await moveWindowBy(page, panel, dx, dy);
  return boxOf(panel);
}

export interface Bracket {
  corner: "ne" | "nw" | "sw" | "se";
  /** The two painted 4px strokes in viewport coordinates. */
  strokes: { x: number; y: number; w: number; h: number }[];
  color: string;
  opacity: string;
}

/** Read the four painted corner brackets from computed ::after styles. */
export async function brackets(page: Page, panel: Locator): Promise<Bracket[]> {
  return panel.evaluate((root) => {
    const corners = [
      ["ne", '[data-sat-resize-edge="ne"]'],
      ["nw", '[data-sat-resize-edge="nw"]'],
      ["sw", '[data-sat-resize-edge="sw"]'],
      ["se", "[data-sat-resize-handle]"],
    ] as const;
    const num = (value: string) => (value === "auto" ? null : Number.parseFloat(value));
    return corners.map(([corner, selector]) => {
      const el = root.querySelector(selector) as HTMLElement;
      const style = getComputedStyle(el, "::after");
      const rect = el.getBoundingClientRect();
      const top = num(style.top);
      const right = num(style.right);
      const bottom = num(style.bottom);
      const left = num(style.left);
      const width = Number.parseFloat(style.width);
      const height = Number.parseFloat(style.height);
      const bt = Number.parseFloat(style.borderTopWidth);
      const br = Number.parseFloat(style.borderRightWidth);
      const bb = Number.parseFloat(style.borderBottomWidth);
      const bl = Number.parseFloat(style.borderLeftWidth);
      const boxLeft = left != null ? rect.left + left : rect.right - (right ?? 0) - width - bl - br;
      const boxTop = top != null ? rect.top + top : rect.bottom - (bottom ?? 0) - height - bt - bb;
      const boxRight = boxLeft + width + bl + br;
      const boxBottom = boxTop + height + bt + bb;
      const strokes: { x: number; y: number; w: number; h: number }[] = [];
      if (bt > 0) strokes.push({ x: boxLeft, y: boxTop, w: boxRight - boxLeft, h: bt });
      if (bb > 0) strokes.push({ x: boxLeft, y: boxBottom - bb, w: boxRight - boxLeft, h: bb });
      if (bl > 0) strokes.push({ x: boxLeft, y: boxTop, w: bl, h: boxBottom - boxTop });
      if (br > 0) strokes.push({ x: boxRight - br, y: boxTop, w: br, h: boxBottom - boxTop });
      const painted =
        bt > 0 ? style.borderTopColor : bb > 0 ? style.borderBottomColor : br > 0 ? style.borderRightColor : style.borderLeftColor;
      return { corner, strokes, color: painted, opacity: style.opacity };
    });
  });
}

/** Resolved CSS custom property value on an element. */
export async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;inset:auto;visibility:hidden;color:var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

/** Normalise any CSS colour to `rgb()`/`rgba()` for exact comparison. */
export async function normalizeColor(page: Page, value: string): Promise<string> {
  return page.evaluate((value) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    return ctx.fillStyle;
  }, value);
}

/** WCAG relative luminance + contrast ratio for two CSS colours. */
export async function contrastRatio(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ({ a, b }) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const parse = (value: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = value;
        const normalized = ctx.fillStyle;
        if (normalized.startsWith("#")) {
          const hex = normalized.slice(1);
          return [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
            1,
          ] as const;
        }
        const parts = normalized.match(/[\d.]+/g)!.map(Number);
        return [parts[0], parts[1], parts[2], parts[3] ?? 1] as const;
      };
      const lum = (rgb: readonly number[]) => {
        const channel = (value: number) => {
          const s = value / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      };
      const foreground = parse(a);
      const background = parse(b);
      const lighter = Math.max(lum(foreground), lum(background));
      const darker = Math.min(lum(foreground), lum(background));
      return (lighter + 0.05) / (darker + 0.05);
    },
    { a, b }
  );
}

/** Composite the background behind a viewport point into one opaque colour. */
export async function backgroundAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const parse = (value: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = value;
        const normalized = ctx.fillStyle;
        if (normalized.startsWith("#")) {
          const hex = normalized.slice(1);
          return [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
            normalized.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1,
          ] as const;
        }
        const parts = normalized.match(/[\d.]+/g)!.map(Number);
        return [parts[0], parts[1], parts[2], parts[3] ?? 1] as const;
      };
      const stack: readonly (readonly number[])[] = [];
      let node: Element | null = document.elementFromPoint(x, y);
      while (node) {
        const style = getComputedStyle(node as HTMLElement);
        const colour = parse(style.backgroundColor);
        if (colour[3] > 0) stack.push(colour);
        node = node.parentElement;
      }
      stack.push([255, 255, 255, 1]);
      let composite = stack[stack.length - 1];
      for (let index = stack.length - 2; index >= 0; index -= 1) {
        const top = stack[index];
        const alpha = top[3];
        composite = [
          top[0] * alpha + composite[0] * (1 - alpha),
          top[1] * alpha + composite[1] * (1 - alpha),
          top[2] * alpha + composite[2] * (1 - alpha),
          1,
        ];
      }
      return `rgb(${Math.round(composite[0])}, ${Math.round(composite[1])}, ${Math.round(composite[2])})`;
    },
    { x, y }
  );
}

/** Compact (phone / Split View) presentation assertions. */
export async function expectCompactSheet(page: Page, panel: Locator): Promise<void> {
  await expect(panel).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
  await expect(panel).not.toHaveAttribute("data-sat-tool-resizable", "true");
  await expect(panel.locator(EDGE_NODE)).toHaveCount(0);
  await expect(panel.locator(HANDLE_NODE)).toHaveCount(0);
  await expect(panel.locator("[data-sat-tool-compact-header]")).toHaveCount(1);
  await expect
    .poll(() => panel.evaluate((el) => getComputedStyle(el).overflow))
    .toBe("hidden");
}

