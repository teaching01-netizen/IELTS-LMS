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
 * ONE DERIVATION, TWO VIEWS, AND ONE GRANULARITY PER FINGER.
 *
 * A body-touch drag is spelled in WORDS and a handle drag in GRAPHEMES — the
 * machine's own `granularity` (see `SelectionGranularity`), stated once and read
 * here rather than tracked as a flag beside the phase. The claimed word is owned
 * here, for the whole gesture — `anchor` below — and every body move is measured
 * against it, so the word the student can see is the word the engine moves. A
 * grabbed handle drops that anchor and places only the endpoint under the finger,
 * on a cluster boundary, so a handle can end inside a word but never inside a
 * character.
 *
 * What that replaces: the machine's `fixed`/`moving` used to say both where the
 * finger was AND what was selected, so a hold that had visibly claimed a word
 * still anchored on the raw press character — and the first move dragged a run
 * from that character, moving the other edge of the visible word and turning
 * `alpha beta gamma` into `pha b` or `eta g`. They now say only where the finger
 * is; what is selected comes from the anchor.
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
 *
 * That includes the press itself: "which endpoint does this press grab" is
 * answered here, once, and by the geometry of the paint this module measures
 * (`grab`). The overlay reports a press and consumes what the answer implies; it
 * never names an endpoint, because a layer that names one can name the wrong one.
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
  clampPointToRange,
  createSelectionRange,
  createSelectionRangeWithin,
  createWordRangeAt,
  resolveWordRunAcrossNodes,
} from './selectionRange';
import {
  resolveHandleAcquisition,
  selectionAnchorRect,
  selectionDirection,
  selectionHandleGeometry,
  selectionRectsFrom,
} from './selectionGeometry';
import {
  createWordSegmentCache,
  expandToWordAt,
  resolveWordDragSpan,
  snapToGraphemeBoundary,
  type NodeWordSegment,
  type WordSegmentCache,
  type WordSegmenter,
} from '../domain/selectionSegmenter';
import type {
  SelectionDirection,
  SelectionEdge,
  SelectionGranularity,
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
  x: number;
  y: number;
  /**
   * The endpoint to move, for a caller that already knows it — a test, or a
   * surface that names one outright.
   *
   * Omitted by every press a student makes: the endpoint a press grabs is this
   * session's decision (`resolveHandleAcquisition`, over the paint it measures),
   * and a caller that could name the edge as well could name a DIFFERENT one
   * than the geometry does. See `grab`.
   */
  edge?: SelectionEdge | undefined;
  /**
   * The element the paint's direction falls back to, for a press whose endpoint
   * the session resolves itself. Same role as `paint(root)`.
   */
  root?: Element | null | undefined;
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
   * What this selection's endpoints are spelled in — words for a body gesture,
   * characters for a handle — including while it rests (docs/selectionui.md).
   *
   * The distinction is deliberately readable rather than inferred from behaviour:
   * it is what decides whether a move is walked out in whole words or snapped to a
   * character boundary, and it survives the finger lifting, so a resting selection
   * still knows which of the two it is.
   */
  granularity(): SelectionGranularity;
  /**
   * The endpoint the finger owns — the ONE position a caller may magnify.
   *
   * Never outside the range the student can see: while a body gesture is running
   * it is the caret the finger resolved to, clamped into the word run it
   * describes, and everywhere else it is the owned endpoint itself — a boundary
   * clamp confines the span, a handle crossover swaps which edge is moving, and a
   * claim owns the WORD's boundary rather than the coordinate the press happened
   * on. Null when nothing is owned.
   */
  movingEndpoint(): TextPoint | null;
  press(input: SelectionPressInput): SelectionEffect[];
  hold(): SelectionEffect[];
  move(input: SelectionMoveInput): SelectionEffect[];
  release(pointerId: number): SelectionEffect[];
  cancel(pointerId: number): SelectionEffect[];
  /**
   * Start a handle drag from a press.
   *
   * THE one place a press is turned into an endpoint (docs/selectionui.md #8):
   * an explicit `edge` is taken as given, and otherwise the endpoint is resolved
   * from the coordinates over BOTH acquisition zones of this session's own paint
   * — the paint the handles were drawn from. Returns null when the press
   * acquires no endpoint, and when the machine refuses: the machine may move only
   * a resting selection.
   */
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
  /**
   * Grapheme boundaries, for a HANDLE's endpoint. Null degrades to offsets, which
   * is what the platform without ICU leaves us.
   */
  graphemes: WordSegmenter | null;
}): SelectionSession {
  let state = idleSelectionState(options.activation ?? 'long-press', options.moveTolerancePx ?? 8);
  let boundary: Element | null = null;
  let sessionId: string | null = null;
  let span: OwnedSpan = EMPTY_SPAN;
  /**
   * The word a body gesture CLAIMED, and the only anchor its moves are measured
   * against — with the node it was claimed in, because a later move may be in
   * another node and the boundary pair alone cannot say which one it came from.
   */
  let anchor: NodeWordSegment | null = null;
  /**
   * The grapheme memo, kept apart from the word one on purpose: the cache is keyed
   * by text node and its current `data`, so one instance serving two granularities
   * would hand word segments to a grapheme lookup for the very same node.
   */
  const graphemeSegments = createWordSegmentCache();

  /** The word under a position, as the anchor a body gesture will own. */
  const anchorAt = (point: TextPoint): NodeWordSegment | null => {
    const word = expandToWordAt(point, options.segmenter, options.words);
    return word ? { node: point.node, start: word.start, end: word.end } : null;
  };

  /**
   * The whole-word run this body position means, or null when words cannot
   * describe it at all — a node with no word in it to claim.
   *
   * The anchor is adopted here rather than in a transition because this is the
   * one place that already resolves the word under the finger, and the claim is
   * exactly "a body phase exists and no word has been claimed yet". A resting
   * selection may USE the anchor but never adopts a new one: its endpoints are
   * whatever the student last adjusted to.
   *
   * The finger leaving the claimed node does NOT drop the run: an inline element
   * splitting a word and the next paragraph are the same gesture to a student, so
   * the run spans the story's text to the word the finger reached. Falling back
   * to raw offsets there is what produced `eta ga` for a drag across a paragraph
   * boundary, which is the one partial range a body gesture must never make.
   */
  const wordRunOf = (current: SelectionMachineState): OwnedSpan | null => {
    const claiming = current.phase === 'selecting' || current.phase === 'extending';
    if (!anchor && claiming && current.fixed) anchor = anchorAt(current.fixed);
    if (!anchor) return null;
    const finger = current.moving;
    if (!finger) return null;
    if (finger.node !== anchor.node) {
      // The claim is one node's boundaries; the run has to be expressed in two.
      const across = resolveWordRunAcrossNodes(anchor, anchorAt(finger));
      const acrossRange = createSelectionRange(across.fixed, across.moving);
      if (!acrossRange) return null;
      return { range: acrossRange, fixed: across.fixed, moving: across.moving };
    }
    const origin = { start: anchor.start, end: anchor.end };
    const { span: run, side } = resolveWordDragSpan(origin, expandToWordAt(finger, options.segmenter, options.words));
    const range = createSelectionRange(
      { node: anchor.node, offset: run.start },
      { node: anchor.node, offset: run.end },
    );
    if (!range) return null;
    // The finger keeps the side it is on; the far side of the run is the fixed
    // endpoint, which is why the opposite edge of the claimed word cannot move.
    return side === 'before'
      ? { range, fixed: { node: anchor.node, offset: run.end }, moving: { node: anchor.node, offset: run.start } }
      : { range, fixed: { node: anchor.node, offset: run.start }, moving: { node: anchor.node, offset: run.end } };
  };

  /**
   * The one derivation: what the two endpoints describe, as a range and as the
   * endpoints that own it.
   *
   * A claimed word outranks everything below, and only while the finger is on the
   * text: a body gesture describes a WORD RUN, not the pixels the finger passed
   * over. Everything under it is the GRAPHEME path — a handle's endpoints, a
   * boundary clamp, a selection that has no word to anchor on.
   *
   * A drag between two different positions wins. A drag that returned to where
   * it started — and a hold that never travelled — leaves the machine owning one
   * character, and the honest answer is then the WORD under the finger: that is
   * what a long press means, it is what the overlay paints, and its boundaries
   * are therefore the endpoints the student is holding. Returning those two
   * together is what keeps the paint and the ownership from drifting apart.
   *
   * GRANULARITY IS THE MACHINE'S OWN STATE, and it is what picks the branch: a
   * body gesture is `word`, a grabbed handle is `grapheme`, and because only those
   * two transitions set it, the resting span a release re-derives is measured the
   * same way the span the student saw was. It replaces a phase list plus a boolean
   * kept beside it here — the phase and the granularity are decided together, so
   * they cannot disagree, and "which granularity is this selection" is a state a
   * caller can ask for instead of an internal flag.
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
    // A body gesture is spelled in words — the claim, its extension, and the
    // resting selection it leaves behind, which is why the granularity outlives
    // the finger: the release re-derives from the same anchor, and that is what
    // stops the whole word the student was shown from shrinking to the last raw
    // caret as they lift.
    if (current.granularity === 'word') {
      const run = wordRunOf(current);
      if (run) return run;
    }
    const { fixed } = current;
    // A GRABBED HANDLE places its endpoint on a grapheme boundary: an emoji, a
    // flag, a combining accent and a Thai cluster are each several code units and
    // one character on screen, and a selection that stopped between them would cut
    // a character in half. Only the finger's own endpoint is snapped — the other
    // one belongs to the claim (or to this handle a moment ago), and moving it
    // would move an edge the student never touched.
    const moving = current.moving && current.granularity === 'grapheme'
      ? snapToGraphemeBoundary(current.moving, options.graphemes, graphemeSegments)
      : current.moving;
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
      anchor = null;
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
    granularity: () => state.granularity,
    presentationId: () => sessionId,
    needsPoint: (x, y) => moveNeedsPoint(state, x, y),
    adoptOptions: (activation, moveTolerancePx) => {
      state = { ...state, activation, moveTolerancePx };
    },
    paint,
    range: () => span.range,
    /**
     * While a body gesture is running the caret is the position the finger
     * RESOLVED to, kept inside the run the session owns: the highlight is whole
     * words, and a caret pointing at a character outside them would describe a
     * range the student cannot see. It is the finger's own caret rather than the
     * run's edge on purpose — the loupe magnifies the character being aimed at,
     * and the snap tick is what says a new one was reached. Everywhere else the
     * owned endpoint is the honest answer: a grabbed handle IS its endpoint, and a
     * resting selection has no finger to point from.
     */
    movingEndpoint: () => {
      const finger = state.moving;
      const body = state.phase === 'selecting' || state.phase === 'extending';
      if (body && anchor && finger && span.range) return clampPointToRange(finger, span.range);
      return span.moving ?? finger;
    },

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
      // WHICH endpoint this press grabs is decided HERE, and every press that
      // arrives without an `edge` is decided here and nowhere else. The rule is
      // pure and lives in the engine (`resolveHandleAcquisition`); what used to
      // be missing is an OWNER of the question: the overlay answered it to decide
      // what to consume and the entry gate answered it again to decide what to
      // move — two arbitrations of one press, against two snapshots of a paint,
      // with their agreement assumed. The paint a press is judged against is the
      // one this session measures (`paint`), from the very span it owns, so the
      // handles the student can see are the handles that decide.
      const edge = input.edge
        ?? resolveHandleAcquisition(paint(input.root ?? null), input.x, input.y);
      if (!edge) return null;
      // The handles were drawn around the span the last frame published, so that
      // is the span the grab has to mean — its endpoints, not the machine's
      // coincident pair. A grab on an already-owned pair adopts it unchanged.
      const from = span.fixed && span.moving
        ? { ...state, fixed: span.fixed, moving: span.moving, movingEdge: movingEdgeOf(span.fixed, span.moving) }
        : state;
      const transition = reduceSelection(from, {
        type: 'grab',
        pointerId: input.pointerId,
        edge,
        x: input.x,
        y: input.y,
      });
      // The machine refuses a grab on anything but a resting selection, and says
      // so by handing back the state it was given.
      if (transition.state === from) return null;
      state = transition.state;
      // A grabbed handle ends the word's ownership: from here the student's own
      // endpoints are the selection, and re-anchoring on the next release would
      // undo the precision they just asked for. The machine has already made the
      // span grapheme-granular as part of the same transition, which is what the
      // release then keeps honouring.
      anchor = null;
      span = spanOf(state);
      return transition.effects;
    },

    dismiss: () => apply({ type: 'dismiss' }),

    reset: () => {
      boundary = null;
      sessionId = null;
      span = EMPTY_SPAN;
      anchor = null;
      state = idleSelectionState(state.activation, state.moveTolerancePx);
    },
  };
}
