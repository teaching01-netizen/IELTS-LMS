import { useRef } from "react";
import type { SatBreakEntryProgress, SatBreakPhase } from "../../application/satStudentSurface";
import { formatSatTime } from "../../domain/satTiming";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";
import { useSatTemporalSnapshot } from "../../timing/SatTemporalRuntime";

// The three break phases are one stage, so their names live with the stage
// selector; the screen re-exports them for the surfaces that only know the
// break UI.
export type { SatBreakEntryProgress };
export type SatScheduledBreakPhase = SatBreakPhase;

export function SatScheduledBreakScreen({
  phase,
  nextSectionKey,
  remainingSeconds,
  entryProgress = "idle",
}: {
  phase: SatScheduledBreakPhase;
  nextSectionKey: "reading-writing" | "math";
  remainingSeconds: number | null;
  entryProgress?: SatBreakEntryProgress;
}) {
  const temporal = useSatTemporalSnapshot();
  const liveRemainingSeconds = temporal
    ? phase === "waiting-for-break"
      ? temporal.pendingSectionWaitSeconds
      : phase === "on-break"
        ? temporal.pendingBreakSeconds
        : remainingSeconds
    : remainingSeconds;
  const nextSection = nextSectionKey === "math" ? "Math" : "Reading and Writing";
  // The countdown slot NEVER unmounts while the break is on screen: waiting for
  // the break, taking the break and opening the next section are one surface,
  // and a card that loses its big number between phases jumps at exactly the
  // moment the next section starts. The run-out phase has no time left to count,
  // so the slot keeps the last value but is hidden — never a 0:00 the student
  // could read as remaining time, and never a hole where the clock was.
  const lastSecondsRef = useRef<number | null>(null);
  if (liveRemainingSeconds !== null) lastSecondsRef.current = liveRemainingSeconds;
  const heldSeconds = liveRemainingSeconds ?? lastSecondsRef.current;
  const displayedTime = heldSeconds === null ? null : formatSatTime(Math.max(0, heldSeconds));
  const timerReserved = liveRemainingSeconds === null && displayedTime !== null;
  const contextLabel =
    phase === "waiting-for-break"
      ? "Section complete"
      : phase === "starting-break"
        ? "Scheduled break"
      : phase === "opening-next-section"
        ? "Next section"
        : "Scheduled break";
  const headline =
    phase === "waiting-for-break"
      ? "Your break begins in"
      : phase === "starting-break"
        ? "Your break is starting…"
      : phase === "opening-next-section"
        ? entryProgress === "retrying"
          ? `Still opening ${nextSection}…`
          : `Opening ${nextSection}…`
        : "Take a short break.";
  const supportingCopy =
    phase === "waiting-for-break"
      ? `${nextSection} is next after your scheduled break.`
      : phase === "starting-break"
        ? "Your full scheduled break will begin shortly."
      : entryProgress === "retrying"
        ? "Your saved answers are safe. This section will open automatically."
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
        {phase !== "waiting-for-break" && phase !== "starting-break" ? (
          <p className="mt-2 sat-type-control-primary font-medium text-[var(--sat-text)]">
            {nextSection} is next
          </p>
        ) : null}
        <p className="mt-3 sat-type-control-secondary leading-6 text-[var(--sat-text-secondary)]">
          {supportingCopy}
        </p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {phase === "waiting-for-break"
            ? "Section complete. Your scheduled break begins when the section clock ends."
            : phase === "starting-break"
              ? "Your scheduled break is starting. The full break time begins when the break starts."
            : phase === "on-break"
              ? "Break started."
              : entryProgress === "retrying"
                ? `Still opening ${nextSection}.`
                : `Opening ${nextSection}.`}
        </p>
      </main>
    </SatPresenceSurface>
  );
}
