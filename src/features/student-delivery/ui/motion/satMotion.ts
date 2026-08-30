import type { Transition } from "motion/react";

// Craft values, not Apple constants. SAT motion stays brief because these interactions repeat constantly.
export const SAT_MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export const satMotion = {
  state: { duration: 0.13, ease: SAT_MOTION_EASE },
  surface: { duration: 0.16, ease: SAT_MOTION_EASE },
  surfaceExit: { duration: 0.11, ease: SAT_MOTION_EASE },
  detent: {
    type: "spring",
    stiffness: 480,
    damping: 42,
    mass: 0.82,
    restDelta: 0.5,
    restSpeed: 6,
  } satisfies Transition,
} as const;
