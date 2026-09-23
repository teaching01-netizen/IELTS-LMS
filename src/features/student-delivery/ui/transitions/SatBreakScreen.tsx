import { formatSatTime } from "../../domain/satTiming";
import { SAT_COPY } from "../../domain/satCopy";
import type { SatBreakEntryProgress } from "../break/SatScheduledBreakScreen";

export type { SatBreakEntryProgress } from "../break/SatScheduledBreakScreen";

export function SatBreakScreen({
  nextSectionKey,
  remainingSeconds,
  onContinue,
  mode = "break",
  entryProgress = "idle",
}: {
  nextSectionKey: string;
  remainingSeconds: number | null;
  onContinue?: () => void;
  mode?: "waiting" | "break";
  entryProgress?: SatBreakEntryProgress;
}) {
  const waiting = mode === "waiting";
  const destination = nextSectionKey === "math" ? "Math is next" : "Reading and Writing is next";
  const progressLabel =
    entryProgress === "starting"
      ? SAT_COPY.transitions.startingNextSection
      : entryProgress === "retrying"
        ? SAT_COPY.transitions.retryingNextSection
        : null;
  const body =
    entryProgress === "starting"
      ? SAT_COPY.transitions.startingNextSectionBody
      : entryProgress === "retrying"
        ? SAT_COPY.transitions.retryingNextSectionBody
        : waiting
          ? "You finished early. The shared section clock is still running, so the break has not started yet."
          : remainingSeconds === null
            ? "The shared break clock is synchronizing. You do not need to do anything."
            : SAT_COPY.transitions.breakStartsAutomatically;
  const displayedTime =
    remainingSeconds === null ? "—" : formatSatTime(Math.max(0, remainingSeconds));
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
          {progressLabel ??
            (waiting ? SAT_COPY.transitions.waitingForBreak : SAT_COPY.transitions.onBreak)}
        </p>
        <p className="sat-tabular mt-4 text-5xl font-semibold" role="timer" aria-label={remainingSeconds === null ? "Break time synchronizing" : "Time remaining " + displayedTime}>
          {displayedTime}
        </p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {/* The early-finish headline only holds while nothing is opening;
              once entry is progressing the destination is the truth. */}
          {waiting && !progressLabel ? "Scheduled break begins when this timer ends" : destination}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">{body}</p>
        <p className="mt-2 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          {SAT_COPY.transitions.nextOpensAutomatically} {SAT_COPY.transitions.stuckHelp}
        </p>
        {onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            className="sat-touch-target sat-pressable mt-7 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {nextSectionKey === "math" ? "Continue to Math" : "Continue to Reading and Writing"}
          </button>
        ) : null}
      </main>
    </div>
  );
}
