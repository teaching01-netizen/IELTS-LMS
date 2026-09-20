import type {
  CoeditConnectionPhase,
  CoeditLifecyclePhase,
  CoeditSaveState,
} from "../../realtime/coedit";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import type { CoeditSaveDisplayStatus } from "../../realtime/connectionCopy";

export type { CoeditSaveDisplayStatus } from "../../realtime/connectionCopy";

/**
 * One save truth for a question that has two writers.
 *
 * While prompt co-editing is active the prompt's durability is owned by the
 * collaborative acknowledgement, and everything else is owned by the legacy
 * autosave counter. Each knows only half of the state, so the displayed status
 * is always the LEAST advanced of the two: a prompt acknowledgement can never
 * mark a pending field patch saved, and a field save can never mark an
 * unacknowledged prompt saved. This is the UI half of the design rule "a client
 * may show Saved only after receiving an acknowledgement for its exact current
 * state VECTOR" — see "Save truth: the state vector" in
 * docs/sat-authoring-coedit.md. (The rule used to be written with "hash"; the
 * identity has been the vector itself since the two SHA-256 implementations
 * disagreed at some lengths and left rooms permanently unsaved.)
 */

/**
 * Maps the collaborative save state onto the workspace's existing vocabulary.
 * `syncing` is the same condition the autosave counter calls `saving`, and
 * `idle` means "we have not synced yet" — never `saved`.
 */
export function coeditSaveStatusFor(name: CoeditSaveState["name"]): QuestionSaveStatus {
  switch (name) {
    case "saved":
      return "saved";
    case "syncing":
      return "saving";
    case "error":
      return "error";
    case "unsaved":
    case "idle":
    default:
      return "unsaved";
  }
}

/**
 * Human projection for the co-edit header. The provider's acknowledgement and
 * the legacy field autosave are intentionally combined here so the renderer
 * never infers Saved from an open socket or a locally emitted Yjs update.
 */
export function coeditDisplayStatusFor(input: {
  saveState: CoeditSaveState | null;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  readOnly: boolean;
  pendingSince: number | null;
  autosaveStatus?: QuestionSaveStatus;
  /**
   * The open question still has rich roots initializing or failed.
   *
   * Room durability and editor readiness are two different facts. A room can
   * have committed everything it holds while a field the author is looking at
   * never initialized — an editor that has been pulsing for minutes beside a
   * header that says Saved is the exact contradiction this caps. A saved claim
   * must not imply an editor the author can use.
   */
  questionPending?: boolean;
  now?: number;
}): CoeditSaveDisplayStatus {
  const now = input.now ?? Date.now();
  const pendingFor = input.pendingSince === null ? 0 : Math.max(0, now - input.pendingSince);
  const stillSaving = input.pendingSince !== null && pendingFor >= 3_000;
  const coeditName = input.saveState?.name ?? "idle";
  const autosave = input.autosaveStatus;

  if (input.lifecyclePhase === "freezing") return "finishing";
  if (input.lifecyclePhase === "frozen" || input.readOnly) return "view_only";
  if (coeditName === "error" || autosave === "error") return "error";
  if (autosave === "conflict") return "conflict";
  if (input.connectionPhase === "disconnected") return "offline";
  if (input.connectionPhase === "connecting" && input.hasEstablishedConnection) {
    return "reconnecting";
  }
  if (autosave === "offline") return "offline";
  if (input.pendingSince !== null || coeditName === "unsaved" || coeditName === "syncing") {
    return stillSaving ? "still_saving" : "saving";
  }
  if (autosave === "saving" || autosave === "unsaved") return "saving";
  // Initial co-edit setup has no durable acknowledgement yet. Keeping this at
  // Saving avoids a false Saved flash while the room is establishing itself.
  if (coeditName === "idle" || input.saveState === null) return "saving";
  // The room is durable, but the question is not ready to work in. Saving is
  // the honest status: there is nothing left for the author to do but wait, and
  // a Saved claim here would be about a different question than the one on
  // screen.
  if (input.questionPending) return stillSaving ? "still_saving" : "saving";
  return "saved";
}

/** Severity order, least advanced first. */
const SAVE_STATUS_SEVERITY: Record<QuestionSaveStatus, number> = {
  saved: 0,
  saving: 1,
  unsaved: 2,
  offline: 3,
  conflict: 4,
  error: 5,
};

/** The least advanced of the two, or the autosave status when co-editing is off. */
export function combineSaveStatus(
  autosave: QuestionSaveStatus,
  coedit: QuestionSaveStatus | null
): QuestionSaveStatus {
  if (coedit === null) return autosave;
  return SAVE_STATUS_SEVERITY[coedit] > SAVE_STATUS_SEVERITY[autosave] ? coedit : autosave;
}
