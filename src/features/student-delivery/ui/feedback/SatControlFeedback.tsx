import { useEffect, useId, useRef, type ReactNode } from "react";

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

export function SatSubmissionOverlay({
  title = "Finalizing module…",
  note = "Your latest responses are being verified.",
}: {
  title?: string;
  note?: string;
}) {
  return (
    <div
      className="sat-ui fixed inset-0 z-[95] grid place-items-center bg-[var(--sat-background)]/90"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="rounded-[8px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-7 py-5 text-center shadow-xl">
        <div
          className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--sat-divider-soft)] border-t-[var(--sat-text)] motion-reduce:hidden"
          aria-hidden="true"
        />
        <p className="text-[14px] font-semibold text-[var(--sat-text)]">{title}</p>
        <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">{note}</p>
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
        className="w-full max-w-md rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-8 text-center shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
      >
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
          Paused by proctor
        </p>
        <h2
          id={titleId}
          className="mt-2 text-2xl font-semibold tracking-tight text-[var(--sat-text)]"
        >
          Your timer is paused
        </h2>
        <p
          id={descriptionId}
          className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]"
        >
          {note ||
            "Wait for the proctor to resume your attempt. Your remaining module time is preserved."}
        </p>
      </div>
    </div>
  );
}
