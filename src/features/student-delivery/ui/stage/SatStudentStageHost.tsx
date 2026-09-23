import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { satStageAnimation } from "../motion/satPresence";
import type { SatStudentStageKind } from "../../application/satStudentSurface";

export interface SatStudentStageHostProps {
  /**
   * Stage identity from the stage selector. `key` is the presence identity:
   * while it does not change, the stage is the same mounted surface and the
   * student is still on the same screen. `kind` is exposed for tests and e2e.
   */
  stage: { readonly kind: SatStudentStageKind; readonly key: string };
  /**
   * Replace the stage immediately, with no cross-fade.
   *
   * True when this render is not a transition at all: the route is carrying a
   * different attempt (a new attempt is a new page, never the old exam fading
   * into the new one), and it also drops any layer still fading out, so a
   * swapped identity leaves exactly one surface in the document.
   */
  instant?: boolean | undefined;
  children: ReactNode;
}

/**
 * One layer of a stage, with the presence state it renders in.
 *
 * A layer that is on its way out is inert and hidden from assistive tech while
 * it fades, so at every instant exactly one student surface is the live one —
 * role queries and screen readers see one, not two.
 */
function SatStudentStageLayer({
  stageKind,
  stageKey,
  children,
}: {
  stageKind: SatStudentStageKind;
  stageKey: string;
  children: ReactNode;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const isPresent = useIsPresent();
  return (
    <motion.div
      data-sat-stage={stageKind}
      data-sat-stage-key={stageKey}
      {...(isPresent ? {} : { "data-sat-stage-exiting": "true" })}
      aria-hidden={isPresent ? undefined : true}
      inert={isPresent ? undefined : true}
      className="absolute inset-0 min-h-[100dvh] min-w-0"
      {...satStageAnimation(reducedMotion)}
    >
      {children}
    </motion.div>
  );
}

/**
 * The one owner of student surface presentation (Stage model).
 *
 * Every student-visible surface renders inside this host, in one stage layer on
 * one backdrop. A stage change is a cross-fade between two layers instead of a
 * hard cut from one full-screen tree to another, which is what made a module
 * handoff, a break and a section start look like the app flashing through its
 * states.
 *
 * The backdrop is the exam's own `--sat-background`: layers are absolutely
 * positioned over it, so an incoming stage never briefly reveals the browser's
 * default canvas, and a stage that does not fill the viewport cannot let the
 * document scroll underneath.
 *
 * Reduced motion renders the current layer with no presence at all: an instant
 * replacement, never a two-layer frame.
 */
export function SatStudentStageHost({ stage, instant = false, children }: SatStudentStageHostProps) {
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div
      data-sat-stage-root="true"
      className="relative min-h-[100dvh] w-full bg-[var(--sat-background)]"
    >
      {reducedMotion || instant ? (
        // No AnimatePresence: with motion removed there is nothing to wait for,
        // and a zero-duration exit layer would only be a second surface in the
        // DOM for no visible gain. `instant` takes this same path on purpose —
        // it also removes any layer still fading out from the previous identity.
        <div
          data-sat-stage={stage.kind}
          data-sat-stage-key={stage.key}
          className="absolute inset-0 min-h-[100dvh] min-w-0"
        >
          {children}
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <SatStudentStageLayer key={stage.key} stageKind={stage.kind} stageKey={stage.key}>
            {children}
          </SatStudentStageLayer>
        </AnimatePresence>
      )}
    </div>
  );
}
