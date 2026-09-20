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
