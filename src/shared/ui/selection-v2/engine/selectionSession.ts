/**
 * The session: what is selected, and who may change it.
 *
 * This is the module the engine was missing. The gesture's machine state, the
 * element the selection may not leave, and the span the two endpoints currently
 * describe were three separate facts living in the hook — one of them in a ref,
 * one in the reducer's state, and the span nowhere in particular — with their
 * agreement assumed. It was not: a hold that claimed a word left the machine
 * owning ONE character while the overlay painted the whole word, so the handle
 * drawn at the word's start could not be moved and the edge the student touched
 * stayed exactly where it was. Two facts, two answers, one student-visible
 * defect. This module holds them together.
 *
 * ONE DERIVATION, TWO VIEWS.
 *
 * `spanOf` is the only place that decides what the two endpoints describe. From
 * its result come both views the rest of the system asks for:
 *
 *   the `Range`  — what the overlay paints, and what `onSelect` is handed
 *   the endpoints — what the handles move, and what a grab anchors
 *
 * They cannot disagree, because a grab adopts the endpoints of the span the last
 * FRAME published rather than re-deriving them: the range the student can see is
 * the range the grab means. (The deeper shape — endpoints read out of the range
 * on every access, with the range the only state — is not what this module does:
 * ownership still lives in `fixed`/`moving`, because "which end is the finger
 * holding" is not expressible as a `Range`. What is gone is the second, silent
 * copy of the answer.)
 *
 * NO REACT, NO RAF, NO LISTENERS.
 *
 * The session is given pointers and coordinates and returns the effects the
 * adapter must perform. It never schedules, never subscribes and never renders,
 * so the whole grammar — claim, extend, rest, adjust, dismiss — is walkable in a
 * test without a browser or a component, and the hook left around it owns only
 * "how": which element is captured, which timer is armed, which frame is drawn.
 */

import {
  idleSelectionState,
  moveNeedsPoint,
  movingEdgeOf,
  reduceSelection,
  type SelectionActivation,
  type SelectionEffect,
  type SelectionMachineState,
} from '../domain/selectionMachine';
import {
  createSelectionRange,
  createSelectionRangeWithin,
  createWordRangeAt,
} from './selectionRange';
import {
  selectionAnchorRect,
  selectionDirection,
  selectionHandleGeometry,
  selectionRectsFrom,
} from './selectionGeometry';
import { expandToWordAt, type WordSegmentCache, type WordSegmenter } from '../domain/selectionSegmenter';
import type {
  SelectionDirection,
  SelectionEdge,
  SelectionHandleGeometry,
  SelectionPhase,
  SelectionRect,
  TextPoint,
} from '../domain/selectionTypes';

/** The lines, handles and box an overlay paints. Plain numbers, no DOM. */
export interface SelectionPaint {
  rects: SelectionRect[];
  anchorRect: SelectionRect | null;
  startHandle: SelectionHandleGeometry | null;
  endHandle: SelectionHandleGeometry | null;
  direction: SelectionDirection;
  text: string;
}

export const EMPTY_PAINT: SelectionPaint = {
  rects: [],
  anchorRect: null,
  startHandle: null,
  endHandle: null,
  direction: 'ltr',
  text: '',
};

export interface SelectionPressInput {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  /** Where the finger landed, already resolved against the surface's text. */
  point: TextPoint;
  /** The text the selection may not leave, given the position it started at. */
  boundaryFor?: ((start: TextPoint) => Element | null) | undefined;
}

export interface SelectionMoveInput {
  pointerId: number;
  x: number;
  y: number;
  /** Resolved by the frame, and omitted by the raw event that only moved. */
  point?: TextPoint | null | undefined;
}

export interface SelectionGrabInput {
  pointerId: number;
  edge: SelectionEdge;
  x: number;
  y: number;
}

/** The span the two endpoints describe, in both of the forms the system asks for. */
interface OwnedSpan {
  range: Range | null;
  fixed: TextPoint | null;
  moving: TextPoint | null;
}

const EMPTY_SPAN: OwnedSpan = { range: null, fixed: null, moving: null };

