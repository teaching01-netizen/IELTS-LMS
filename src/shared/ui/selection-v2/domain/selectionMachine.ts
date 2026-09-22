/**
 * The gesture, as explicit state rather than inferred refs.
 *
 * The previous implementation spread "is a gesture running" across a gesture
 * ref, a hold timer, an owned range and a two-valued phase, and asked the DOM to
 * settle everything else. That worked until the two things a student actually
 * notices went wrong. Releasing the finger deleted the selection they had just
 * made, so there was nothing to adjust and nothing to act on. And a gesture that
 * had already claimed text could be abandoned by a second finger landing, with
 * no state transition to say whether the overlay had been cleared or the hold
 * timer was still armed.
 *
 * So every transition below is a named edge, and every side effect the gesture
 * needs — arming the hold, capturing the pointer, suppressing scrolling,
 * reporting a completed selection, clearing the overlay — is RETURNED rather
 * than performed. The reducer touches no DOM, so the whole interaction grammar
 * is a table of inputs and outputs that a test can walk through, and the hook
 * that consumes it owns only "how", never "when".
 *
 * ONE ENDPOINT MOVES; THE OTHER IS FIXED.
 *
 * `fixed` and `moving` are positions, not a start and an end: a drag
 * right-to-left makes the moving endpoint the READING-order start, and it has
 * to keep following the finger from there. Whichever visual edge the finger
 * currently owns is derived (`movingEdge`) and, when the finger drags the
 * moving endpoint clear across the fixed one, the two swap so the finger keeps
 * the endpoint it grabbed instead of the selection inverting under it. That one
 * rule is what makes handle crossover, reverse drags and "adjust the start of a
 * selection past its end" the same code path.
 */

import { compareTextPoints } from '../engine/selectionPoint';
import type { SelectionEdge, SelectionPhase, TextPoint } from './selectionTypes';

/** How a gesture claims the text: a hold, or the drag an armed tool already meant. */
export type SelectionActivation = 'long-press' | 'drag';

export interface SelectionMachineState {
  phase: SelectionPhase;
  activation: SelectionActivation;
  /** How far the finger may travel before a pending gesture is a decision. */
  moveTolerancePx: number;
  /** The pointer that owns the gesture. A second one cancels instead of joining. */
  pointerId: number | null;
  pointerType: string;
  origin: { x: number; y: number } | null;
  /** The endpoint the gesture is NOT moving. */
  fixed: TextPoint | null;
  /** The endpoint the finger owns. */
  moving: TextPoint | null;
  /** Which visual end `moving` currently sits at, in reading order. */
  movingEdge: SelectionEdge;
}

export type SelectionMachineEvent =
  | { type: 'press'; pointerId: number; pointerType: string; x: number; y: number; point: TextPoint }
  | { type: 'hold' }
  | { type: 'move'; pointerId: number; x: number; y: number; point?: TextPoint | null }
  | { type: 'release'; pointerId: number; x?: number; y?: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'grab'; pointerId: number; edge: SelectionEdge; x: number; y: number }
  | { type: 'dismiss' };

export type SelectionEffect =
  | { type: 'arm-hold' }
  | { type: 'disarm-hold' }
  | { type: 'capture-pointer'; pointerId: number }
  | { type: 'release-pointer'; pointerId: number }
  | { type: 'suppress-scroll' }
  | { type: 'allow-scroll' }
  | { type: 'commit' }
  | { type: 'clear' };

export interface SelectionTransition {
  state: SelectionMachineState;
  effects: SelectionEffect[];
}

export function idleSelectionState(
  activation: SelectionActivation = 'long-press',
  moveTolerancePx = 8,
): SelectionMachineState {
  return {
    phase: 'idle',
    activation,
    moveTolerancePx,
    pointerId: null,
    pointerType: '',
    origin: null,
    fixed: null,
    moving: null,
    movingEdge: 'end',
  };
}

/** True while a finger is down and this machine owns it. */
export function selectionOwnsPointer(state: SelectionMachineState): boolean {
  return state.phase !== 'idle' && state.phase !== 'selected' && state.pointerId !== null;
}

/** True when a completed selection is being held open for an action. */
export function selectionIsResting(state: SelectionMachineState): boolean {
  return state.phase === 'selected';
}

