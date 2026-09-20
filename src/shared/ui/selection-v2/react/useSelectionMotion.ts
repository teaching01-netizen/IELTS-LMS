import { useReducedMotion, type Transition } from 'motion/react';
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
