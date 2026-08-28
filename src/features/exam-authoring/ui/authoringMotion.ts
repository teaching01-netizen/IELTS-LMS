import type { Transition } from "motion/react";

export const AUTHORING_EASE = [0.22, 1, 0.36, 1] as const;
export const AUTHORING_EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

export const authoringMotion = {
  press: { scale: 0.97 },
  hoverLift: { y: -1 },
  fast: { duration: 0.1, ease: AUTHORING_EASE_STANDARD },
  state: { duration: 0.16, ease: AUTHORING_EASE },
  panel: { duration: 0.22, ease: AUTHORING_EASE },
  surface: { duration: 0.2, ease: AUTHORING_EASE },
  spring: {
    type: "spring",
    stiffness: 520,
    damping: 40,
    mass: 0.72,
  } satisfies Transition,
  settle: {
    type: "spring",
    stiffness: 430,
    damping: 36,
    mass: 0.8,
  } satisfies Transition,
} as const;