export interface SelectionSession {
  phase(): SelectionPhase;
  /** The pointer that owns the gesture, or null when nobody does. */
  pointerId(): number | null;
  /** Stable for the life of one selection, so an overlay animates, not remounts. */
  presentationId(): string | null;
  /** Whether a move at this coordinate is worth resolving against the text. */
  needsPoint(x: number, y: number): boolean;
  /** The current options apply to the NEXT gesture; a live one keeps its own. */
  adoptOptions(activation: SelectionActivation, moveTolerancePx: number): void;
  /** Measure and hand back what to paint; `root` is the RTL fallback. */
  paint(root?: Element | null): SelectionPaint;
  /** The range the paint was measured from, for committing and diagnostics. */
  range(): Range | null;
  /**
   * The endpoint the finger owns — the ONE position a caller may magnify.
   *
   * Read out of the owned span rather than out of the machine's candidate, so
   * the visual caret can never disagree with the range the student can see:
   * a boundary clamp confines the span, a handle crossover swaps which edge is
   * moving, and a hold that claimed a word owns the WORD's far edge rather than
   * the coordinate the press happened on. Null when nothing is owned.
   */
  movingEndpoint(): TextPoint | null;
  press(input: SelectionPressInput): SelectionEffect[];
  hold(): SelectionEffect[];
  move(input: SelectionMoveInput): SelectionEffect[];
  release(pointerId: number): SelectionEffect[];
  cancel(pointerId: number): SelectionEffect[];
  /** Null when the grab was refused — the machine may move only a resting selection. */
  grab(input: SelectionGrabInput): SelectionEffect[] | null;
  dismiss(): SelectionEffect[];
  /** Idle, and every owned fact with it. */
  reset(): void;
}

let sessionCounter = 0;

