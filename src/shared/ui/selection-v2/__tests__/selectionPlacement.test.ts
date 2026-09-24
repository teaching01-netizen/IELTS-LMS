import { describe, expect, it } from 'vitest';
import {
  placeSelectionMenu,
  SELECTION_MENU_BUDGET_DEFAULTS,
  type SelectionMenuAnchor,
  type SelectionMenuBox,
  type SelectionMenuEnvironment,
  type SelectionMenuPlacement,
} from '../engine/selectionPlacement';

/**
 * The one placement rule, exercised from both ends it is used from: a product's
 * measured selection (SAT's per-line geometry) and a selection the exam owns
 * (one box, no lane reserved). Ergonomics and native UI are independent inputs.
 */

/**
 * An anchor whose box is also its only line, which is how a selection the exam
 * owns is measured: one union box, no per-line rects.
 */
function ownAnchor(rect: SelectionMenuBox): SelectionMenuAnchor {
  const line = { top: rect.top, bottom: rect.top + rect.height, left: rect.left, right: rect.left + rect.width };
  return { ...line, firstLine: line, lastLine: line };
}

const bounds = { left: 0, top: 0, width: 800, height: 600 };
const viewport = { left: 0, top: 0, width: 800, height: 600 };
/** A measured floating surface: the size the rule has to place. */
const size = { width: 288, height: 108 };
const EDGE = SELECTION_MENU_BUDGET_DEFAULTS.edge;
const GAP = SELECTION_MENU_BUDGET_DEFAULTS.gap;
const NATIVE_ZONE = SELECTION_MENU_BUDGET_DEFAULTS.nativeUiZone;

/**
 * An anchor box with its per-line rects. Only the rule's inputs matter here — no
 * DOM, because placement is a pure decision. The measurement that produces these
 * numbers is covered where it lives (`satSelectionAnchor.test.ts`).
 */
function geometry(input: {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  firstLine?: { top: number; bottom: number; left: number; right: number };
  lastLine?: { top: number; bottom: number; left: number; right: number };
}): SelectionMenuAnchor {
  const left = input.left ?? 200;
  const right = input.right ?? 600;
  const flat = { top: input.top, bottom: input.bottom, left, right };
  return {
    left,
    right,
    top: input.top,
    bottom: input.bottom,
    firstLine: input.firstLine ?? flat,
    lastLine: input.lastLine ?? flat,
  };
}

function place(
  anchor: SelectionMenuAnchor,
  options: {
    previous?: SelectionMenuPlacement | null;
    environment?: SelectionMenuEnvironment;
    bounds?: typeof bounds;
    viewport?: typeof viewport;
    size?: typeof size;
    budgets?: Partial<typeof SELECTION_MENU_BUDGET_DEFAULTS>;
  } = {},
): SelectionMenuPlacement {
  return placeSelectionMenu({
    anchor,
    bounds: options.bounds ?? bounds,
    viewport: options.viewport ?? viewport,
    size: options.size ?? size,
    previous: options.previous ?? null,
    environment: options.environment ?? { coarsePointer: false, nativeSelectionUi: false },
    ...(options.budgets ? { budgets: options.budgets } : {}),
  });
}

/** A placement of the given shape, as the rule would have returned it. */
function placement(input: Partial<SelectionMenuPlacement> & Pick<SelectionMenuPlacement, 'mode'>): SelectionMenuPlacement {
  return {
    left: 256, top: 180, width: size.width, maxHeight: 400, side: null, arrowX: 144, animated: false, clamped: false,
    ...input,
  };
}

