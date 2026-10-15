import { CheckCircle2, X } from "lucide-react";

/** What the import produced, read from the shell the commit returned. */
export interface WorkbookImportSummary {
  total: number;
  sections: { title: string; count: number }[];
}

interface WorkbookImportUndoBannerProps {
  /** Absent after a reload: the server still offers undo, but the counts are gone. */
  summary: WorkbookImportSummary | null;
  /** Questions currently failing readiness. */
  issueCount: number;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onReviewIssues: () => void;
  onDismiss: () => void;
}

function questionsLabel(count: number): string {
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

/** The one confirmation an author sees after an Excel import. */
export function WorkbookImportUndoBanner({
  summary,
  issueCount,
  canUndo,
  busy,
  onUndo,
  onReviewIssues,
  onDismiss,
}: WorkbookImportUndoBannerProps) {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-au-separator px-4 py-2 authoring-glass"
      data-testid="workbook-import-banner"
    >
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1 text-slate-700">
          <span className="font-semibold text-slate-900">
            {summary ? `Imported ${questionsLabel(summary.total)} from Excel` : "Imported from Excel"}
          </span>
          {summary && summary.sections.length > 0 ? (
            <span className="text-slate-500">
              {" — "}
              {summary.sections.map((section) => `${section.title} ${section.count}`).join(" · ")}
            </span>
          ) : null}
        </p>
        {issueCount > 0 ? (
          <button
            type="button"
            onClick={onReviewIssues}
            className="authoring-interactive min-h-8 rounded-[9px] px-2.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-50"
          >
            {issueCount === 1 ? "1 needs attention" : `${issueCount} need attention`} · Review
          </button>
        ) : null}
        {canUndo ? (
          <button
            type="button"
            disabled={busy}
            onClick={onUndo}
            className="authoring-interactive min-h-8 rounded-[9px] px-2.5 text-[12px] font-semibold text-au-accent hover:bg-au-accent-tint disabled:opacity-40"
          >
            {busy ? "Undoing…" : "Undo import"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss import summary"
          className="authoring-interactive grid size-8 place-items-center rounded-[9px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
