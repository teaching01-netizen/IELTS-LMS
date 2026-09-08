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
  saveSlot?: ReactNode | undefined;
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
  saveSlot,
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
          aria-label="Open question navigator"
          className="hidden max-[900px]:flex min-h-9 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Questions
        </button>
        {saveSlot}
      </div>
    </header>
  );
}
