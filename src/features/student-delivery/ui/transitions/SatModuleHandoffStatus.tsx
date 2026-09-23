import { formatSatTime } from "../../domain/satTiming";
import { satOverlayZClass } from "../primitives/satOverlayZ";

export interface SatModuleHandoffStatusProps {
  /** Student-facing title of the module being opened (e.g. "Module 2"). */
  moduleTitle: string;
  /** True once entry has failed at least once and can be retried by hand. */
  retrying: boolean;
  /**
   * The shared section clock the student is still on, or null when this frame
   * has no authority to quote it. Never a module clock: the module has not
   * started yet.
   */
  remainingSeconds: number | null;
  onRetry?: (() => void) | undefined;
}

/**
 * The one live surface over a module handoff.
 *
 * It is rendered as a SIBLING of the frozen exam frame, never inside it: the
 * frame is `inert` and `aria-hidden` while the next module opens, so a status
 * placed inside it would be the one thing an assistive-tech student could not
 * hear. The card is a plain veil over the frame the student already knows —
 * nothing about the exam moves, and the only thing that changes is this line.
 *
 * Motion is deliberately absent: this is a status, not a screen.
 */
export function SatModuleHandoffStatus({
  moduleTitle,
  retrying,
  remainingSeconds,
  onRetry,
}: SatModuleHandoffStatusProps) {
  return (
    <div
      data-sat-handoff="true"
      data-sat-handoff-state={retrying ? "retrying" : "opening"}
      className={`sat-ui absolute inset-0 grid ${satOverlayZClass("submissionVeil")} place-items-center bg-[var(--sat-viewer-backdrop)] px-6 py-8 text-center text-[var(--sat-text)]`}
    >
      <main className="w-full max-w-lg py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">
          Digital SAT
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {retrying ? `Still opening ${moduleTitle}…` : `Opening ${moduleTitle}…`}
        </h1>
        {remainingSeconds !== null ? (
          <>
            <p className="sat-tabular mt-4 text-3xl font-semibold" data-sat-handoff-clock="true">
              {formatSatTime(Math.max(0, remainingSeconds))}
            </p>
            <p className="mt-1 sat-type-control-secondary text-[var(--sat-text-secondary)]">
              left in this section
            </p>
          </>
        ) : null}
        <p className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]">
          {retrying
            ? "Your saved answers are safe. This module will open automatically."
            : "Your next module opens automatically."}
        </p>
        {retrying && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="sat-touch-target sat-pressable mt-7 rounded-full bg-[var(--sat-accent)] px-6 sat-type-control-secondary font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            Retry now
          </button>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {retrying ? `Still opening ${moduleTitle}.` : `Opening ${moduleTitle}.`}
        </p>
      </main>
    </div>
  );
}
