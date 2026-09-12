/* SAT-scoped full-surface states. The exam's worst moments (load failure,
 * finalization) must stay inside the exam's visual system — never fall back to
 * the admin skin, a second accent, or a second type stack. */

export interface SatErrorSurfaceProps {
  title: string;
  description: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SatErrorSurface({
  title,
  description,
  detail,
  actionLabel,
  onAction,
}: SatErrorSurfaceProps) {
  return (
    <div
      className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-[var(--sat-text)]"
      role="alert"
    >
      <div className="w-full max-w-md text-center">
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] leading-6 text-[var(--sat-text-secondary)]">{description}</p>
        {detail ? (
          <p className="mt-3 break-words text-[13px] leading-5 text-[var(--sat-text-secondary)]">
            {detail}
          </p>
        ) : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="sat-touch-target sat-pressable mt-6 inline-flex items-center justify-center rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type SatLoadingKind = "initial" | "module-refresh" | "finalizing";

export const SAT_LOADING_LABELS: Record<SatLoadingKind, string> = {
  initial: "Loading Digital SAT…",
  "module-refresh": "Refreshing SAT module…",
  finalizing: "Finalizing SAT responses…",
};

export interface SatLoadingSurfaceProps {
  /** Semantic loading reason. Drives label default plus test hooks. */
  kind?: SatLoadingKind | undefined;
  /** Explicit label override. When omitted, falls back to SAT_LOADING_LABELS[kind ?? "initial"]. */
  label?: string | undefined;
}

export function SatLoadingSurface({ kind = "initial", label }: SatLoadingSurfaceProps) {
  const resolvedLabel = label ?? SAT_LOADING_LABELS[kind];
  return (
    <div
      className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 text-[var(--sat-text)]"
      role="status"
      aria-live="polite"
      data-sat-loading-kind={kind}
    >
      <div className="w-full max-w-sm text-center">
        <div
          className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-[var(--sat-divider-soft)] border-t-[var(--sat-text)] motion-reduce:hidden"
          aria-hidden="true"
        />
        <p className="mt-4 text-[15px] font-semibold">{resolvedLabel}</p>
        <div className="mt-6 space-y-2" aria-hidden="true">
          <div className="mx-auto h-3 w-2/3 animate-pulse rounded-full bg-[var(--sat-surface-subtle)] motion-reduce:animate-none" />
          <div className="mx-auto h-3 w-1/2 animate-pulse rounded-full bg-[var(--sat-surface-subtle)] [animation-delay:150ms] motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}