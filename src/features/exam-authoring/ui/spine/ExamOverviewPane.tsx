import type { ExamOverviewStats, ModuleOverviewStats } from "./overviewModel";

export interface ExamOverviewPaneProps {
  overview: ExamOverviewStats;
  isMutating: boolean;
  onSelectModule: (moduleId: string) => void;
  onOpenIssueModule?: (moduleId: string) => void;
}

export function ExamOverviewPane({ overview, isMutating, onSelectModule, onOpenIssueModule }: ExamOverviewPaneProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="exam-overview-pane">
      <section aria-label="Exam overview" className="mx-auto w-full max-w-[720px] space-y-4 pb-8">
        <div className="spine-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Exam overview</h2>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {overview.authored} of {overview.target} questions authored
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {overview.ready} ready · {overview.incomplete} need work · {overview.errors} with errors · {overview.pretest} pretest
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Exam authoring progress" aria-valuenow={overview.progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary" style={{ width: overview.progressPct + "%" }} />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {overview.target} questions are authored across all six modules, but each candidate sees only {overview.deliveredPerCandidate} (base module + one branch per section). Pretest questions ride along inside those modules and do not add extra candidate time.
          </p>
        </div>
        {overview.modules.map((stats) => (
          <ModuleOverviewCard key={stats.module.id} stats={stats} disabled={isMutating} onSelectModule={onSelectModule} onOpenIssueModule={onOpenIssueModule} />
        ))}
      </section>
    </div>
  );
}

function ModuleOverviewCard({ stats, disabled, onSelectModule, onOpenIssueModule }: { stats: ModuleOverviewStats; disabled: boolean; onSelectModule: (moduleId: string) => void; onOpenIssueModule?: ((moduleId: string) => void) | undefined }) {
  const module = stats.module;
  return (
    <article aria-label={stats.sectionTitle + " " + module.title} className="spine-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">{stats.sectionTitle}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-foreground">{module.title}</h3>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{stats.authored}/{stats.target} authored · {stats.ready} ready · {stats.incomplete} need work</p>
        </div>
        <button type="button" disabled={disabled} onClick={() => onSelectModule(module.id)} className="flex min-h-9 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-35">Open</button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted px-2 py-1.5"><dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Errors</dt><dd className="text-sm font-semibold tabular-nums text-foreground">{stats.errors}</dd></div>
        <div className="rounded-md bg-muted px-2 py-1.5"><dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pretest</dt><dd className="text-sm font-semibold tabular-nums text-foreground">{stats.pretest}</dd></div>
        <div className="rounded-md bg-muted px-2 py-1.5"><dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Status</dt><dd className="text-sm font-semibold text-foreground">{stats.complete ? "Complete" : stats.authored >= stats.target ? "Review" : "Building"}</dd></div>
      </dl>
      {stats.errors > 0 && onOpenIssueModule ? (
        <button type="button" disabled={disabled} onClick={() => onOpenIssueModule(module.id)} className="mt-2 min-h-9 text-xs font-semibold text-destructive hover:underline disabled:opacity-40">Review blocking issues in this module</button>
      ) : null}
    </article>
  );
}
