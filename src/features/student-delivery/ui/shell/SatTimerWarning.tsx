import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";

export interface SatTimerWarningProps {
  open: boolean;
  remainingLabel: string;
  onDismiss: () => void;
}

/**
 * Bluebook 5-minute visual warning (Phase 7). Shows once when the module
 * crosses the threshold: warning title plus live remaining time.
 * Dismissible, re-arms per module. Display-only: the timer keeps running
 * and answers stay untouched. Sits above tools (z 96) so Desmos can never
 * cover it; below the proctor blocking veil (z 100).
 */
export function SatTimerWarning(props: SatTimerWarningProps) {
  // Dismiss-path parity: every other dialog has an Escape path; the warning
  // keeps alertdialog clothing, so it needs one too. One press dismisses
  // only (no timer/answer side effect); one-shot + re-arm stay in the shell.
  // Capture phase: an open surface (navigator/popover) also listens for
  // Escape on document — the warning must claim the press first so the
  // surface-close handlers (which yield on defaultPrevented) stand down.
  const { open, onDismiss } = props;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onDismiss]);
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={SAT_COPY.timerWarning.title}
      data-testid="sat-timer-warning"
      className={"sat-ui fixed left-1/2 top-16 " + satOverlayZClass("timerWarning") + " w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-5 py-4 text-center text-[var(--sat-text)] shadow-[var(--sat-shadow-modal)]"}
    >
      <p className="flex items-center justify-center gap-2 sat-type-control-primary font-semibold">
        <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        {SAT_COPY.timerWarning.title}
      </p>
      <p className="mt-1 sat-type-metadata text-[var(--sat-text-secondary)]">
        {SAT_COPY.timerWarning.body}
      </p>
      {/* scale-exception: text-[22px] warning clock has no type token (timer token is 20px); literal kept intentionally. */}
      <p className="sat-tabular mt-2 text-[22px] font-semibold" data-testid="sat-timer-warning-time">
        {props.remainingLabel}
      </p>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label={SAT_COPY.timerWarning.dismiss}
        data-sat-timer-warning-dismiss
        className="sat-touch-target sat-pressable mt-2 rounded-full border border-[var(--sat-text)] px-5 sat-type-metadata font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
      >
        {SAT_COPY.help.closeButton}
      </button>
    </div>
  );
}
