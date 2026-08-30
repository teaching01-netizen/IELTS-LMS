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
