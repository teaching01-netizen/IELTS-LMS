import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Progress } from "@/src/components/ui/progress";

export interface SpineHeaderProps {
  examTitle: string;
  sectionTitle: string | null;
  moduleTitle: string | null;
  authored: number;
  target: number;
  progressPct: number;
  errorCount: number;
  workspaceMode: "build" | "issues";
  onModeChange: (mode: "build" | "issues") => void;
  saveSlot?: ReactNode | undefined;
  workbookImportDisabled: boolean;
  onOpenWorkbookImport: () => void;
  previewDisabled: boolean;
  onOpenFullPreview: () => void;
  releaseHref: string;
  onOpenRelease: () => void;
  onBack: () => void;
  onOpenQueue: () => void;
}

/**
 * Spine header (plan Phase 3): module progress is L1 — a real Progress bar
 * with numeric authored/target copy, never a lone decorative micro-bar.
 */
export function SpineHeader({
  examTitle,
  sectionTitle,
  moduleTitle,
  authored,
  target,
  progressPct,
  errorCount,
  workspaceMode,
  onModeChange,
  saveSlot,
  workbookImportDisabled,
  onOpenWorkbookImport,
  previewDisabled,
  onOpenFullPreview,
  releaseHref,
  onOpenRelease,
  onBack,
  onOpenQueue,
}: SpineHeaderProps) {
  const progressLabel = `${authored} of ${target} questions authored`;
  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="mx-auto flex min-h-[52px] w-full max-w-[1200px] items-center gap-2 px-3 py-1.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to SAT Exam Library"
          title="Back to SAT Exam Library"
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="hidden lg:inline">Exam Library</span>
        </button>
        <div className="min-w-0 flex-1 px-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight">{examTitle}</h1>
            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              Draft
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {sectionTitle && moduleTitle ? `${sectionTitle} · ${moduleTitle} · ` : null}
              {progressLabel}
            </p>
            <Progress
              value={progressPct}
              aria-label={progressLabel}
              className="hidden w-28 shrink-0 sm:block"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenQueue}
          aria-label={workspaceMode === "issues" ? "Open authoring issues" : "Open question navigator"}
          className="hidden max-[900px]:flex min-h-9 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {workspaceMode === "issues" ? "Issues" : "Questions"}
        </button>
        <div
          role="group"
          aria-label="Authoring view"
          className="hidden shrink-0 items-center rounded-md bg-muted p-0.5 min-[901px]:flex"
        >
          <button
            type="button"
            aria-pressed={workspaceMode === "build"}
            onClick={() => onModeChange("build")}
            className={`min-h-9 rounded px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${workspaceMode === "build" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Build
          </button>
          <button
            type="button"
            aria-pressed={workspaceMode === "issues"}
            onClick={() => onModeChange("issues")}
            className={`flex min-h-9 items-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${workspaceMode === "issues" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Issues
            {errorCount ? (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold tabular-nums text-destructive">
                {errorCount}
              </span>
            ) : null}
          </button>
        </div>
        {saveSlot}
        <button
          type="button"
          disabled={workbookImportDisabled}
          onClick={onOpenWorkbookImport}
          title="Import the complete SAT from an Excel workbook"
          className="hidden min-h-9 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 min-[901px]:flex"
        >
          Import
        </button>
        <button
          type="button"
          disabled={previewDisabled}
          onClick={onOpenFullPreview}
          aria-label="Open the full SAT preview"
          title="Open the full SAT using the real student delivery renderer"
          className="hidden min-h-9 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 md:flex"
        >
          Preview
        </button>
        <a
          href={releaseHref}
          onClick={(event) => {
            event.preventDefault();
            onOpenRelease();
          }}
          className="flex min-h-9 shrink-0 items-center rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Release
        </a>
      </div>
    </header>
  );
}
