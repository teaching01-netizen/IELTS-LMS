import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

export function SatAuthoringLoadingSurface({ label }: { label: string }) {
  return (
    <main
      className="sat-product sat-authoring flex min-h-screen items-center justify-center bg-au-canvas px-6 text-slate-950"
      data-sat-authoring-state="loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-[20px] border border-au-separator bg-au-surface px-6 py-8 text-center shadow-[var(--au-elevation-sheet)]">
        <LoaderCircle
          className="mx-auto h-7 w-7 animate-spin text-au-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="mt-4 text-[15px] font-semibold text-slate-950">{label}</p>
        <p className="mt-1.5 text-[13px] leading-5 text-slate-600">
          Preparing the SAT authoring workspace.
        </p>
      </div>
    </main>
  );
}

export interface SatAuthoringErrorSurfaceProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SatAuthoringErrorSurface({
  title,
  description,
  actionLabel,
  onAction,
}: SatAuthoringErrorSurfaceProps) {
  return (
    <main className="sat-product sat-authoring flex min-h-screen items-center justify-center bg-au-canvas px-6 text-slate-950">
      <section
        className="w-full max-w-lg rounded-[20px] border border-au-danger/20 bg-au-surface px-6 py-8 shadow-[var(--au-elevation-sheet)] sm:px-8"
        data-sat-authoring-state="error"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-au-danger-tint text-au-danger-text">
            <TriangleAlert size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-950">{title}</h1>
            <p className="mt-2 text-[13px] leading-5 text-slate-600">{description}</p>
          </div>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-au-accent px-4 text-[13px] font-semibold text-white hover:bg-au-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2"
          >
            <RefreshCw size={15} aria-hidden="true" />
            {actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  );
}
