import type { ModuleReportView } from "./scoreReportViewModel";

/** Always shown; lists only modules present in the scored report. */
export function SatModuleBreakdown({ modules }: { modules: ModuleReportView[] }) {
  if (modules.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[var(--sat-divider)] pt-3">
      <h4 className="text-[14px] font-semibold">Module breakdown</h4>
      <dl className="mt-2 space-y-2 text-[14px]">
        {modules.map((module) => (
          <div key={module.key} className="flex justify-between gap-3">
            <dt className="text-[var(--sat-text-secondary)]">{module.label}</dt>
            <dd className="tabular-nums">
              {module.rawCorrect} of {module.rawTotal} correct
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
