import type { ModuleReportView } from "./scoreReportViewModel";

/** Collapsed by default; lists only modules present in the scored report. */
export function SatModuleBreakdown({ modules }: { modules: ModuleReportView[] }) {
  if (modules.length === 0) return null;
  return (
    <details className="group mt-4 border-t border-[var(--sat-divider)]">
      <summary className="sat-touch-target flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] [&::-webkit-details-marker]:hidden">
        Module breakdown
        <span
          aria-hidden="true"
          className="text-[var(--sat-text-secondary)] transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          ⌄
        </span>
      </summary>
      <dl className="space-y-2 pb-2 text-[14px]">
        {modules.map((module) => (
          <div key={module.key} className="flex justify-between gap-3">
            <dt className="text-[var(--sat-text-secondary)]">{module.label}</dt>
            <dd className="tabular-nums">
              {module.rawCorrect} of {module.rawTotal} correct
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
