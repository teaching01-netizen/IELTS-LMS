import { forwardRef } from "react";
import { motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { satBackdropAnimation, satSurfaceAnimation } from "./satPresence";

export interface SatPresenceSurfaceProps extends HTMLMotionProps<"div"> {
  motionKind?: "surface" | "backdrop";
  offsetY?: number;
}

export const SatPresenceSurface = forwardRef<HTMLDivElement, SatPresenceSurfaceProps>(
  function SatPresenceSurface({ motionKind = "surface", offsetY = 4, ...props }, ref) {
    const reducedMotion = Boolean(useReducedMotion());
    const isPresent = useIsPresent();
    const animation =
      motionKind === "backdrop"
        ? satBackdropAnimation(reducedMotion)
        : satSurfaceAnimation(reducedMotion, offsetY);

    return (
      <motion.div
        ref={ref}
        {...props}
        {...animation}
        aria-hidden={!isPresent ? true : props["aria-hidden"]}
        inert={!isPresent ? true : props.inert}
        data-sat-exiting={!isPresent ? true : undefined}
      />
    );
  }
);
