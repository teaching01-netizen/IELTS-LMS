import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { SAT_COPY } from "../../domain/satCopy";

export type SatSaveBannerState =
  | "idle"
  | "saving"
  | "offline"
  | "retrying"
  | "stalled"
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
 * Placement: render in the shell's dedicated status row, outside any
 * `inert={blocked}` root, so recovery stays reachable without covering content.
 */
export function SatSaveStatus(props: SatSaveStatusProps): React.JSX.Element | null {
  const { state } = props;
  // Dismissal is scoped to one failure: a different detail, a new failure after
  // recovery, or a state change re-opens the strip with its retry control.
  const noticeKey = `${state}:${props.saveFailure ?? ""}`;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state !== "failed" && state !== "superseded") setDismissedKey(null);
  }, [state]);
  if (state !== "failed" && state !== "superseded") return null;
  if (dismissedKey === noticeKey) return null;

  const isSuperseded = state === "superseded";
  return (
    <div
      className="sat-surface-enter mx-auto flex w-full max-w-[680px] items-center justify-between gap-4 border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-4 py-3 sat-type-control-secondary shadow-lg"
      role="alert"
      data-testid="sat-save-status"
      data-sat-save-state={state}
    >
      <span className="min-w-0 flex-1 text-[var(--sat-danger)]">
        {isSuperseded ? SAT_COPY.saveStatus.superseded : (props.saveFailure ?? SAT_COPY.saveStatus.failed)}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {isSuperseded ? (
          props.onTakeOver ? (
            <button
              type="button"
              onClick={props.onTakeOver}
              disabled={props.isTakingOver === true}
              className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-danger)] px-4 font-semibold text-[var(--sat-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-wait disabled:opacity-60"
            >
              {props.isTakingOver === true ? SAT_COPY.deviceTransfer.writerChecking : SAT_COPY.saveStatus.takeOver}
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
        <button
          type="button"
          onClick={() => setDismissedKey(noticeKey)}
          aria-label={SAT_COPY.notice.dismiss}
          className="sat-touch-target sat-pressable -my-1 -mr-2 grid shrink-0 place-items-center rounded-full text-[var(--sat-danger)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
