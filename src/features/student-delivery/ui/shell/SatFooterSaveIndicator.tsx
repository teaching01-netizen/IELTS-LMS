import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import type { SatSaveBannerState } from "../feedback/SatSaveStatus";

export interface SatFooterSaveIndicatorProps {
  state: SatSaveBannerState;
  onRetrySave?: (() => void) | undefined;
}

/**
 * Persistent footer save indicator (Phase 6f): status lives next to the
 * hand, not in transient overlays. One quiet token — Saved / Saving /
 * Offline-kept / Save-failed — mirroring the SatSaveStatus banner object so
 * the two can never contradict: same `state`, short noun here, sentence in
 * the banner. Failed states ship the recovery action inline (Retry); the
 * indicator itself never steals focus on state change (no live region — the
 * banner owns announcements).
 */
export function SatFooterSaveIndicator(props: SatFooterSaveIndicatorProps) {
  const { state } = props;
  if (state === "superseded") return null;
  const label =
    state === "idle"
      ? SAT_COPY.saveStatus.saved
      : state === "saving"
        ? SAT_COPY.saveStatus.savingShort
        : state === "offline" || state === "retrying"
          ? SAT_COPY.saveStatus.offlineShort
          : SAT_COPY.saveStatus.failedShort;
  const failed = state === "failed";
  const offline = state === "offline" || state === "retrying";
  return (
    <span
      data-testid="sat-footer-save-indicator"
      data-sat-save-state={state}
      className={
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold " +
        (failed
          ? "text-[var(--sat-danger)]"
          : offline
            ? "text-[var(--sat-warning)]"
            : "text-[var(--sat-text-secondary)]")
      }
    >
      {state === "idle" ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : state === "saving" ? (
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : offline ? (
        <CloudOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
      )}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{"Save status: " + label}</span>
      {/* No Retry here by design: the banner (same truth) already ships the
          recovery action with its sentence. Two competing Retrys for one
          failure split attention and double the tab stops next to the hand. */}
    </span>
  );
}
