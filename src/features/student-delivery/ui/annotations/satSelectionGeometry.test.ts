import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  placeSatAnnotationDock,
  placeSatAnnotationSurface,
  satAnnotationAnchorGeometryFor,
  satAnnotationBlockFor,
  satAnnotationLineRects,
  satAnnotationRangeFor,
  satAnnotationRectFor,
  SAT_ANNOTATION_BUDGET_DEFAULTS,
  type AnnotationPlacement,
  type SatAnchorGeometry,
} from './satSelectionGeometry';

const bounds = { left: 0, top: 0, width: 800, height: 600 };
const viewport = { left: 0, top: 0, width: 800, height: 600 };
/** A measured floating surface: the size the engine has to place. */
const size = { width: 288, height: 108 };

function mountPassage(text: string, region = 'stimulus', nodeId = 'p1'): HTMLElement {
  document.body.innerHTML = `<div data-sat-annotation-region="${region}"><div data-content-text-node="${nodeId}"><span><span>${text}</span></span></div></div>`;
  return document.body.firstElementChild as HTMLElement;
}

/**
 * jsdom has no Range measurement at all, so the test supplies one. Defining it
 * (rather than spying) keeps the production guard `typeof
 * range.getBoundingClientRect === 'function'` meaningful: without this stub the
 * geometry helper correctly reports "cannot measure".
 */
function stubRangeRect(rect: Partial<DOMRect>): void {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => ({
      top: 100, bottom: 120, left: 200, right: 320, width: 120, height: 20, x: 200, y: 100,
      toJSON: () => ({}),
      ...rect,
    }),
  });
}

function stubRangeRects(rects: Array<Partial<DOMRect>>): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => rects as unknown as DOMRectList,
  });
}