export function createSelectionSession(options: {
  activation?: SelectionActivation | undefined;
  moveTolerancePx?: number | undefined;
  /** Null where the platform has no segmenter: the word path degrades, as before. */
  segmenter: WordSegmenter | null;
  words: WordSegmentCache;
}): SelectionSession {
  let state = idleSelectionState(options.activation ?? 'long-press', options.moveTolerancePx ?? 8);
  let boundary: Element | null = null;
  let sessionId: string | null = null;
  let span: OwnedSpan = EMPTY_SPAN;

  /**
   * The one derivation: what the two endpoints describe, as a range and as the
   * endpoints that own it.
   *
   * A drag between two different positions wins. A drag that returned to where
   * it started — and a hold that never travelled — leaves the machine owning one
   * character, and the honest answer is then the WORD under the finger: that is
   * what a long press means, it is what the overlay paints, and its boundaries
   * are therefore the endpoints the student is holding. Returning those two
   * together is what keeps the paint and the ownership from drifting apart.
   *
   * BUT ONLY ON THE INITIAL CLAIM, where no span exists yet to contradict.
   * Coincident endpoints also arise when a handle being ADJUSTED reaches the
   * fixed one, and expanding there snaps a selection the student can see back
   * to a whole word they did not ask for — visibly unstable on a short
   * selection. So a coincident pair keeps the last non-collapsed span until the
   * finger crosses it; the word path runs only when there is no such span (the
   * claim), and a crossover returns to the dragged branch above — no word, no
   * jump.
   */
  const spanOf = (current: SelectionMachineState): OwnedSpan => {
    const { fixed, moving } = current;
    if (fixed && moving && (fixed.node !== moving.node || fixed.offset !== moving.offset)) {
      const dragged = boundary
        ? createSelectionRangeWithin(boundary, fixed, moving)
        : createSelectionRange(fixed, moving);
      if (dragged) return { range: dragged, fixed, moving };
    }
    if (!fixed) return EMPTY_SPAN;
    if (span.range && !span.range.collapsed) return span;
    const range = createWordRangeAt(fixed, expandToWordAt(fixed, options.segmenter, options.words));
    if (!range || range.collapsed) return { range, fixed, moving };
    if (range.startContainer.nodeType !== Node.TEXT_NODE || range.endContainer.nodeType !== Node.TEXT_NODE) {
      return { range, fixed, moving };
    }
    return {
      range,
      fixed: { node: range.startContainer as Text, offset: range.startOffset },
      moving: { node: range.endContainer as Text, offset: range.endOffset },
    };
  };

  /**
   * Apply a transition and re-derive the span, so the two views stay one fact.
   *
   * Deriving here rather than per frame is deliberate: the span is a TEXT fact,
   * and text does not move when a passage scrolls — only the boxes measured from
   * it do, and those are re-read by every `paint()`.
   */
  const apply = (event: Parameters<typeof reduceSelection>[1]): SelectionEffect[] => {
    const transition = reduceSelection(state, event);
    state = transition.state;
    if (state.phase === 'idle') {
      span = EMPTY_SPAN;
      sessionId = null;
      return transition.effects;
    }
    span = spanOf(state);
    sessionId = sessionId ?? `selection:${(sessionCounter += 1)}`;
    return transition.effects;
  };

  const paint = (root?: Element | null): SelectionPaint => {
    if (state.phase === 'idle') return EMPTY_PAINT;
    const range = span.range;
    const rects = selectionRectsFrom(range);
    const container = range?.startContainer ?? null;
    const element =
      container && container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element | null);
    const direction = selectionDirection(element ?? root ?? null);
    const handles = selectionHandleGeometry(rects, direction);
    return {
      rects,
      anchorRect: selectionAnchorRect(rects),
      startHandle: handles.start,
      endHandle: handles.end,
      direction,
      text: range?.toString() ?? '',
    };
  };

  return {
    phase: () => state.phase,
    pointerId: () => state.pointerId,
    presentationId: () => sessionId,
    needsPoint: (x, y) => moveNeedsPoint(state, x, y),
    adoptOptions: (activation, moveTolerancePx) => {
      state = { ...state, activation, moveTolerancePx };
    },
    paint,
    range: () => span.range,
    movingEndpoint: () => span.moving ?? state.moving,

    press: (input) => {
      // The claim is bounded by the paragraph the finger started in, and the
      // boundary is remembered rather than re-asked: a drag that leaves it must
      // still select up to the edge it crossed.
      const claimed = input.boundaryFor?.(input.point) ?? null;
      const effects = apply({
        type: 'press',
        pointerId: input.pointerId,
        pointerType: input.pointerType,
        x: input.x,
        y: input.y,
        point: input.point,
      });
      boundary = state.phase === 'idle' ? null : claimed;
      return effects;
    },

    hold: () => apply({ type: 'hold' }),

    // `point` is omitted rather than set to undefined: a raw pointermove carries
    // no resolved position, and the event type distinguishes the two.
    move: (input) =>
      input.point === undefined
        ? apply({ type: 'move', pointerId: input.pointerId, x: input.x, y: input.y })
        : apply({ type: 'move', pointerId: input.pointerId, x: input.x, y: input.y, point: input.point }),

    release: (pointerId) => apply({ type: 'release', pointerId }),

    cancel: (pointerId) => apply({ type: 'cancel', pointerId }),

    grab: (input) => {
      // The handles were drawn around the span the last frame published, so that
      // is the span the grab has to mean — its endpoints, not the machine's
      // coincident pair. A grab on an already-owned pair adopts it unchanged.
      const from = span.fixed && span.moving
        ? { ...state, fixed: span.fixed, moving: span.moving, movingEdge: movingEdgeOf(span.fixed, span.moving) }
        : state;
      const transition = reduceSelection(from, {
        type: 'grab',
        pointerId: input.pointerId,
        edge: input.edge,
        x: input.x,
        y: input.y,
      });
      // The machine refuses a grab on anything but a resting selection, and says
      // so by handing back the state it was given.
      if (transition.state === from) return null;
      state = transition.state;
      span = spanOf(state);
      return transition.effects;
    },

    dismiss: () => apply({ type: 'dismiss' }),

    reset: () => {
      boundary = null;
      sessionId = null;
      span = EMPTY_SPAN;
      state = idleSelectionState(state.activation, state.moveTolerancePx);
    },
  };
}
