import { formatSatTime } from "../../domain/satTiming";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export type SatBreakEntryProgress = "idle" | "starting" | "retrying";

export type SatScheduledBreakPhase =
  | "waiting-for-break"
  | "on-break"
  | "opening-next-section";

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
  const nextSection = nextSectionKey === "math" ? "Math" : "Reading and Writing";
  const displayedTime =
    remainingSeconds === null ? null : formatSatTime(Math.max(0, remainingSeconds));
  const contextLabel =
    phase === "waiting-for-break"
      ? "Section complete"
      : phase === "opening-next-section"
        ? "Next section"
        : "Scheduled break";
  const headline =
    phase === "waiting-for-break"
      ? "Your break begins in"
      : phase === "opening-next-section"
        ? entryProgress === "retrying"
          ? `Still opening ${nextSection}…`
          : `Opening ${nextSection}…`
        : "Take a short break.";
  const supportingCopy =
    phase === "waiting-for-break"
      ? `${nextSection} is next after your scheduled break.`
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
          >
            {displayedTime}
          </p>
        ) : null}
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{headline}</h1>
        {phase !== "waiting-for-break" ? (
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
