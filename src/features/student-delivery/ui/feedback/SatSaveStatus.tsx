import { CloudUpload } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";

export type SatSaveBannerState =
  | "idle"
  | "saving"
  | "offline"
  | "retrying"
  | "failed"
  | "superseded";

export interface SatSaveStatusProps {
  state: SatSaveBannerState;
  /** Server-provided detail; shown only when it adds to the canonical copy. */
  saveFailure?: string | null | undefined;
  onRetrySave?: (() => void) | undefined;
  onTakeOver?: (() => void) | undefined;
  isTakingOver?: boolean | undefined;
}

/**
 * Single save-status surface (Phase 0 foundation).
 *
 * Replaces the three competing shell surfaces (sr-only live text + visible
 * alert banner + offline/status banner + bare Saving text):
 * - One stable polite live region that always reads the SAME string as the
 *   visible banner, so screen readers hear each save event exactly once.
 * - Assertive `role=alert` is reserved for failed-with-action states.
 * - Superseded (lease lost) merges the route-level Take-over notice here,
 *   so the scariest state always ships its recovery action inline.
 *
 * Placement: render OUTSIDE any `inert={blocked}` root so Retry / Take over
 * stay reachable while paused (WCAG 2.1.1 / 4.1.3).
 */
export function SatSaveStatus(props: SatSaveStatusProps): React.JSX.Element | null {
  const { state } = props;
  if (state === "idle") return null;

  if (state === "saving") {
    // Wave C R-13 (visual leg): 16px neutral pending glyph prepended to the
    // saving banner. Text string identical, no color change, no live-region
    // change — the single polite region still announces the identical string
    // exactly once (no new live region).
    return (
      <div
        className="pointer-events-none fixed bottom-[calc(96px+var(--student-safe-bottom))] left-[calc(1rem+var(--student-safe-left))] z-[55] flex items-center gap-1.5 sat-type-metadata font-medium text-[var(--sat-text-secondary)]"
        role="status"
        aria-live="polite"
        data-testid="sat-save-status"
        data-sat-save-state="saving"
      >
        <CloudUpload className="h-4 w-4 motion-reduce:animate-none" aria-hidden="true" />
        <span>{SAT_COPY.saveStatus.saving}</span>
      </div>
    );
  }

  if (state === "offline" || state === "retrying") {
    const text = state === "offline" ? SAT_COPY.saveStatus.offline : SAT_COPY.saveStatus.retrying;
    return (
      <div
        className="sat-surface-enter fixed bottom-[calc(96px+var(--student-safe-bottom))] left-1/2 z-[65] flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between gap-4 border border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 sat-type-control-secondary shadow-sm"
        role="status"
        data-testid="sat-save-status"
        data-sat-save-state={state}
      >
        <span className="min-w-0 text-[var(--sat-warning)]">{text}</span>
        {state === "retrying" && props.onRetrySave ? (
          <button
            type="button"
            onClick={props.onRetrySave}
            className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-warning)] px-4 font-semibold text-[var(--sat-warning)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.saveStatus.retryNow}
          </button>
        ) : null}
      </div>
    );
  }

  const isSuperseded = state === "superseded";
  return (
    <div
      className="sat-surface-enter fixed bottom-[calc(96px+var(--student-safe-bottom))] left-1/2 z-[85] flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between gap-4 border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-4 py-3 sat-type-control-secondary shadow-lg"
      role="alert"
      data-testid="sat-save-status"
      data-sat-save-state={state}
    >
      <span className="min-w-0 text-[var(--sat-danger)]">
        {isSuperseded ? SAT_COPY.saveStatus.superseded : (props.saveFailure ?? SAT_COPY.saveStatus.failed)}
      </span>
      {isSuperseded ? (
        props.onTakeOver ? (
          <button
            type="button"
            onClick={props.onTakeOver}
            disabled={props.isTakingOver === true}
            className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-danger)] px-4 font-semibold text-[var(--sat-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-wait disabled:opacity-60"
          >
            {props.isTakingOver === true ? "Taking over" + "\u2026" : SAT_COPY.saveStatus.takeOver}
          </button>
        ) : null
      ) : props.onRetrySave ? (
        <button
          type="button"
          onClick={props.onRetrySave}
          className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-danger)] px-4 font-semibold text-[var(--sat-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          {SAT_COPY.saveStatus.retry}
        </button>
      ) : null}
    </div>
  );
}
