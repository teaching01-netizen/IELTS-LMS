import type { StudentScoreReportView } from "./scoreReportViewModel";

export function SatReportMethodology({
  methodology,
}: {
  methodology: StudentScoreReportView["methodology"];
}) {
  return (
    <details className="group mt-8 border-t border-[var(--sat-divider)]">
      <summary className="sat-touch-target flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] [&::-webkit-details-marker]:hidden">
        About your score
        <span
          aria-hidden="true"
          className="text-[var(--sat-text-secondary)] transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          ⌄
        </span>
      </summary>
      <ul className="list-disc space-y-2 pb-2 pl-5 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
        <li>SAT-style estimates come from the classroom conversion table assigned to this exam.</li>
        <li>Correct answers count scored operational questions only; pretest questions are excluded.</li>
        <li>Estimates are not official College Board scores.</li>
        <li>Some partial or one-module sittings cannot be converted, so only correct answers are shown.</li>
        {methodology.converterVersion ? (
          <li>Conversion table version: {methodology.converterVersion}.</li>
        ) : null}
      </ul>
    </details>
  );
}
