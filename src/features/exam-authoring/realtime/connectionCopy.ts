import type { AuthoringConnectionState } from "./contracts";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";

/**
 * The ONLY source of connection + divergence status copy. Rendered exclusively
 * in the save area (SaveCluster header/footer and the SpineHeader connection
 * slot) — never duplicated into banners, toasts, rail rows, or popovers.
 *
 * Raw transport internals must never reach a user-visible string: no close
 * codes, no cursor vocabulary, no sequence-gap language. Those belong in logs.
 */
export const CONNECTION_COPY = {
  saved: "Saved",
  reconnecting: "Reconnecting",
  offline: "Offline - saved on this device",
  /** Diverged: dirty + a newer remote revision. Paired with the Review action. */
  newerVersionAvailable: "Newer version available",
} as const;

export type CoeditSaveDisplayStatus =
  | QuestionSaveStatus
  | "reconnecting"
  | "still_saving"
  | "view_only"
  | "finishing";

export const COEDIT_SAVE_COPY = {
  saved: "Saved",
  saving: "Saving…",
  still_saving: "Still saving…",
  offline: "Offline · Changes kept on this device",
  reconnecting: "Reconnecting…",
  error: "Couldn’t save · Retry",
  view_only: "View only",
  finishing: "Finishing changes…",
  conflict: "Changed elsewhere — Review",
} as const;

export type ConnectionCopyKey = keyof typeof CONNECTION_COPY;

/**
 * Copy for the socket half of the save area. `disabled` renders nothing: with
 * the feature off there is no connection story to tell, and the workspace must
 * look exactly like it did before.
 */
export function connectionCopyFor(state: AuthoringConnectionState): string | null {
  switch (state) {
    case "reconnecting":
    case "connecting":
      return CONNECTION_COPY.reconnecting;
    case "degraded-http":
      // HTTP editing is fully available; saying "reconnecting" forever would be
      // noise, and saying "offline" would be untrue. The autosave surface owns
      // the truth here, so the socket adds nothing.
      return null;
    case "disabled":
    case "live":
    case "stale-draft":
    case "forbidden":
    default:
      return null;
  }
}

/**
 * Copy for the autosave half. `conflict` deliberately does NOT claim the
 * revision is newer — a 409 means the write was fenced, which is a different
 * (and already-explained) condition.
 */
export function saveStatusCopy(args: {
  status: QuestionSaveStatus | CoeditSaveDisplayStatus;
  diverged: boolean;
  mode?: "legacy" | "coedit";
}): string {
  if (args.mode === "coedit") {
    if (args.diverged) return CONNECTION_COPY.newerVersionAvailable;
    return COEDIT_SAVE_COPY[args.status as keyof typeof COEDIT_SAVE_COPY] ?? COEDIT_SAVE_COPY.saved;
  }
  if (args.diverged) {
    return CONNECTION_COPY.newerVersionAvailable;
  }
  switch (args.status) {
    case "offline":
      return CONNECTION_COPY.offline;
    case "saved":
      return CONNECTION_COPY.saved;
    case "unsaved":
      return "Editing";
    case "saving":
      return "Saving…";
    case "error":
      return "Not saved — Retry";
    case "conflict":
      return "Changed elsewhere — Review";
    default:
      return CONNECTION_COPY.saved;
  }
}

/**
 * The "this save could not be applied" family. Reachable with the socket ON (an
 * event delivered the newer revision first) and OFF (HTTP fenced the write), so
 * every string here must be true and actionable with no realtime context at
 * all — and it is the same condition either way, so it must read the same way.
 *
 * "Reload the latest version, then reapply your changes" is deliberately absent.
 * That instruction predates the Review surface: it asked an author to retype
 * work the app is already holding, and it read as a failure of a save that was
 * actually fenced for the author's protection.
 */
export const SAVE_CONFLICT_COPY = {
  /** A known-newer revision while the editor is dirty. Not a failure. */
  diverged:
    "A newer version of this question was saved elsewhere. Your changes are safe — review them when ready.",
  /** The write itself was fenced: the same condition, learned over HTTP. */
  fenced: "Another author saved this question first, so this save was not applied.",
  /** Mandatory contract sentence, paired with `fenced`. */
  keptOnDevice: "Your edits are kept on this device — review the newer version.",
  /** Navigation-blocking variant: the same facts plus why we stopped. */
  fencedBeforeLeaving:
    "Another author saved this question first. Your edits are kept on this device — review the newer version, or copy your changes, before leaving.",
  /** A device-local draft was restored after a reload. NOT a remote conflict. */
  recovered:
    "Recovered unsaved changes from this device. They are not saved on the server yet.",
  recoveredHint: "Save or review them before leaving this question.",
  offline:
    "Offline. Changes are stored on this device and will retry when you reconnect.",
  failed:
    "Save failed. The current question remains open; navigation was stopped so no work is lost.",
} as const;

/** Tooltip and banner body for a fenced or diverged save. */
export function saveBlockedCopy(diverged: boolean): string {
  return diverged
    ? SAVE_CONFLICT_COPY.diverged
    : `${SAVE_CONFLICT_COPY.fenced} ${SAVE_CONFLICT_COPY.keptOnDevice}`;
}

/**
 * Guard for the "no raw transport internals" rule. Tests assert this over every
 * exported string so a future copy change cannot leak a close code.
 */
export const FORBIDDEN_COPY_FRAGMENTS: readonly string[] = [
  "1006",
  "1001",
  "close code",
  "cursor_too_old",
  "cursor too old",
  "sequence gap",
  "sequenceId",
  "replay_too_large",
  "delivery_gap",
  "unsupported_event",
  "snapshot_required",
];

export function copyLeaksTransportDetail(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_COPY_FRAGMENTS.some((fragment) => lower.includes(fragment.toLowerCase()));
}
