import type { Transition } from 'motion/react';

/*
 * Shared SAT motion language (promoted from the authoring spine).
 *
 * Springs are the default vocabulary: critically damped (damping ratio ~= 1.0)
 * so every surface settles exactly where it is sent - no overshoot, no lag -
 * and each animation can be interrupted and redirected from its live
 * presentation value. Durations exist only for opacity cross-fades, which
 * must stay crisp. Reduced-motion users get instant state changes through the
 * global `prefers-reduced-motion` blocks in index.css plus `MotionConfig
 * reducedMotion="user"` at the SAT roots.
 *
 * zeta(spring) = 44 / (2*sqrt(480)) ~= 1.00 - settles in ~=0.28s
 * zeta(settle) = 36 / (2*sqrt(322)) ~= 1.00 - settles in ~=0.35s
 * zeta(snap)   = 50 / (2*sqrt(640)) ~= 0.99 - settles in ~=0.25s
 *
 * RULE: components reference these tokens. No inline durations/easings.
 */
export const AUTHORING_EASE = [0.22, 1, 0.36, 1] as const;
export const AUTHORING_EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

/** Scoped redesign timings; shared delivery motion remains unchanged. */
export const spineMotion = {
  hover:{duration:0.12,ease:AUTHORING_EASE_STANDARD},
  focus:{duration:0.15,ease:AUTHORING_EASE_STANDARD},
  menu:{duration:0.17,ease:AUTHORING_EASE_STANDARD},
  panel:{duration:0.22,ease:AUTHORING_EASE_STANDARD},
  question:{duration:0.12,ease:AUTHORING_EASE_STANDARD},
} as const;

export const authoringMotion = {
  /** Press feedback: subtle scale, never locks interaction. */
  press: { scale: 0.97 },
  hoverLift: { y: -1 },
  /** Micro fades (icons, ticks, keystroke feedback). */
  fast: { duration: 0.1, ease: AUTHORING_EASE_STANDARD },
  /** Question-to-question editor swap: quick, directional, interruptible. */
  question: { duration: 0.18, ease: AUTHORING_EASE },
  /** State cross-fades (save status, chips, small reveals). */
  state: { duration: 0.16, ease: AUTHORING_EASE },
  panel: { duration: 0.22, ease: AUTHORING_EASE },
  surface: { duration: 0.2, ease: AUTHORING_EASE },
  /** Default UI spring - critically damped, quick Apple feel. */
  spring: {
    type: 'spring',
    stiffness: 480,
    damping: 44,
    mass: 1,
  } satisfies Transition,
  /** Larger surfaces (sheets, panels) - critically damped, unhurried. */
  settle: {
    type: 'spring',
    stiffness: 322,
    damping: 36,
    mass: 1,
  } satisfies Transition,
  /** Small geometry (segmented thumbs, ticks) - critically damped, snappy. */
  snap: {
    type: 'spring',
    stiffness: 640,
    damping: 50,
    mass: 1,
  } satisfies Transition,
} as const;
