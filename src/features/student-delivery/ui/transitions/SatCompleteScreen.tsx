import type { AssessmentResult } from "../../contracts/assessmentDelivery";

export function SatCompleteScreen({
  result,
  onExit,
}: {
  result: AssessmentResult | null;
  onExit: () => void | Promise<void>;
}) {
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Complete</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">SAT responses submitted</h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          Your practice result is ready.
        </p>
        {result?.totalScore !== null && result?.totalScore !== undefined ? (
          <p className="sat-tabular mt-6 text-5xl font-semibold">{result.totalScore}</p>
        ) : null}
        <button
          type="button"
          onClick={() => void onExit()}
          className="sat-touch-target sat-pressable mt-8 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Return
        </button>
      </main>
    </div>
  );
}

export function SatTerminatedScreen({
  note,
  onExit,
}: {
  note: string | null;
  onExit: () => void | Promise<void>;
}) {
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-danger)]">Session ended</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your SAT attempt has ended</h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          {note || "Please contact the proctor if you need assistance."}
        </p>
        <button
          type="button"
          onClick={() => void onExit()}
          className="sat-touch-target sat-pressable mt-8 rounded-full bg-[var(--sat-text)] px-6 text-[14px] font-semibold text-[var(--sat-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Return
        </button>
      </main>
    </div>
  );
}
