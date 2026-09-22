import { useAnimationControls, useReducedMotion, type Transition } from 'motion/react';
import { useEffect, useRef } from 'react';
import { selectionMotion } from '@shared/motion';

/**
 * The overlay's motion policy, in one place.
 *
 * The NUMBERS are not here: they are the shared vocabulary in `@shared/motion`
 * (`selectionMotion`), alongside every other spring in the app, so the selection
 * engine cannot drift into having its own idea of what a settle feels like. What
 * lives here is the POLICY — which token drives which moment, and what a
 * reduced-motion platform is shown instead.
 *
 * Reduced motion is read once, from the platform, and resolved into the targets
 * themselves rather than branched on at each element: a component that had to ask
 * `reduce ? ... : ...` would be a second place the policy could be got wrong, and
 * the failure is invisible (an entrance nobody asked for, or content that starts
 * half-size and never grows because it was assumed to be animating).
 *
 * The `data-selection-motion` witness exists so the policy is OBSERVABLE: the
 * e2e suite reads it to prove the platform's preference reached this code, and
 * asserts the geometry a reduced-motion student sees, instead of inferring the
 * policy from an absence of movement that a slow frame could also explain.
 */

type MotionTargets = { scale: number; opacity: number };

export interface SelectionMotionProps {
  /** What the element is painted at on its first frame. `false` starts it settled. */
  initial: MotionTargets | false;
  animate: MotionTargets;
  transition: Transition;
  /** `reduced` when the platform asked for less motion: nothing starts transformed. */
  'data-selection-motion': 'full' | 'reduced';
}

/**
 * A handle's grip: it appears as the selection settles, swells while its endpoint
 * is being dragged, and springs back when the finger lifts.
 *
 * Only the grip moves. The handle BUTTON is positioned by the engine from the
 * measured text — its 44px target is the thing a student aims at, so it stays
 * exactly where it was measured and the animation is confined to the dot inside
 * it. That is also why `held` changes a scale rather than a position: the release
 * has something to settle back from without the target ever moving under a finger.
 */
export function resolveGripMotion(held: boolean, reduce: boolean): SelectionMotionProps {
  return {
    initial: reduce ? false : { scale: selectionMotion.gripEnterScale, opacity: 0 },
    animate: { scale: held && !reduce ? selectionMotion.gripHeldScale : 1, opacity: 1 },
    transition: selectionMotion.grip,
    'data-selection-motion': reduce ? 'reduced' : 'full',
  };
}

/**
 * The magnifier's entrance: it scales and fades in, and is otherwise static.
 *
 * The lens's own box keeps its exact inline transform and is never animated, so
 * the finger-relative arithmetic the suite measures (`top` one lens-height above
 * the finger, centred on it) holds on every frame rather than only at rest. The
 * frame inside it does the growing.
 */
export function resolveLoupeMotion(reduce: boolean): SelectionMotionProps {
  return {
    initial: reduce ? false : { scale: selectionMotion.loupeEnterScale, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: selectionMotion.loupe,
    'data-selection-motion': reduce ? 'reduced' : 'full',
  };
}

/*
 * The two hooks below are only the PLATFORM ADAPTER: they read the preference and
 * hand it to the resolvers above. The decision lives in a pure function on
 * purpose — motion reads `prefers-reduced-motion` once per document and caches it
 * (which is what a page that loads with the preference set deserves, and what a
 * browser-only `emulateMedia`-before-load reproduces), so the policy can be
 * asserted deterministically here while the platform read is asserted in a real
 * browser, where the platform exists.
 */

export function useGripMotion(held: boolean): SelectionMotionProps {
  return resolveGripMotion(held, Boolean(useReducedMotion()));
}

export function useLoupeMotion(): SelectionMotionProps {
  return resolveLoupeMotion(Boolean(useReducedMotion()));
}

/* ------------------------------------------------------------------ tick -- */

/**
 * THE TICK'S TARGET — a pure decision, or nothing at all.
 *
 * Both halves of the reduced-motion contract live in this one return value.
 * `null` under `prefers-reduced-motion` drops the BOUNCE and only the bounce:
 * the caller still holds the revision, the lens's content still jumps to the new
 * boundary and the gesture still buzzes — that is the snap, information a
 * student needs to tell which character they reached — while the spring back
 * from the peak is decoration, and the platform asked not to see it. `null` at
 * revision 0 is the same shape for a caret that has not moved: no crossing, no
 * tick, no render.
 *
 * The keyframes are ABSOLUTE POSITIONS, NOT DISPLACEMENTS. `set(peak)` followed
 * by `start(home)` is the obvious shape and it is wrong the moment two ticks
 * land closer together than one return: a `set` issued while the previous spring
 * is still travelling composites onto the value that spring is sitting on
 * instead of replacing it — measured on this element at 1.061 × 1.08 = 1.146, a
 * nominal "1.08" tick that had grown past 17% and kept growing the faster the
 * student dragged. Every entry below is where the indicator IS, so the peak is
 * bounded by the token that names it whatever the previous tick was still
 * doing, and a new tick supplants the one in flight.
 */
export function resolveCaretTickMotion(
  reduce: boolean,
  snapRevision: number,
  axis: 'scale' | 'scaleY',
  peak: number,
): { scaleY: [number, number] } | { scale: [number, number] } | null {
  if (reduce || snapRevision === 0) return null;
  return axis === 'scaleY' ? { scaleY: [peak, 1] } : { scale: [peak, 1] };
}

/**
 * THE TICK, and the one thing in this overlay driven by an EVENT rather than a frame.
 *
 * The caret does not travel to a new character boundary; it is there or it is
 * not. So its feedback does not travel either: on the frame the boundary
 * changed, the indicator is DISPLACED to its peak and springs back from there.
 * Easing up to the peak instead would take as long as the return and read as a
 * wobble the student's own finger appears to be causing — which is precisely the
 * looping-motion language this is replacing.
 *
 * The input is `snapRevision` alone: it advances only when `{node, offset}`
 * changes, which builds the causality in one place — a finger moving inside a
 * glyph animates NOTHING (no render of this element is even asked for), a
 * crossing animates once, a new line animates once.
 *
 * WHAT IT NEVER TOUCHES. Not the lens's box (the engine's measurement, written
 * directly), not the picture (data), not the 44px handle target (a control that
 * arrives after the finger is a control you miss). The displacement is applied
 * to a precision indicator and to nothing else.
 *
 * REDUCED MOTION drops the bounce and keeps the snap. The caret still resolves
 * to its new boundary and the lens's content still jumps to it — that is
 * information, and suppressing it would leave a student unable to tell which
 * character they had reached. Only the spring back from the peak is skipped.
 *
 * `axis` exists because the two indicators swell differently: the lens's column
 * tick must grow along the column (`scaleY`, 1 → 1.08 → 1) or it stops being a
 * line, while the grip grows all round.
 */
export function useCaretSnapMotion(
  snapRevision: number,
  peak: number,
  axis: 'scale' | 'scaleY' = 'scale',
) {
  const controls = useAnimationControls();
  const reduce = Boolean(useReducedMotion());
  const mounted = useRef(false);

  useEffect(() => {
    // The revision present at mount is not a CHANGE: the loupe opens on a caret
    // that already exists, and its own entrance has already said "here".
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const target = resolveCaretTickMotion(reduce, snapRevision, axis, peak);
    if (!target) return;
    void controls.start({ ...target, transition: selectionMotion.caretSnap });
  }, [axis, controls, peak, reduce, snapRevision]);

  return controls;
}