function lineRect(top: number, bottom: number, left: number, right: number) {
  return { top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}

/**
 * An anchor box with its per-line rects. Only the engine's inputs matter here —
 * no DOM, because placement is a pure decision.
 */
function geometry(input: {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  firstLine?: { top: number; bottom: number; left: number; right: number };
  lastLine?: { top: number; bottom: number; left: number; right: number };
}): SatAnchorGeometry {
  const left = input.left ?? 200;
  const right = input.right ?? 600;
  const flat = { top: input.top, bottom: input.bottom, left, right };
  return {
    left,
    right,
    top: input.top,
    bottom: input.bottom,
    width: right - left,
    height: input.bottom - input.top,
    firstLine: input.firstLine ?? flat,
    lastLine: input.lastLine ?? flat,
  };
}

function place(
  anchor: SatAnchorGeometry,
  options: {
    previous?: AnnotationPlacement | null;
    touch?: boolean;
    bounds?: typeof bounds;
    viewport?: typeof viewport;
    size?: typeof size;
    budgets?: typeof SAT_ANNOTATION_BUDGET_DEFAULTS;
  } = {},
): AnnotationPlacement {
  return placeSatAnnotationSurface({
    anchor,
    bounds: options.bounds ?? bounds,
    viewport: options.viewport ?? viewport,
    size: options.size ?? size,
    previous: options.previous ?? null,
    touch: options.touch ?? false,
    ...(options.budgets ? { budgets: options.budgets } : {}),
  });
}

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

afterEach(() => {
  vi.restoreAllMocks();
  // Remove the injected measurement so the "cannot measure" case stays testable.
  delete (Range.prototype as unknown as Record<string, unknown>)['getBoundingClientRect'];
  delete (Range.prototype as unknown as Record<string, unknown>)['getClientRects'];
  document.body.innerHTML = '';
});

describe('satSelectionGeometry: measuring the anchored span', () => {
  it('resolves the anchored block and rejects anchors the DOM no longer satisfies', () => {
    mountPassage('A tree grows.');
    expect(satAnnotationBlockFor(anchor)).not.toBeNull();
    // Wrong region, wrong node, or a dangling offset all resolve to nothing:
    // the toolbar must never point at a neighbouring passage.
    expect(satAnnotationBlockFor({ ...anchor, nodeId: 'prompt:p1' })).toBeNull();
    expect(satAnnotationBlockFor({ ...anchor, nodeId: 'stimulus:other' })).toBeNull();
    expect(satAnnotationBlockFor({ ...anchor, startOffset: 90, endOffset: 94 })).toBeNull();
  });

  it('builds a range covering exactly the anchored span', () => {
    mountPassage('A tree grows.');
    const range = satAnnotationRangeFor(anchor);
    expect(range?.toString()).toBe('tree');
    // Offsets past the end of the block cannot produce a usable range.
    expect(satAnnotationRangeFor({ ...anchor, startOffset: 0, endOffset: 999 })).toBeNull();
  });

  it('returns null geometry when the engine cannot measure ranges (never a wrong position)', () => {
    mountPassage('A tree grows.');
    delete (Range.prototype as unknown as Record<string, unknown>)['getBoundingClientRect'];
    // jsdom omits Range measurement entirely; the caller falls back to a safe
    // placement rather than guessing.
    expect(satAnnotationRectFor(anchor)).toBeNull();
    expect(satAnnotationAnchorGeometryFor(anchor)).toBeNull();
  });

  it('reads one line per rendered line, merging fragments of the same one', () => {
    const lines = satAnnotationLineRects({
      getClientRects: () =>
        [
          lineRect(100, 120, 10, 200),
          // Same line, a second fragment (an inline mark, a bidi run).
          lineRect(100, 120, 210, 300),
          lineRect(125, 145, 10, 150),
        ] as unknown as DOMRectList,
    } as unknown as Range);
    expect(lines).toEqual([
      { top: 100, bottom: 120, left: 10, right: 300 },
      { top: 125, bottom: 145, left: 10, right: 150 },
    ]);
  });

  it('anchors a wrapped selection to its real first and last lines', () => {
    mountPassage('A tree grows in the yard.');
    stubRangeRect({ top: 100, bottom: 145, left: 10, right: 300, width: 290, height: 45 });
    stubRangeRects([lineRect(100, 120, 10, 300), lineRect(125, 145, 10, 150)]);
    const measured = satAnnotationAnchorGeometryFor(anchor);
    expect(measured?.firstLine).toEqual({ top: 100, bottom: 120, left: 10, right: 300 });
    expect(measured?.lastLine).toEqual({ top: 125, bottom: 145, left: 10, right: 150 });
  });
});

describe('satSelectionGeometry: where the surface goes', () => {
  it('prefers the space above the selection and flips below when there is none', () => {
    const above = place(geometry({ top: 300, bottom: 320 }));
    expect(above.mode).toBe('floating');
    expect(above.side).toBe('above');
    expect(above.flipped).toBe(false);
    expect(above.top).toBe(300 - size.height - SAT_ANNOTATION_BUDGET_DEFAULTS.gap);

    const below = place(geometry({ top: 10, bottom: 30 }));
    expect(below.side).toBe('below');
    expect(below.flipped).toBe(true);
    expect(below.top).toBe(30 + SAT_ANNOTATION_BUDGET_DEFAULTS.gap);
  });

  it('refuses to squeeze the surface into a gap it only technically fits', () => {
    // 130px of room above, 132 required: the comfortable answer is the other
    // side, not a cramped toolbar.
    const cramped = place(geometry({ top: 142, bottom: 162 }));
    expect(cramped.side).toBe('below');

    // The same geometry without the comfort buffer *would* have fitted.
    const bare = place(geometry({ top: 142, bottom: 162 }), {
      budgets: { ...SAT_ANNOTATION_BUDGET_DEFAULTS, comfort: 0, comfortFine: 0 },
    });
    expect(bare.side).toBe('above');
  });

  it('reserves the native selection menu its own zone on a coarse pointer', () => {
    // A short visual viewport: 188px above, 168px below. A mouse only needs 132,
    // but touch must also keep the selection menu's 80px zone and a comfort
    // buffer clear — neither side can honour that, so the dock is the answer.
    const short = { left: 0, top: 0, width: 800, height: 400 };
    const inShortViewport = geometry({ top: 200, bottom: 220 });
    const withMouse = place(inShortViewport, { viewport: short, bounds: short });
    expect(withMouse.mode).toBe('floating');
    expect(withMouse.side).toBe('above');

    const withFinger = place(inShortViewport, { viewport: short, bounds: short, touch: true });
    expect(withFinger.mode).toBe('docked');
  });

  it('docks a selection that covers the viewport, where "nearby" has no meaning', () => {
    const whatTheStudentSelected = place(geometry({ top: 100, bottom: 340 }));
    expect(whatTheStudentSelected.mode).toBe('docked');
    // A selection inside the threshold still floats.
    expect(place(geometry({ top: 100, bottom: 260 })).mode).toBe('floating');
  });

  it('docks when the controls would have no usable room to sit in', () => {
    const narrow = { left: 0, top: 0, width: 300, height: 600 };
    expect(place(geometry({ top: 300, bottom: 320 }), { viewport: narrow, bounds: narrow }).mode).toBe('docked');

    const squashed = { left: 0, top: 0, width: 800, height: 140 };
    expect(place(geometry({ top: 60, bottom: 80 }), { viewport: squashed, bounds: squashed }).mode).toBe('docked');
  });

  it('keeps the side it chose while that side still fits', () => {
    const previous: AnnotationPlacement = {
      mode: 'floating', left: 256, top: 180, side: 'above', arrowX: 144, flipped: false, animated: false,
    };
    // Below the selection there is now more room, and above is still fine: the
    // side stays put instead of flipping on every measurement.
    const kept = place(geometry({ top: 212, bottom: 240 }), { previous });
    expect(kept.side).toBe('above');
  });

  it('switches sides only for a side that offers real room, and docks otherwise', () => {
    const previous: AnnotationPlacement = {
      mode: 'floating', left: 256, top: 180, side: 'above', arrowX: 144, flipped: false, animated: false,
    };
    const short = { left: 0, top: 0, width: 800, height: 400 };
    // Above has stopped fitting; below offers 200px, comfortably more than the
    // 132 required plus the switch margin — so the surface moves below.
    const switched = place(geometry({ top: 130, bottom: 188 }), { previous, viewport: short, bounds: short });
    expect(switched.side).toBe('below');

    // Below offers 148px: enough to fit, not enough to justify a jump. The dock
    // is the honest answer rather than a surface that looks like it lost its place.
    const docked = place(geometry({ top: 130, bottom: 240 }), { previous, viewport: short, bounds: short });
    expect(docked.mode).toBe('docked');
  });

  it('holds the dock for one selection instead of oscillating while the student scrolls', () => {
    const docked: AnnotationPlacement = {
      mode: 'docked', left: 12, top: 420, side: null, arrowX: 0, flipped: false, animated: false,
    };
    expect(place(geometry({ top: 300, bottom: 320 }), { previous: docked }).mode).toBe('docked');
  });

  it('hides while its source is off screen', () => {
    expect(place(geometry({ top: -40, bottom: -20 })).mode).toBe('hidden');
    expect(place(geometry({ top: 700, bottom: 720 })).mode).toBe('hidden');
  });

  it('clamps the surface inside the body and turns the caret toward its source', () => {
    const left = place(geometry({ top: 300, bottom: 320, left: 0, right: 40 }));
    expect(left.left).toBe(SAT_ANNOTATION_BUDGET_DEFAULTS.edge);
    // The caret has moved inside the rounded corner rather than staying centred.
    expect(left.arrowX).toBe(SAT_ANNOTATION_BUDGET_DEFAULTS.caretInset);

    const right = place(geometry({ top: 300, bottom: 320, left: 760, right: 800 }));
    expect(right.left + size.width).toBeLessThanOrEqual(bounds.width - SAT_ANNOTATION_BUDGET_DEFAULTS.edge);
    expect(right.arrowX).toBe(size.width - SAT_ANNOTATION_BUDGET_DEFAULTS.caretInset);
    // Still pointing at the source: the caret moved inside the surface instead of
    // the surface centring itself and hanging off the edge.
    expect(right.left).not.toBe(780 - size.width / 2);
    expect(right.left + right.arrowX).toBeGreaterThan(right.left + size.width / 2);
  });

  it('points at the first selected line above and the last line below', () => {
    // The union box is centred at 640, the first line at 760. Centring on the
    // union would park the caret 116px away from the words it belongs to.
    const above = place(
      geometry({
        top: 300,
        bottom: 420,
        left: 500,
        right: 780,
        firstLine: { top: 300, bottom: 320, left: 740, right: 780 },
        lastLine: { top: 400, bottom: 420, left: 500, right: 780 },
      }),
    );
    expect(above.side).toBe('above');
    expect(above.arrowX).toBe(260);
    expect(above.top).toBe(300 - size.height - SAT_ANNOTATION_BUDGET_DEFAULTS.gap);

    const below = place(
      geometry({
        top: 10,
        bottom: 120,
        left: 500,
        right: 780,
        firstLine: { top: 10, bottom: 30, left: 500, right: 780 },
        lastLine: { top: 100, bottom: 120, left: 740, right: 780 },
      }),
    );
    expect(below.side).toBe('below');
    expect(below.arrowX).toBe(260);
    expect(below.top).toBe(120 + SAT_ANNOTATION_BUDGET_DEFAULTS.gap);
  });

  it('settles a substantial move and applies a nudge directly', () => {
    const previous: AnnotationPlacement = {
      mode: 'floating', left: 256, top: 180, side: 'above', arrowX: 144, flipped: false, animated: false,
    };
    // Same side, 44px to the right: big enough to settle.
    const moved = place(geometry({ top: 300, bottom: 320 }), {
      previous: { ...previous, left: previous.left - 44 },
    });
    expect(moved.left).toBe(256);
    expect(moved.animated).toBe(true);

    const nudged = place(geometry({ top: 300, bottom: 320 }), {
      previous: { ...previous, left: previous.left - 2 },
    });
    expect(nudged.animated).toBe(false);
    // Nothing to settle from: a surface coming back from hidden is placed, never
    // animated from coordinates that no longer describe anything.
    const fromHidden = place(geometry({ top: 300, bottom: 320 }), {
      previous: { mode: 'hidden', left: 0, top: 0, side: null, arrowX: 0, flipped: false, animated: false },
    });
    expect(fromHidden.mode).toBe('floating');
    expect(fromHidden.animated).toBe(false);
  });

  it('stops settling once the surface is already in motion', () => {
    // The previous placement was itself a settle, so the surface is being dragged
    // or auto-scrolled right now: reapplying the transition every frame would
    // make it trail the student's finger for the whole gesture.
    const moving: AnnotationPlacement = {
      mode: 'floating', left: 212, top: 180, side: 'above', arrowX: 144, flipped: false, animated: true,
    };
    const next = place(geometry({ top: 300, bottom: 320 }), { previous: moving });
    expect(next.left).toBe(256);
    expect(next.animated).toBe(false);
  });

  it('docks the touch sheet to the bottom of the exam body', () => {
    const placement = placeSatAnnotationDock(bounds, { width: 784, height: 168 });
    expect(placement.mode).toBe('docked');
    expect(placement.left).toBe(SAT_ANNOTATION_BUDGET_DEFAULTS.edge);
    expect(placement.top).toBe(bounds.height - 168 - SAT_ANNOTATION_BUDGET_DEFAULTS.edge);
    expect(placement.flipped).toBe(false);
    expect(placement.side).toBeNull();
  });
});
