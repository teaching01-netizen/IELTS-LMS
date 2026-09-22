/**
 * The vocabulary every part of Selection Engine v2 shares.
 *
 * One rule decides what lives here: the engine's AUTHORITY is a DOM `Range`,
 * and nothing else in the exam is allowed to hold a second answer to "what is
 * selected". A `TextPoint` is how a gesture talks about one end of that range
 * (a text node and a character offset, resolved from a finger), a
 * `SelectionRect` is how the app paints a line the platform will not paint for
 * it, and a `SelectionPresentation` is the whole of what a React component is
 * told. Components never query layout or re-derive selection; the engine
 * measures once per animation frame and hands them numbers.
 */

/** An offset into one rendered text node. The only coordinate the engine trusts. */
export interface TextPoint {
  node: Text;
  offset: number;
}

/** One painted line of a selection, in viewport coordinates. */
export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which visual end of the selection something belongs to, in READING order. */
export type SelectionEdge = 'start' | 'end';

/**
 * Where a text position's caret is, measured from the rendered text.
 *
 * `x` is the CHARACTER BOUNDARY the engine resolved — discrete, snapped to ink,
 * never a coordinate the finger happened to be hovering. `y` is the vertical
 * MIDDLE of the box that boundary sits in, because that is the point a lens
 * centres on; `top` and `bottom` bracket the same box for a caller that has to
 * draw it, which is why `y` is not simply `top`.
 *
 * Viewport coordinates, like every other geometry in this module.
 */
export interface CaretGeometry {
  x: number;
  y: number;
  height: number;
  top: number;
  bottom: number;
}

/**
 * The two positions a moving pointer has, and why they cannot be one.
 *
 * The FINGER is analog: it travels every pixel, wherever it physically lands,
 * and the lens's own box follows it so the instrument stays under the hand.
 * The CARET is discrete: it is a boundary in the text, resolved from the
 * passage, and it moves only when the finger crosses one — and the lens's
 * CONTENT is pointed at it, so the tick indexes a character instead of floating
 * through whitespace.
 *
 * Reading one for the other is the defect this type exists to prevent: a
 * magnifier that reports where the hand is rather than what the engine chose.
 */
export interface SelectionPointerState {
  /** Where the finger physically is, in viewport coordinates. */
  finger: { x: number; y: number };
  /** What the lens looks at: the caret the engine resolved, or null if none. */
  caret: CaretGeometry | null;
  /**
   * How many times the resolved caret has changed to a DIFFERENT text
   * position — `{node, offset}`, never a pixel.
   *
   * This is the snap key. It is a revision rather than the key itself because
   * what consumers need is "did the boundary move?", which is exactly a
   * monotonic count: a finger travelling inside one glyph leaves it untouched
   * (nothing animates), and crossing into the next glyph advances it once (the
   * tick fires once). The counters are event-driven, so they are also the only
   * place haptic feedback can be hung without a second observer of the caret.
   */
  snapRevision: number;
}

/**
 * What the gesture is doing.
 *
 * `pending` is the moment before the surface has been claimed: a finger is
 * down, and whether this becomes a selection or a scroll is still undecided.
 * `selecting` is the claim itself — a hold that landed on a word — and
 * `extending` is that same claim once the finger has travelled. `selected` is
 * the state the current implementation does not have and the reason this
 * engine exists: the finger is up and the selection is still there, with
 * handles, until the student acts or dismisses it.
 */
export type SelectionPhase =
  | 'idle'
  | 'pending'
  | 'selecting'
  | 'extending'
  | 'selected'
  | 'adjusting-start'
  | 'adjusting-end';

/** The writing direction of the surface a selection was made in. */
export type SelectionDirection = 'ltr' | 'rtl';

/**
 * Where one endpoint's grabber sits, and which way its stem points.
 *
 * `x`/`y` are in viewport coordinates, on the line edge the handle belongs to,
 * and `stem` says which way the grabber extends from it — outward, away from the
 * selected text. The visual dot is deliberately tiny and the pointer target
 * around it is not: `x`/`y` is the optical anchor, never the hit area (see
 * `SelectionHandle`, which is a real 44×44 control centred on it).
 */
export interface SelectionHandleGeometry {
  edge: SelectionEdge;
  x: number;
  y: number;
  direction: SelectionDirection;
  stem: 'up' | 'down';
}

/**
 * Everything React is told about the live selection.
 *
 * Deliberately geometry and state only — there is no `Range` in here. The
 * engine keeps the range private so a component cannot accidentally use it for
 * `window.getSelection()`, and so re-rendering never re-measures layout.
 */
export interface SelectionPresentation {
  /** Stable per session, so an overlay can animate a change, not a remount. */
  id: string | null;
  phase: SelectionPhase;
  /** The surface is currently claimed by a finger (a gesture is in flight). */
  active: boolean;
  /** A completed selection is being held open for an action or a dismissal. */
  selected: boolean;
  selectionText: string;
  rects: readonly SelectionRect[];
  startHandle: SelectionHandleGeometry | null;
  endHandle: SelectionHandleGeometry | null;
}

export const IDLE_SELECTION: SelectionPresentation = {
  id: null,
  phase: 'idle',
  active: false,
  selected: false,
  selectionText: '',
  rects: [],
  startHandle: null,
  endHandle: null,
};

/** True while a selection exists at all, claimed or resting. */
export function selectionIsVisible(presentation: SelectionPresentation): boolean {
  return presentation.phase !== 'idle' && presentation.selectionText.length > 0;
}

/**
 * True while an endpoint is under a finger and may therefore be magnified.
 *
 * The phases in which the moving endpoint is genuinely moving — a claim being
 * extended, or a grabbed handle being dragged. Both the gesture (which decides
 * whether to measure a caret for it) and the overlay (which decides whether to
 * open the lens) ask this same question, and a second copy of the list is how
 * they would drift into disagreeing about what a student can see.
 */
export function selectionMovesEndpoint(phase: SelectionPhase): boolean {
  return phase === 'selecting'
    || phase === 'extending'
    || phase === 'adjusting-start'
    || phase === 'adjusting-end';
}
