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
 * Failure-only save surface.
 *
 * Routine persistence is silent: idle / saving / offline / retrying render
 * nothing at all. The exam never narrates saving that is working — a student
 * mid-question has no decision to make about it, and a status that appears and
 * disappears on every keystroke is noise beside the work.
 *
 * What survives is the only thing that changes what the student must do:
 * - `failed` — a save genuinely did not land. Assertive `role=alert`, and Retry
 *   ships inline so the recovery action is never a search.
 * - `superseded` — the lease was lost, which merges the route-level Take-over
 *   notice here so the scariest state also ships its action inline.
 *
 * Placement: render OUTSIDE any `inert={blocked}` root so Retry / Take over
 * stay reachable while paused (WCAG 2.1.1 / 4.1.3).
 */
export function SatSaveStatus(props: SatSaveStatusProps): React.JSX.Element | null {
  const { state } = props;
  if (state !== "failed" && state !== "superseded") return null;

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