describe('placeSelectionMenu: where the menu goes', () => {
  it('prefers the space above the selection and flips below when there is none', () => {
    const above = place(geometry({ top: 300, bottom: 320 }));
    expect(above.mode).toBe('floating');
    expect(above.side).toBe('above');
    expect(above.top).toBe(300 - size.height - GAP);
    // Sitting exactly where it belongs: nothing had to be pinned, so the caret
    // still means something.
    expect(above.clamped).toBe(false);

    const below = place(geometry({ top: 10, bottom: 30 }));
    expect(below.side).toBe('below');
    expect(below.top).toBe(30 + GAP);
    expect(below.clamped).toBe(false);
  });

  it('refuses to squeeze the menu into a gap it only technically fits', () => {
    // 130px of room above, 132 required: the comfortable answer is the other
    // side, not a cramped toolbar.
    const cramped = place(geometry({ top: 142, bottom: 162 }));
    expect(cramped.side).toBe('below');

    // The same geometry without the comfort buffer *would* have fitted.
    const bare = place(geometry({ top: 142, bottom: 162 }), {
      budgets: { ...SELECTION_MENU_BUDGET_DEFAULTS, comfort: 0, comfortFine: 0 },
    });
    expect(bare.side).toBe('above');
  });

  it('reserves a native selection lane only when native selection UI exists', () => {
    // When browser-owned selection UI exists, iOS paints its menu above the
    // selection and only flips it below when it does not fit there. It is drawn
    // OVER our surface, so the claimed lane is unavailable even when roomier.
    const roomyAbove = geometry({ top: 300, bottom: 320 });
    const withNativeUi = place(roomyAbove, {
      environment: { coarsePointer: true, nativeSelectionUi: true },
    });
    expect(withNativeUi.mode).toBe('floating');
    expect(withNativeUi.side).toBe('below');

    // A real exam owns this selection, so it keeps the touch comfort budget but
    // does not reserve a lane for UI the browser will not draw.
    const owned = place(roomyAbove, {
      environment: { coarsePointer: true, nativeSelectionUi: false },
    });
    expect(owned.side).toBe('above');

    // The same selection with a mouse reserves nothing, so the width above still
    // wins exactly as it always has.
    expect(place(roomyAbove).side).toBe('above');
  });

  it('floats past the native UI zone when native selection UI has taken the only lane with room', () => {
    // A selection near the top: iOS cannot fit its menu above and flips it
    // below, which is the lane we would have used. Above holds 48px against the
    // 144 a toolbar wants — so the toolbar goes into the menu's lane, but clear
    // of the zone the menu itself will cover. Sitting past the menu is usable;
    // sitting under it is not.
    const short = { left: 0, top: 0, width: 800, height: 400 };
    const high = geometry({ top: 60, bottom: 80 });
    const withFinger = place(high, {
      environment: { coarsePointer: true, nativeSelectionUi: true },
      viewport: short,
      bounds: short,
    });
    expect(withFinger.mode).toBe('floating');
    expect(withFinger.side).toBe('below');
    expect(withFinger.top).toBe(80 + NATIVE_ZONE + GAP);
    expect(withFinger.top).toBeGreaterThanOrEqual(80 + NATIVE_ZONE);
    // Placed deliberately, not pinned: the caret still points at the selection.
    expect(withFinger.clamped).toBe(false);

    // A mouse on the same geometry reserves no lane, so the toolbar takes the
    // ordinary distance under the words instead of the menu's.
    const withMouse = place(high, { viewport: short, bounds: short });
    expect(withMouse.mode).toBe('floating');
    expect(withMouse.side).toBe('below');
    expect(withMouse.top).toBe(80 + GAP);
  });

  it('keeps coarse-pointer comfort spacing without a native UI lane', () => {
    const short = { left: 0, top: 0, width: 800, height: 400 };
    const high = geometry({ top: 60, bottom: 80 });
    const owned = place(high, {
      environment: { coarsePointer: true, nativeSelectionUi: false },
      viewport: short,
      bounds: short,
    });

    expect(owned.side).toBe('below');
    expect(owned.top).toBe(80 + GAP);
    expect(owned.top).not.toBe(80 + NATIVE_ZONE + GAP);
  });

  it('floats a selection that covers the viewport, and pins itself only when there is nothing left', () => {
    const whatTheStudentSelected = place(geometry({ top: 100, bottom: 340 }));
    expect(whatTheStudentSelected.mode).toBe('floating');
    expect(whatTheStudentSelected.side).toBe('below');
    expect(whatTheStudentSelected.top).toBe(340 + GAP);

    // A selection filling the whole visible region leaves no gap to sit in. The
    // toolbar is pinned inside that region anyway, rather than becoming a
    // different kind of surface or disappearing.
    const wholeScreen = { left: 0, top: 0, width: 800, height: 400 };
    const pinned = place(geometry({ top: EDGE, bottom: wholeScreen.height - EDGE }), {
      viewport: wholeScreen,
      bounds: wholeScreen,
    });
    expect(pinned.mode).toBe('floating');
    expect(pinned.clamped).toBe(true);
    expect(pinned.top + size.height).toBeLessThanOrEqual(wholeScreen.height - EDGE);
  });

  it('floats into a cramped visible region instead of shrinking out of reach', () => {
    // A narrow visible slice: the surface takes the width it can get, inside it.
    const narrow = { left: 0, top: 0, width: 300, height: 600 };
    const inNarrow = place(geometry({ top: 300, bottom: 320 }), { viewport: narrow, bounds: narrow });
    expect(inNarrow.mode).toBe('floating');
    expect(inNarrow.width).toBe(narrow.width - EDGE * 2);
    expect(inNarrow.left).toBeGreaterThanOrEqual(EDGE);
    expect(inNarrow.left + inNarrow.width).toBeLessThanOrEqual(narrow.width - EDGE);

    // A visible region shorter than the surface itself — a phone with the
    // software keyboard up. The toolbar is pinned to the top of what the student
    // can see and its rows are bounded, so the actions scroll instead of hiding
    // under the keyboard.
    const squashed = { left: 0, top: 0, width: 800, height: 110 };
    const inSquashed = place(geometry({ top: 40, bottom: 60 }), { viewport: squashed, bounds: squashed });
    expect(inSquashed.mode).toBe('floating');
    expect(inSquashed.clamped).toBe(true);
    expect(inSquashed.top).toBe(EDGE);
    expect(inSquashed.maxHeight).toBeLessThan(size.height);
    expect(inSquashed.maxHeight).toBe(squashed.height - EDGE * 2);
  });

  it('keeps the side it chose while that side still fits', () => {
    // Below the selection there is now more room, and above is still fine: the
    // side stays put instead of flipping on every measurement.
    const kept = place(geometry({ top: 212, bottom: 240 }), {
      previous: placement({ mode: 'floating', side: 'above' }),
    });
    expect(kept.side).toBe('above');
  });

  it('switches sides only for a side that offers real room', () => {
    const previous = placement({ mode: 'floating', side: 'above' });
    const short = { left: 0, top: 0, width: 800, height: 400 };
    // Above has stopped fitting; below offers 200px, comfortably more than the
    // 132 required plus the switch margin — so the surface moves below.
    const switched = place(geometry({ top: 130, bottom: 188 }), { previous, viewport: short, bounds: short });
    expect(switched.side).toBe('below');
    expect(switched.top).toBe(188 + GAP);
  });

  it('holds its ground through a tight measurement instead of chasing the roomier side', () => {
    const previous = placement({ mode: 'floating', side: 'above' });
    const short = { left: 0, top: 0, width: 800, height: 400 };
    // Above holds 125px and below 140px: neither is comfortable (132 under a
    // mouse), and neither justifies the move (156). Re-deciding on every
    // measurement would rock the toolbar side to side while the student reads,
    // so the side it is on wins as long as it can hold the surface at all.
    const kept = place(geometry({ top: 137, bottom: 248 }), { previous, viewport: short, bounds: short });
    expect(kept.side).toBe('above');
    expect(kept.top).toBe(137 - size.height - GAP);
    expect(kept.clamped).toBe(false);
  });

  it('never answers with anything but the two modes it has', () => {
    // The toolbar is the only presentation. Whatever the geometry does to it —
    // a full-screen selection, no room at all, a viewport the size of a stamp —
    // the answer is a floating surface (pinned if it must be) or nothing at all
    // while the source is off screen.
    const cases: Array<[SelectionMenuAnchor, typeof bounds]> = [
      [geometry({ top: 300, bottom: 320 }), bounds],
      [geometry({ top: EDGE, bottom: viewport.height - EDGE }), viewport],
      [geometry({ top: 60, bottom: 80 }), { left: 0, top: 0, width: 300, height: 110 }],
      [geometry({ top: -60, bottom: -20 }), bounds],
      [geometry({ top: 100, bottom: 140 }), { left: 0, top: 0, width: 120, height: 120 }],
    ];
    for (const [anchor, box] of cases) {
      const result = place(anchor, { bounds: box, viewport: box });
      expect(['floating', 'hidden']).toContain(result.mode);
      if (result.mode === 'floating') {
        expect(result.left + result.width).toBeLessThanOrEqual(Math.max(box.width - EDGE, EDGE));
        expect(result.top).toBeGreaterThanOrEqual(EDGE);
        expect(result.maxHeight).toBeGreaterThan(0);
      }
    }
  });

  it('hides while its source is off screen', () => {
    expect(place(geometry({ top: -40, bottom: -20 })).mode).toBe('hidden');
    expect(place(geometry({ top: 700, bottom: 720 })).mode).toBe('hidden');
  });

  it('clamps the menu inside the body and turns the caret toward its source', () => {
    const left = place(geometry({ top: 300, bottom: 320, left: 0, right: 40 }));
    expect(left.left).toBe(EDGE);
    expect(left.width).toBe(size.width);
    // The caret has moved inside the rounded corner rather than staying centred.
    expect(left.arrowX).toBe(SELECTION_MENU_BUDGET_DEFAULTS.caretInset);
    // The edge it was clamped against is a horizontal one: the menu is still
    // against its line, so the caret is still drawn.
    expect(left.clamped).toBe(false);

    const right = place(geometry({ top: 300, bottom: 320, left: 760, right: 800 }));
    expect(right.left + right.width).toBeLessThanOrEqual(bounds.width - EDGE);
    expect(right.arrowX).toBe(size.width - SELECTION_MENU_BUDGET_DEFAULTS.caretInset);
    // Still pointing at the source: the caret moved inside the menu instead of
    // the menu centring itself and hanging off the edge.
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
    expect(above.top).toBe(300 - size.height - GAP);

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
    expect(below.top).toBe(120 + GAP);
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

    // Nothing to settle from: a menu coming back from hidden is placed, never
    // animated from coordinates that no longer describe anything.
    const fromHidden = place(geometry({ top: 300, bottom: 320 }), {
      previous: placement({ mode: 'hidden', side: null, arrowX: 0 }),
    });
    expect(fromHidden.mode).toBe('floating');
    expect(fromHidden.animated).toBe(false);
  });

  it('stops settling once the menu is already in motion', () => {
    // The previous placement was itself a settle, so the menu is being dragged
    // or auto-scrolled right now: reapplying the transition every frame would
    // make it trail the student's finger for the whole gesture.
    const moving = placement({ mode: 'floating', side: 'above', left: 212, animated: true });
    const next = place(geometry({ top: 300, bottom: 320 }), { previous: moving });
    expect(next.left).toBe(256);
    expect(next.animated).toBe(false);
  });
});

describe('placeSelectionMenu: a selection the exam owns', () => {
  const owned = { left: 100, top: 400, width: 120, height: 20 };
  const small = { width: 240, height: 48 };
  const wide = { left: 0, top: 0, width: 400, height: 800 };

  it('hangs the menu above the selection, centred on it, from one measured box', () => {
    const result = placeSelectionMenu({
      anchor: ownAnchor(owned),
      bounds: wide,
      viewport: wide,
      size: small,
      environment: { coarsePointer: true, nativeSelectionUi: false },
    });

    expect(result.side).toBe('above');
    expect(result.top).toBe(400 - GAP - small.height);
    expect(result.left).toBe(100 + 60 - small.width / 2);
    expect(result.width).toBe(small.width);
    expect(result.clamped).toBe(false);
  });

  it('never asks for more width than the visible region has', () => {
    const result = placeSelectionMenu({
      anchor: ownAnchor({ left: 10, top: 400, width: 40, height: 20 }),
      bounds: wide,
      viewport: { left: 0, top: 0, width: 200, height: 800 },
      size: small,
      environment: { coarsePointer: false, nativeSelectionUi: false },
    });

    expect(result.width).toBe(200 - EDGE * 2);
    expect(result.left).toBe(EDGE);
  });
});
