import { SatModuleBreakdown } from "./SatModuleBreakdown";
import { formatRange } from "./SatScoreOverview";
import type { StudentScoreReportView, SubjectReportView } from "./scoreReportViewModel";

function SubjectCard({ subject, repeatScore }: { subject: SubjectReportView; repeatScore: boolean }) {
  const headingId = `sat-subject-${subject.key}`;
  const { score } = subject;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[var(--sat-divider)] p-5"
    >
      <h3 id={headingId} className="text-[18px] font-semibold">
        {subject.label}
      </h3>
      {repeatScore ? (
        score.kind === "estimated" ? (
          <>
            <p className="mt-2 text-[28px] font-semibold tabular-nums sm:text-[36px]">
              {formatRange(score.low, score.high)}
            </p>
            <p className="text-[13px] text-[var(--sat-text-secondary)]">Estimated score</p>
          </>
        ) : score.kind === "unavailable" && score.display === "dash" ? (
          <>
            <p className="mt-2 text-[28px] font-semibold tabular-nums sm:text-[36px]">
              <span aria-hidden="true">-</span>
              <span className="sr-only">{score.reason}</span>
            </p>
            <p className="text-[13px] text-[var(--sat-text-secondary)]">Estimated score</p>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-[var(--sat-text-secondary)]">
            An estimated score is not available for this section.
          </p>
        )
      ) : null}
      {repeatScore ? (
        <p className="mt-2 text-[14px] tabular-nums">
          {subject.rawCorrect} of {subject.rawTotal} scored questions correct
        </p>
      ) : null}
      <SatModuleBreakdown modules={subject.modules} />
    </section>
  );
}

/** Only the subjects actually delivered; a lone subject is full width and its score is already the primary result. */
export function SatSubjectPerformance({ view }: { view: StudentScoreReportView }) {
  if (view.subjects.length === 0) return null;
  const single = view.layout === "single-subject";
  return (
    <div className={`mt-8 grid gap-4 ${view.subjects.length > 1 ? "md:grid-cols-2" : ""}`}>
      {view.subjects.map((subject) =>
        single && subject.modules.length === 0 ? null : (
          <SubjectCard key={subject.key} subject={subject} repeatScore={!single} />
        )
      )}
    </div>
  );
}