/** Which visual end the moving endpoint is at, in reading order. */
export function movingEdgeOf(fixed: TextPoint | null, moving: TextPoint | null): SelectionEdge {
  if (!fixed || !moving) return 'end';
  return compareTextPoints(moving, fixed) < 0 ? 'start' : 'end';
}

/** True when two positions are the same character in the same node. */
function sameTextPoint(a: TextPoint, b: TextPoint): boolean {
  return a.node === b.node && a.offset === b.offset;
}

/** The endpoint at the selection's reading-order start, or null. */
export function startEndpointOf(state: SelectionMachineState): TextPoint | null {
  if (!state.fixed || !state.moving) return null;
  return state.movingEdge === 'start' ? state.moving : state.fixed;
}

/** The endpoint at the selection's reading-order end, or null. */
export function endEndpointOf(state: SelectionMachineState): TextPoint | null {
  if (!state.fixed || !state.moving) return null;
  return state.movingEdge === 'start' ? state.fixed : state.moving;
}

/**
 * Points, with the crossover rule applied.
 *
 * The finger keeps the endpoint it is moving. So when the new position lands on
 * the far side of the fixed endpoint, the two swap and `movingEdge` flips — the
 * selection stays ordered, the range stays valid, and the handle that was
 * grabbed keeps tracking the finger.
 */
function withPoints(
  state: SelectionMachineState,
  fixed: TextPoint,
  moving: TextPoint,
): SelectionMachineState {
  const next = { ...state, fixed, moving };
  return { ...next, movingEdge: movingEdgeOf(fixed, moving) };
}

function phaseForEdge(edge: SelectionEdge): SelectionPhase {
  return edge === 'start' ? 'adjusting-start' : 'adjusting-end';
}

/** The effects that hand a claimed gesture back to the platform's scrolling. */
function handBack(state: SelectionMachineState): SelectionEffect[] {
  const effects: SelectionEffect[] = [
    { type: 'disarm-hold' },
    { type: 'allow-scroll' },
    { type: 'clear' },
  ];
  if (state.pointerId !== null) effects.push({ type: 'release-pointer', pointerId: state.pointerId });
  return effects;
}

/** True when a move at this coordinate must be resolved against the text. */
export function moveNeedsPoint(state: SelectionMachineState, x: number, y: number): boolean {
  if (state.phase === 'selecting' || state.phase === 'extending') return true;
  if (state.phase === 'adjusting-start' || state.phase === 'adjusting-end') return true;
  if (state.phase !== 'pending' || !state.origin) return false;
  return Math.hypot(x - state.origin.x, y - state.origin.y) > state.moveTolerancePx;
}

