import { useEffect, useId, useRef, type ReactNode } from "react";
import { SAT_COPY } from "../../domain/satCopy";

export function SatControlBanner({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "warning" | "error";
}) {
  const warning = tone === "warning";
  return (
    <div
      className={`sat-ui sat-surface-enter fixed left-1/2 top-[calc(100px+var(--student-safe-top))] z-[85] w-[min(92vw,680px)] -translate-x-1/2 border px-4 py-3 text-center text-[14px] font-medium shadow-lg ${warning ? "border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] text-[var(--sat-warning)]" : "border-[var(--sat-danger)] bg-[var(--sat-danger-soft)] text-[var(--sat-danger)]"}`}
      role={warning ? "status" : "alert"}
      aria-live={warning ? "polite" : undefined}
    >
      {children}
    </div>
  );
}

export function SatLeaseConflictNotice({
  error,
  isTakingOver,
  onTakeOver,
}: {
  error: string | null;
  isTakingOver: boolean;
  onTakeOver: () => void;
}) {
  return (
    <div
      className="sat-ui fixed inset-x-4 top-[calc(100px+var(--student-safe-top))] z-[90] mx-auto flex max-w-2xl items-center justify-between gap-4 border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-4 py-3 text-left shadow-lg"
      role="alert"
      aria-live="assertive"
    >
      <div>
        <p className="text-[14px] font-semibold text-[var(--sat-text)]">
          This attempt is open in another session.
        </p>
        <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">
          {error ?? "Pause here or take over explicitly to continue saving responses."}
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-[6px] border border-[var(--sat-text)] px-3 py-2 text-[13px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-text)] hover:text-[var(--sat-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-wait disabled:opacity-60"
        onClick={onTakeOver}
        disabled={isTakingOver}
      >
        {isTakingOver ? "Taking over…" : "Take over"}
      </button>
    </div>
  );
}

export function SatTimeoutOverlay({
  saveFailureKind,
  saveFailure,
  onRetrySave,
}: {
  saveFailureKind: "offline" | "retryable" | "terminal" | "superseded" | null;
  saveFailure: string | null;
  onRetrySave: () => void;
}) {
  const hasSaveFailure = saveFailureKind !== null;
  const note =
    saveFailureKind === "offline"
      ? SAT_COPY.timeout.offline
      : saveFailureKind === "retryable" || saveFailureKind === "terminal"
        ? saveFailure || SAT_COPY.timeout.failed
        : saveFailureKind === "superseded"
          ? SAT_COPY.review.saveSuperseded
          : SAT_COPY.timeout.recordingAnswers;
  return (
    <div
      className="sat-ui fixed inset-0 z-[80] grid place-items-center bg-[var(--sat-background)]/90"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="rounded-[8px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-7 py-5 text-center shadow-xl">
        <div
          className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--sat-divider-soft)] border-t-[var(--sat-text)] motion-reduce:hidden"
          aria-hidden="true"
        />
        <p className="text-[14px] font-semibold text-[var(--sat-text)]">{SAT_COPY.timeout.title}</p>
        <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">{note}</p>
        {hasSaveFailure && saveFailureKind !== "superseded" ? (
          <button
            type="button"
            onClick={onRetrySave}
            className="sat-touch-target sat-pressable mt-4 rounded-full border border-[var(--sat-divider)] px-5 text-[14px] font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.review.retrySave}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SatBlockingOverlay({ note }: { note: string | null }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.focus({ preventScroll: true })
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      dialogRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="sat-ui sat-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/55">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-8 text-center shadow-[var(--sat-shadow-modal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
      >
        {/* Phase 6d: blocked controls render visibly disabled WITH the reason
            inline — the inert root alone is not an explanation (the route
            banner carries the same copy for redundancy, not contradiction). */}
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
          Paused by proctor
        </p>
        <h2
          id={titleId}
          className="mt-2 text-2xl font-semibold tracking-tight text-[var(--sat-text)]"
        >
          {SAT_COPY.blocking.pausedTitle}
        </h2>
        <p
          id={descriptionId}
          className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]"
        >
          {note ?? SAT_COPY.blocking.pausedBody + " Your remaining module time is preserved."}
        </p>
      </div>
    </div>
  );
}
