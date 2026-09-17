import { describe, expect, it } from 'vitest';
import { SAT_ANNOTATION_BUDGET_DEFAULTS } from './satAnnotationBudgets';
import {
  placeSatAnnotationDock,
  placeSatAnnotationSurface,
  type AnnotationPlacement,
} from './satSelectionGeometry';
import type { SatAnchorGeometry } from './satSelectionAnchor';

const bounds = { left: 0, top: 0, width: 800, height: 600 };
const viewport = { left: 0, top: 0, width: 800, height: 600 };
/** A measured floating surface: the size the engine has to place. */
const size = { width: 288, height: 108 };
const EDGE = SAT_ANNOTATION_BUDGET_DEFAULTS.edge;

/**
 * An anchor box with its per-line rects. Only the engine's inputs matter here —
 * no DOM, because placement is a pure decision. The measurement that produces
 * these numbers is covered in satSelectionAnchor.test.ts.
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
    budgets?: Partial<typeof SAT_ANNOTATION_BUDGET_DEFAULTS>;
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

/** A placement of the given shape, as the engine would have returned it. */
function placement(input: Partial<AnnotationPlacement> & Pick<AnnotationPlacement, 'mode'>): AnnotationPlacement {
  return {
    left: 256, top: 180, width: size.width, maxHeight: 400, side: null, arrowX: 144, animated: false,
    ...input,
  };
}

