import { useEffect, useId, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";

export interface SatIntegrityWarningProps {
  /** Rendered only while a visibility excursion is unacknowledged. */
  open: boolean;
  onContinue: () => void;
}

/**
 * SAT exam-screen integrity hold (Digital SAT delivery).
 *
 * Shown immediately after the student *returns* — never while they are away,
 * because the browser cannot render anything then and a background timer is
 * exactly what iOS suspends. It is the SAT-native counterpart of the IELTS
 * `WarningOverlay` and carries the same copy from the same shared rule, so both
 * delivery branches behave identically even though their chrome does not.
 *
 * Deliberately blocking and non-dismissible:
 * - no countdown and no auto-close (an integrity hold that expires is not a hold);
 * - Escape does not close it;
 * - focus is trapped on the single action while it is open;
 * - the action only acknowledges — no exam command runs, so the module, timer,
 *   question index, answers, annotations and calculator state are untouched.
 */
export function SatIntegrityWarning({ open, onContinue }: SatIntegrityWarningProps) {
  const actionRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() =>
      actionRef.current?.focus({ preventScroll: true })
    );
    // Single-control dialog: Tab must not walk the exam behind the hold.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      actionRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`sat-ui sat-dialog-backdrop fixed inset-0 ${satOverlayZClass("blockingVeil")} flex items-center justify-center bg-black/55`}
      data-testid="sat-integrity-warning"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-8 text-center shadow-[var(--sat-shadow-modal)]"
      >
        <TriangleAlert
          className="mx-auto h-6 w-6 text-[var(--sat-warning)]"
          aria-hidden="true"
        />
        <h2
          id={titleId}
          className="mt-2 text-[20px] font-semibold tracking-tight text-[var(--sat-text)]"
        >
          {SAT_COPY.integrity.visibilityTitle}
        </h2>
        <p
          id={descriptionId}
          className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]"
        >
          {SAT_COPY.integrity.visibilityBody}
        </p>
        <button
          ref={actionRef}
          type="button"
          onClick={onContinue}
          className="sat-touch-target sat-pressable mt-6 inline-flex items-center justify-center rounded-full border border-[var(--sat-text)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
        >
          {SAT_COPY.integrity.visibilityContinue}
        </button>
      </div>
    </div>
  );
}
