import { formatSatTime } from "../../domain/satTiming";

export function SatBreakScreen({
  nextSectionKey,
  remainingSeconds,
  onContinue,
  mode = "break",
}: {
  nextSectionKey: string;
  remainingSeconds: number;
  onContinue?: () => void;
  mode?: "waiting" | "break";
}) {
  const waiting = mode === "waiting";
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
          {waiting ? "Section complete" : "Break"}
        </p>
        <p className="sat-tabular mt-4 text-5xl font-semibold">{formatSatTime(remainingSeconds)}</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {waiting
            ? "Scheduled break begins when this timer ends"
            : nextSectionKey === "math"
              ? "Math is next"
              : "Reading and Writing is next"}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          {waiting
            ? "You finished early. The shared section clock is still running, so the break has not started yet."
            : "Your next section will be available when the scheduled break ends."}
        </p>
        {onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            className="sat-touch-target sat-pressable mt-7 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            Continue
          </button>
        ) : null}
      </main>
    </div>
  );
}
