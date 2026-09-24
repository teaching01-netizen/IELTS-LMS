import { satMotion } from "./satMotion";

export function satSurfaceAnimation(reducedMotion: boolean, offsetY = 4) {
  return {
    initial: reducedMotion ? false : { opacity: 0, y: offsetY },
    animate: { opacity: 1, y: 0, pointerEvents: "auto" as const },
    exit: reducedMotion
      ? { opacity: 1, pointerEvents: "none" as const, transition: { duration: 0 } }
      : {
          opacity: 0,
          y: Math.min(offsetY, 3),
          pointerEvents: "none" as const,
          transition: satMotion.surfaceExit,
        },
    transition: reducedMotion ? { duration: 0 } : satMotion.surface,
  };
}

export function satBackdropAnimation(reducedMotion: boolean) {
  return {
    initial: reducedMotion ? false : { opacity: 0 },
    animate: { opacity: 1, pointerEvents: "auto" as const },
    exit: reducedMotion
      ? { opacity: 1, pointerEvents: "none" as const, transition: { duration: 0 } }
      : { opacity: 0, pointerEvents: "none" as const, transition: satMotion.surfaceExit },
    transition: reducedMotion ? { duration: 0 } : satMotion.surface,
  };
}

/**
 * The stage cross-fade (student stage host).
 *
 * Pure opacity, no rise: a stage is a whole screen — the exam, its break, the
 * pre-start wait — and sliding one out from under the other reads as movement
 * the student did not cause. The incoming stage fades up over the outgoing one
 * so the exam is never replaced by a blank viewport, and the outgoing stage is
 * inert and `aria-hidden` while it fades, so assistive tech never sees two
 * surfaces at once. Reduced motion removes the presence entirely (the host
 * renders one layer), which is also why the reduced-motion exit is a no-op here.
 */
export function satStageAnimation(reducedMotion: boolean) {
  return {
    initial: reducedMotion ? false : { opacity: 0 },
    animate: { opacity: 1, pointerEvents: "auto" as const },
    exit: reducedMotion
      ? { opacity: 1, pointerEvents: "none" as const, transition: { duration: 0 } }
      : { opacity: 0, pointerEvents: "none" as const, transition: satMotion.surfaceExit },
    transition: reducedMotion ? { duration: 0 } : satMotion.surface,
  };
}
