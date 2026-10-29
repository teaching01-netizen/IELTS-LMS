import { useEffect } from "react";
import type { SatBreakPhase } from "../../application/satStudentSurface";
import { formatSatTime } from "../../domain/satTiming";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";
import { useSatTemporalSnapshot } from "../../timing/SatTemporalRuntime";

export type SatScheduledBreakPhase = SatBreakPhase;

export function SatScheduledBreakScreen({
  phase,
  nextSectionKey,
  remainingSeconds,
  nextHasForm = false,
  requiresEntryConfirmation = false,
  onSurfaceMounted,
  notice = null,
}: {
  phase: SatScheduledBreakPhase;
  nextSectionKey: "reading-writing" | "math";
  remainingSeconds: number | null;
  nextHasForm?: boolean;
  requiresEntryConfirmation?: boolean;
  /** Reports the mounted surface so break preparation starts only once it can be seen. */
  onSurfaceMounted?: (mounted: boolean) => void;
  /** Preparation retry or refusal text; announced with the phase status. */
  notice?: string | null;
}) {
  useEffect(() => {
    onSurfaceMounted?.(true);
    return () => onSurfaceMounted?.(false);
  }, [onSurfaceMounted]);

  // The per-second snapshot re-derives the same break window the controller
  // uses, so preparing → active → ending flips on the boundary itself rather
  // than on the next controller render.
  const temporal = useSatTemporalSnapshot();
  let livePhase = phase;
  let liveSeconds = remainingSeconds;
  let leadSeconds: number | null = null;
  if (temporal && phase === "waiting") {
    liveSeconds = temporal.pendingSectionWaitSeconds;
  } else if (temporal) {
    const window = temporal.breakWindow;
    livePhase = window.phase === "preparing" ? "preparing" : window.phase === "active" ? "active" : "ending";
    liveSeconds = window.seconds;
    // The confirmed future start: count into the break instead of leaving the
    // slot blank for the 3 s between confirmation and the clock starting.
    leadSeconds = window.phase === "preparing" ? window.leadSeconds : null;
  }
  const nextSection = nextSectionKey === "math" ? "Math" : "Reading and Writing";
  // The countdown slot NEVER unmounts while the break is on screen, and only a
  // positive countdown is shown: preparing without a confirmed start, and
  // ending, keep the slot's space but render no time, so 0:00 is never shown or
  // read as remaining time. The lead countdown is visual only — it is not the
  // candidate's remaining time, so it is never exposed as the timer.
  const liveCountdown = liveSeconds !== null && liveSeconds > 0 ? formatSatTime(liveSeconds) : null;
  const leadCountdown = leadSeconds !== null && leadSeconds > 0 ? formatSatTime(leadSeconds) : null;
  const timerText = liveCountdown ?? leadCountdown;
  const contextLabel = livePhase === "waiting" ? "Section complete" : "Scheduled break";
  const headline =
    livePhase === "waiting"
      ? "Your break begins in"
      : livePhase === "preparing"
        ? "Preparing your break…"
        : livePhase === "ending"
          ? `Preparing ${nextSection}…`
          : "Take a short break.";
  const supportingCopy =
    livePhase === "waiting"
      ? `${nextSection} is next after your scheduled break.`
      : nextHasForm ? "After your break, complete your section details before starting. Your exam timer starts after entry." : requiresEntryConfirmation ? "After your break, choose Begin module when you are ready." : "Your next section starts automatically.";
  const status =
    livePhase === "waiting"
      ? "Section complete. Your scheduled break begins when the section clock ends."
      : livePhase === "preparing"
        ? "Preparing your break."
        : livePhase === "ending"
          ? `Break over. Preparing ${nextSection}.`
          : "Break started.";

  return (
    <SatPresenceSurface
      data-testid="sat-scheduled-break"
      data-sat-break-phase={livePhase}
      className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]"
    >
      <main className="w-full max-w-lg py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">
          {contextLabel}
        </p>
        <p
          className="sat-tabular mt-4 text-5xl font-semibold"
          role={liveCountdown ? "timer" : undefined}
          aria-label={liveCountdown ? `Time remaining ${liveCountdown}` : undefined}
          data-sat-break-timer={liveCountdown ? "live" : leadCountdown ? "lead" : "reserved"}
          aria-hidden={liveCountdown ? undefined : true}
          style={timerText ? undefined : { visibility: "hidden" }}
        >
          {timerText ?? " "}
        </p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-6 text-2xl font-semibold tracking-tight"
        >
          {headline}
        </h1>
        {livePhase !== "waiting" && livePhase !== "ending" ? (
          <p className="mt-2 sat-type-control-primary font-medium text-[var(--sat-text)]">
            {nextSection} is next
          </p>
        ) : null}
        <p className="mt-3 sat-type-control-secondary leading-6 text-[var(--sat-text-secondary)]">
          {supportingCopy}
        </p>
        {notice ? (
          <p className="mt-3 sat-type-control-secondary font-medium text-[var(--sat-text)]">{notice}</p>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {notice ? `${status} ${notice}` : status}
        </p>
      </main>
    </SatPresenceSurface>
  );
}
