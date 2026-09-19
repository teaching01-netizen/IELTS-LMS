import { SAT_COPY } from "../../domain/satCopy";
import type { AssessmentResult } from "../../contracts/assessmentDelivery";

/**
 * A Student Link may be scoped to one section (Student Access section toggles).
 * That sitting ends after that section and its result carries the section score
 * with `totalScore: null`, so the screen renders the section scale instead of a
 * blank space where the total would be. The section count comes from the result
 * payload \u2014 never from a hardcoded two.
 */
export function SatCompleteScreen({
  result,
  onExit,
}: {
  result: AssessmentResult | null;
  onExit: () => void | Promise<void>;
}) {
  const totalScore = result?.totalScore ?? null;
  const sectionScores = (result?.sections ?? []).filter(
    (section): section is typeof section & { scaledScore: number } => section.scaledScore !== null,
  );
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{SAT_COPY.transitions.completeTitle}</h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          All responses submitted. Your unofficial practice score is ready.
        </p>
        {totalScore !== null ? (
          <p className="sat-tabular mt-6 text-5xl font-semibold">{totalScore}</p>
        ) : null}
        {totalScore === null && sectionScores.length > 0 ? (
          <div className="mt-6 text-left">
            <p className="text-[13px] font-semibold text-[var(--sat-text-secondary)]">
              {SAT_COPY.transitions.sectionScoreHeading}
            </p>
            <ul className="mt-2">
              {sectionScores.map((section) => (
                <li
                  key={section.sectionKey}
                  className="flex items-baseline justify-between gap-4 border-b border-[var(--sat-divider)] py-2"
                >
                  <span className="text-[15px] font-semibold">
                    {satSectionLabel(section.sectionKey)}
                  </span>
                  <span className="sat-tabular text-3xl font-semibold">{section.scaledScore}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
              {SAT_COPY.transitions.sectionScoreOnlyNote}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void onExit()}
          className="sat-touch-target sat-pressable mt-8 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Back to dashboard
        </button>
      </main>
    </div>
  );
}

/** Section label for a result row; Math is the only other section a SAT run holds. */
function satSectionLabel(sectionKey: string): string {
  return sectionKey === "math"
    ? SAT_COPY.transitions.sectionLabelMath
    : SAT_COPY.transitions.sectionLabelReadingWriting;
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
