import type { StudentScoreReportView, ScoreDisplay } from "./scoreReportViewModel";

export function formatRange(low: number, high: number): string {
  return low === high ? String(low) : `${low}–${high}`;
}

const SCORE_CLASS =
  "mt-2 text-[40px] font-semibold leading-tight tabular-nums sm:text-[56px] [overflow-wrap:anywhere]";

function PrimaryValue({ score }: { score: ScoreDisplay }) {
  if (score.kind === "estimated") {
    return <p className={SCORE_CLASS}>{formatRange(score.low, score.high)}</p>;
  }
  if (score.kind === "raw") {
    return (
      <p className={SCORE_CLASS}>
        {score.correct} of {score.total}{" "}
        <span className="ml-2 text-[16px] font-medium text-[var(--sat-text-secondary)]">correct</span>
      </p>
    );
  }
  return <p className="mt-2 text-[18px] font-semibold">{score.reason}</p>;
}

/** The one primary result; a partial conversion has none and leans on the section results instead. */
export function SatScoreOverview({ view }: { view: StudentScoreReportView }) {
  const { primaryScore, primaryLabel, subjects } = view;
  if (!primaryScore) {
    return view.notice ? (
      <p className="text-[14px] text-[var(--sat-text-secondary)]">{view.notice}</p>
    ) : null;
  }
  const single = view.layout === "single-subject" ? subjects[0] : undefined;
  return (
    <section aria-labelledby="sat-report-primary" className="border-t border-[var(--sat-divider)] pt-6">
      {primaryLabel ? (
        <h2 id="sat-report-primary" className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
          {primaryLabel}
        </h2>
      ) : null}
      <PrimaryValue score={primaryScore} />
      {primaryScore.kind === "estimated" ? (
        <p className="mt-1 text-[14px] tabular-nums text-[var(--sat-text-secondary)]">
          Score scale {primaryScore.scale.min}–{primaryScore.scale.max}
        </p>
      ) : null}
      {single && single.score.kind === "estimated" ? (
        <p className="mt-1 text-[14px] tabular-nums">
          {single.rawCorrect} of {single.rawTotal} scored questions correct
        </p>
      ) : null}
      {primaryScore.kind === "estimated" ? (
        <p className="mt-3 text-[13px] text-[var(--sat-text-secondary)]">
          Estimated using a classroom score conversion table. Not an official SAT score.
        </p>
      ) : null}
      {view.notice ? (
        <p className="mt-3 text-[14px] text-[var(--sat-text-secondary)]">{view.notice}</p>
      ) : null}
    </section>
  );
}
