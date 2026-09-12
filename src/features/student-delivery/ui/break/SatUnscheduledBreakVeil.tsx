import { useEffect, useRef } from "react";
import { Coffee } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";

export interface SatUnscheduledBreakVeilProps {
  open: boolean;
  remainingLabel: string;
  remainingSeconds?: number | undefined;
  onReturn: () => void;
}

/**
 * Bluebook Unscheduled Break veil (Phase 8). Blocks question interaction
 * while showing the LIVE module timer — time keeps running, autosubmit at
 * zero still fires underneath, persistence/outbox keep running. No backend
 * pause call: this is presentation-only. Return restores the exact question
 * (scroll preserved: the question tree never unmounts beneath the veil).
 *
 * Distinct from the proctor pause veil (frozen timer + proctor note) and the
 * scheduled break screen (break countdown, auto-advance). If proctor pause
 * lands while veiled, the blocking veil (z 100) covers this veil; time
 * expiry submission (z 95) also covers it. The veil sits on the
 * breakVeil (94) contract layer: above tools/modals but below submission.
 */
export function SatUnscheduledBreakVeil(props: SatUnscheduledBreakVeilProps) {
  const returnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const frame = window.requestAnimationFrame(() => returnRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);
  if (!props.open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={SAT_COPY.unscheduledBreak.veilTitle}
      data-testid="sat-break-veil"
      className={"sat-ui fixed inset-0 " + satOverlayZClass("breakVeil") + " grid place-items-center bg-[var(--sat-background)] px-6"}
    >
      <div className="w-full max-w-[480px] text-center">
        <p className="flex items-center justify-center gap-2 text-[15px] font-semibold text-[var(--sat-text-secondary)]">
          <Coffee className="h-5 w-5" aria-hidden="true" />
          {SAT_COPY.unscheduledBreak.veilTitle}
        </p>
        <p className="mt-3 text-[15px] text-[var(--sat-text)]">
          {SAT_COPY.unscheduledBreak.veilBody}
        </p>
        <p
          className="sat-tabular mt-4 text-[34px] font-semibold text-[var(--sat-text)]"
          role="timer"
          aria-label={"Time remaining " + props.remainingLabel}
        >
          {props.remainingLabel}
        </p>
        <button
          ref={returnRef}
          type="button"
          onClick={props.onReturn}
          className="sat-touch-target sat-pressable mt-6 rounded-full bg-[var(--sat-accent)] px-8 text-[15px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          {SAT_COPY.unscheduledBreak.returnToTest}
        </button>
      </div>
    </div>
  );
}
