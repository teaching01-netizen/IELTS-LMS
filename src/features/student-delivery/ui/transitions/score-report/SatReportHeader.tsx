import type { SatAttemptMode } from "./scoreReportViewModel";

export function SatReportHeader({
  title,
  mode = "test",
}: {
  title: string;
  /** The admitted mode; Study results say so and never imply an estimate. */
  mode?: SatAttemptMode;
}) {
  return (
    <header>
      <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
      <h1
        data-sat-stage-heading="true"
        tabIndex={-1}
        className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[32px]"
      >
        {title}
      </h1>
      <p className="mt-2 text-[14px] text-[var(--sat-text-secondary)]">
        {mode === "study"
          ? "Study attempt completed · Raw scores only"
          : "Exam completed · Answers submitted"}
      </p>
    </header>
  );
}