describe('satSelectionGeometry: where the surface goes', () => {
  it('prefers the space above the selection and flips below when there is none', () => {
    const above = place(geometry({ top: 300, bottom: 320 }));
    expect(above.mode).toBe('floating');
    expect(above.side).toBe('above');
    expect(above.top).toBe(300 - size.height - SAT_ANNOTATION_BUDGET_DEFAULTS.gap);

    const below = place(geometry({ top: 10, bottom: 30 }));
    expect(below.side).toBe('below');
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

  it('takes the lane the native selection menu leaves free, never the one it covers', () => {
    // iOS paints its menu above the selection and only flips it below when it
    // does not fit there — and it is drawn OVER our surface, so on touch that
    // lane is not ours even when it is the roomier one.
    const roomyAbove = geometry({ top: 300, bottom: 320 });
    const withFinger = place(roomyAbove, { touch: true });
    expect(withFinger.mode).toBe('floating');
    expect(withFinger.side).toBe('below');

    // The same selection with a mouse reserves nothing, so the width above still
    // wins exactly as it always has.
    expect(place(roomyAbove).side).toBe('above');
  });

  it('docks on touch when the menu has taken the only lane with room', () => {
    // A selection near the top of the visible region: iOS cannot fit its menu
    // above and flips it below, which is the lane we would have used. Above has
    // 48px and a comfortable toolbar needs 144, so the sheet is the honest
    // answer rather than a toolbar under the menu.
    const short = { left: 0, top: 0, width: 800, height: 400 };
    const high = geometry({ top: 60, bottom: 80 });
    expect(place(high, { touch: true, viewport: short, bounds: short }).mode).toBe('docked');

    // A mouse on the same geometry still floats — below, when above has no room,
    // which is the flip it has always done.
    const withMouse = place(high, { viewport: short, bounds: short });
    expect(withMouse.mode).toBe('floating');
    expect(withMouse.side).toBe('below');
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
    // Below the selection there is now more room, and above is still fine: the
    // side stays put instead of flipping on every measurement.
    const kept = place(geometry({ top: 212, bottom: 240 }), {
      previous: placement({ mode: 'floating', side: 'above' }),
    });
    expect(kept.side).toBe('above');
  });

  it('switches sides only for a side that offers real room, and docks otherwise', () => {
    const previous = placement({ mode: 'floating', side: 'above' });
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

  it('leaves the dock only for room that is worth the move', () => {
    const docked = placement({ mode: 'docked', side: null, arrowX: 0, top: 420 });
    // The menu owns the lane above, so the lane below is ours — and it holds
    // 157px against the 144 a toolbar needs. Enough to place, not enough to
    // justify leaving the sheet (that costs the switch margin too), so the sheet
    // stays rather than looking like it could not make up its mind.
    const band = { left: 0, top: 0, width: 800, height: 430 };
    const inBand = place(geometry({ top: 237, bottom: 261 }), { previous: docked, touch: true, bounds: band, viewport: band });
    expect(inBand.mode).toBe('docked');

    // Real room in the free lane and the move is worth making: the sheet becomes
    // a toolbar again rather than staying one for the selection's whole life.
    const roomy = { left: 0, top: 0, width: 800, height: 560 };
    const withRoom = place(geometry({ top: 300, bottom: 320 }), { previous: docked, touch: true, bounds: roomy, viewport: roomy });
    expect(withRoom.mode).toBe('floating');
    expect(withRoom.side).toBe('below');
    expect(withRoom.animated).toBe(false);
  });

  it('hides while its source is off screen', () => {
    expect(place(geometry({ top: -40, bottom: -20 })).mode).toBe('hidden');
    expect(place(geometry({ top: 700, bottom: 720 })).mode).toBe('hidden');
  });

  it('clamps the surface inside the body and turns the caret toward its source', () => {
    const left = place(geometry({ top: 300, bottom: 320, left: 0, right: 40 }));
    expect(left.left).toBe(EDGE);
    expect(left.width).toBe(size.width);
    // The caret has moved inside the rounded corner rather than staying centred.
    expect(left.arrowX).toBe(SAT_ANNOTATION_BUDGET_DEFAULTS.caretInset);

    const right = place(geometry({ top: 300, bottom: 320, left: 760, right: 800 }));
    expect(right.left + right.width).toBeLessThanOrEqual(bounds.width - EDGE);
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
    const previous = placement({ mode: 'floating', side: 'above' });
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
      previous: placement({ mode: 'hidden', side: null, arrowX: 0 }),
    });
    expect(fromHidden.mode).toBe('floating');
    expect(fromHidden.animated).toBe(false);
  });

  it('stops settling once the surface is already in motion', () => {
    // The previous placement was itself a settle, so the surface is being dragged
    // or auto-scrolled right now: reapplying the transition every frame would
    // make it trail the student's finger for the whole gesture.
    const moving = placement({ mode: 'floating', side: 'above', left: 212, animated: true });
    const next = place(geometry({ top: 300, bottom: 320 }), { previous: moving });
    expect(next.left).toBe(256);
    expect(next.animated).toBe(false);
  });
});

describe('satSelectionGeometry: the dock', () => {
  it('docks to the bottom of the exam body', () => {
    const placementResult = placeSatAnnotationDock(bounds, viewport, { width: 784, height: 168 }, EDGE);
    expect(placementResult.mode).toBe('docked');
    expect(placementResult.left).toBe(EDGE);
    expect(placementResult.top).toBe(bounds.height - 168 - EDGE);
    expect(placementResult.width).toBe(bounds.width - EDGE * 2);
    expect(placementResult.side).toBeNull();
  });

  it('docks to what the student can SEE, not to the container', () => {
    // A software keyboard shrinks the visible region while the exam shell keeps
    // its own height (the shell freezes it on purpose). Docking against the
    // container would pin the sheet under the keyboard — present, unreachable.
    const tallContainer = { left: 0, top: 0, width: 800, height: 700 };
    const keyboardShrunk = { left: 0, top: 0, width: 800, height: 400 };
    const docked = placeSatAnnotationDock(tallContainer, keyboardShrunk, { width: 320, height: 168 }, EDGE);
    expect(docked.top + 168).toBeLessThanOrEqual(keyboardShrunk.height - EDGE);

    // Sheet taller than the visible slice: the bound is the room beneath its own
    // top edge, so its contents scroll instead of spilling off the screen.
    const cramped = placeSatAnnotationDock(tallContainer, { left: 0, top: 0, width: 800, height: 120 }, { width: 320, height: 168 }, EDGE);
    expect(cramped.top).toBe(EDGE);
    expect(cramped.maxHeight).toBe(120 - EDGE * 2);

    // The same reasoning horizontally: a zoomed-in visible region is the sheet's
    // extent, so its controls can never sit off the visible slice.
    const zoomedIn = { left: 200, top: 0, width: 300, height: 400 };
    const zoomed = placeSatAnnotationDock(bounds, zoomedIn, { width: 320, height: 168 }, EDGE);
    expect(zoomed.left).toBe(200 + EDGE);
    expect(zoomed.left + zoomed.width).toBeLessThanOrEqual(zoomedIn.left + zoomedIn.width - EDGE);
  });
});
