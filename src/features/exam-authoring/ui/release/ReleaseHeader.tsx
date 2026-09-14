import type { ReactNode } from "react";
import { ArrowLeft, Link2 } from "lucide-react";

interface ReleaseHeaderProps {
  examTitle: string;
  onBack: () => void;
  onOpenStudentAccess?: (() => void) | undefined;
  presenceSlot?: ReactNode;
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
}

export function ReleaseHeader({ examTitle, onBack, onOpenStudentAccess, presenceSlot, saveSlot, collaborationSlot }: ReleaseHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex min-h-[68px] max-w-[1240px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Back to builder
        </button>
        <div className="h-5 w-px bg-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            {examTitle}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Release</p>
        </div>
        {onOpenStudentAccess ? (
          <button
            type="button"
            onClick={onOpenStudentAccess}
            className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Link2 size={14} aria-hidden="true" />
            Student Access
          </button>
        ) : null}
        {collaborationSlot ? (
          <span className="inline-flex min-w-0 items-center">{collaborationSlot}</span>
        ) : (
          <>
            {presenceSlot ? <span className="inline-flex min-w-0 items-center">{presenceSlot}</span> : null}
            {saveSlot ? <span className="inline-flex min-w-0 items-center">{saveSlot}</span> : null}
          </>
        )}
      </div>
    </header>
  );
}
