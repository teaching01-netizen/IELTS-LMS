import { useRef } from "react";
import type { SatBreakPhase } from "../../application/satStudentSurface";
import { formatSatTime } from "../../domain/satTiming";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";
import { useSatTemporalSnapshot } from "../../timing/SatTemporalRuntime";

export type SatScheduledBreakPhase = SatBreakPhase;

export function SatScheduledBreakScreen({
  phase,
  nextSectionKey,
  remainingSeconds,
}: {
  phase: SatScheduledBreakPhase;
  nextSectionKey: "reading-writing" | "math";
  remainingSeconds: number | null;
}) {
  const temporal = useSatTemporalSnapshot();
  const liveRemainingSeconds = temporal
    ? phase === "waiting"
      ? temporal.pendingSectionWaitSeconds
      : temporal.pendingBreakSeconds
    : remainingSeconds;
  const nextSection = nextSectionKey === "math" ? "Math" : "Reading and Writing";
  // The countdown slot NEVER unmounts while the break is on screen: the same
  // break surface stays mounted until the next active module replaces it.
  const lastSecondsRef = useRef<number | null>(null);
  if (liveRemainingSeconds !== null) lastSecondsRef.current = liveRemainingSeconds;
  const heldSeconds = liveRemainingSeconds ?? lastSecondsRef.current;
  const displayedTime = heldSeconds === null ? null : formatSatTime(Math.max(0, heldSeconds));
  const timerReserved = liveRemainingSeconds === null && displayedTime !== null;
  const contextLabel = phase === "waiting" ? "Section complete" : "Scheduled break";
  const headline = phase === "waiting" ? "Your break begins in" : "Take a short break.";
  const supportingCopy =
    phase === "waiting"
      ? `${nextSection} is next after your scheduled break.`
      : "Your next section starts automatically.";

  return (
    <SatPresenceSurface
      data-testid="sat-scheduled-break"
      data-sat-break-phase={phase}
      className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]"
    >
      <main className="w-full max-w-lg py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">
          {contextLabel}
        </p>
        {displayedTime !== null ? (
          <p
            className="sat-tabular mt-4 text-5xl font-semibold"
            role="timer"
            aria-label={`Time remaining ${displayedTime}`}
            data-sat-break-timer={timerReserved ? "reserved" : "live"}
            aria-hidden={timerReserved ? true : undefined}
            style={timerReserved ? { visibility: "hidden" } : undefined}
          >
            {displayedTime}
          </p>
        ) : null}
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{headline}</h1>
        {phase !== "waiting" ? (
          <p className="mt-2 sat-type-control-primary font-medium text-[var(--sat-text)]">
            {nextSection} is next
          </p>
        ) : null}
        <p className="mt-3 sat-type-control-secondary leading-6 text-[var(--sat-text-secondary)]">
          {supportingCopy}
        </p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {phase === "waiting"
            ? "Section complete. Your scheduled break begins when the section clock ends."
            : "Break started."}
        </p>
      </main>
    </SatPresenceSurface>
  );
}