export function reduceSelection(
  state: SelectionMachineState,
  event: SelectionMachineEvent,
): SelectionTransition {
  switch (event.type) {
    case 'press': {
      // A second pointer is the PLATFORM's gesture — two-finger scrolling and
      // pinch-zoom are how a student reads a passage, and the finger already
      // down belongs to something. Everything is handed back, including a
      // selection that had already been claimed, and the new press starts
      // nothing: the page scrolls as it would without this engine.
      if (state.phase !== 'idle') return { state: idleSelectionState(state.activation, state.moveTolerancePx), effects: handBack(state) };
      return {
        state: {
          ...state,
          phase: 'pending',
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          origin: { x: event.x, y: event.y },
          fixed: event.point,
          moving: event.point,
          movingEdge: 'end',
        },
        // The hold is armed but scrolling is NOT suppressed: a finger that
        // travels before the hold completes is reading, not marking.
        effects: [{ type: 'arm-hold' }, { type: 'capture-pointer', pointerId: event.pointerId }],
      };
    }

    case 'hold': {
      if (state.phase !== 'pending') return { state, effects: [{ type: 'disarm-hold' }] };
      // The hold landed. What it selects is the word under the finger, which the
      // engine resolves — the machine only owns the claim.
      return {
        state: { ...state, phase: 'selecting' },
        effects: [{ type: 'disarm-hold' }, { type: 'suppress-scroll' }],
      };
    }

    case 'move': {
      if (state.pointerId === null || event.pointerId !== state.pointerId) return { state, effects: [] };

      const fixed = state.fixed;
      if (!fixed) return { state, effects: [] };

      if (state.phase === 'pending') {
        if (!state.origin) return { state, effects: [] };
        if (!moveNeedsPoint(state, event.x, event.y)) return { state, effects: [] };
        if (state.activation !== 'drag') {
          // The finger is going somewhere and no tool is armed: this is a
          // scroll, and scrolling is the browser's. Nothing was captured from
          // the platform and nothing is prevented.
          return { state: idleSelectionState(state.activation, state.moveTolerancePx), effects: handBack(state) };
        }
        // The tool is armed, so travelling means "this text", not "scroll me".
        const points = event.point ? withPoints(state, fixed, event.point) : state;
        return {
          state: { ...points, phase: event.point ? 'extending' : 'selecting' },
          effects: [{ type: 'suppress-scroll' }],
        };
      }

      if (state.phase === 'selecting' || state.phase === 'extending') {
        if (!event.point) return { state, effects: [] };
        // A hold reports a position for the finger that never moved — the frame
        // that resolves it cannot tell the difference between "resting" and
        // "travelled", and the phase is the only honest place to keep them
        // apart. Once the gesture HAS travelled it stays `extending`, even if the
        // finger comes back to where it started, because the selection is then a
        // drag that happens to be empty rather than a hold.
        const restingOnTheHold = state.phase === 'selecting' && sameTextPoint(event.point, fixed);
        return {
          state: { ...withPoints(state, fixed, event.point), phase: restingOnTheHold ? 'selecting' : 'extending' },
          effects: [],
        };
      }

      if (state.phase === 'adjusting-start' || state.phase === 'adjusting-end') {
        if (!event.point) return { state, effects: [] };
        const next = withPoints(state, fixed, event.point);
        return { state: { ...next, phase: phaseForEdge(next.movingEdge) }, effects: [] };
      }

      // A stray move after the finger is up (or before it landed) must never
      // resurrect a selection nobody is holding.
      return { state, effects: [] };
    }

    case 'release': {
      if (state.pointerId === null || event.pointerId !== state.pointerId) return { state, effects: [] };
      if (state.phase === 'pending') {
        // A tap is not a selection. Nothing was claimed, so nothing is reported
        // and the overlay was never painted.
        return { state: idleSelectionState(state.activation, state.moveTolerancePx), effects: handBack(state) };
      }
      if (state.phase === 'selecting' || state.phase === 'extending' || state.phase === 'adjusting-start' || state.phase === 'adjusting-end') {
        // THE difference from the implementation this replaces: the finger is
        // up and the selection stays, with handles, until the student acts on it
        // or dismisses it.
        return {
          state: { ...state, phase: 'selected', pointerId: null, origin: null },
          effects: [{ type: 'disarm-hold' }, { type: 'release-pointer', pointerId: event.pointerId }, { type: 'allow-scroll' }, { type: 'commit' }],
        };
      }
      return { state, effects: [] };
    }

    case 'cancel': {
      if (state.pointerId === null || event.pointerId !== state.pointerId) return { state, effects: [] };
      // The platform took the gesture (a page scroll, a pinch, an incoming
      // call). Nothing is reported — a selection the student never finished is
      // not one they meant.
      return { state: idleSelectionState(state.activation, state.moveTolerancePx), effects: handBack(state) };
    }

    case 'grab': {
      // Handles exist only on a resting selection, and only one finger may hold
      // one: a grab during a live gesture is treated as noise.
      if (state.phase !== 'selected' || !state.fixed || !state.moving) return { state, effects: [] };
      const start = startEndpointOf(state);
      const end = endEndpointOf(state);
      if (!start || !end) return { state, effects: [] };
      const grabbed = event.edge === 'start' ? start : end;
      const anchor = event.edge === 'start' ? end : start;
      return {
        state: {
          ...state,
          phase: phaseForEdge(event.edge),
          pointerId: event.pointerId,
          pointerType: 'handle',
          origin: { x: event.x, y: event.y },
          fixed: anchor,
          moving: grabbed,
          movingEdge: event.edge,
        },
        effects: [{ type: 'capture-pointer', pointerId: event.pointerId }],
      };
    }

    case 'dismiss': {
      if (state.phase === 'idle') return { state, effects: [] };
      return { state: idleSelectionState(state.activation, state.moveTolerancePx), effects: handBack(state) };
    }

    default:
      return { state, effects: [] };
  }
}
