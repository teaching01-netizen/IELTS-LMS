import type { CoeditSaveState, CoeditSaveStateName } from "./contracts";
import { INITIAL_SAVE_STATE } from "./contracts";

export interface SaveStateInputs {
  /** Base64 state vector of the CURRENT local document, or null before sync. */
  localStateVector: string | null;
  /** Base64 state vector last acknowledged as committed by Go/MySQL. */
  acknowledgedStateVector: string | null;
  /** Question revision carried by that acknowledgement. */
  questionRevision: number | null;
  /** Provider reached the server at least once. */
  connected: boolean;
  /** A store attempt is in flight. */
  inFlight: boolean;
  /** Last transport/store failure, if any. */
  error: { message: string; retryable: boolean } | null;
  /** A destructive lifecycle issue outranks everything else. */
  lifecycle: CoeditSaveStateName | null;
}

/**
 * Derives the displayed save state.
 *
 * The critical rule: `saved` requires an acknowledgement for the EXACT current
 * state vector. If another local or remote edit advanced the state vector
 * before the acknowledgement arrived, the editor stays `unsaved` — this is what
 * prevents a stale ack from claiming newer work is durable.
 *
 * The identity is the state vector itself, not a digest of it: a second hashing
 * implementation that can disagree with the service's is a correctness risk
 * with no upside, because equal vectors already mean equal content.
 */
export function deriveSaveState(inputs: SaveStateInputs): CoeditSaveState {
  const {
    localStateVector,
    acknowledgedStateVector,
    questionRevision,
    connected,
    inFlight,
    error,
    lifecycle,
  } = inputs;

  const base: CoeditSaveState = {
    ...INITIAL_SAVE_STATE,
    localStateVector,
    acknowledgedStateVector,
    questionRevision,
  };

  if (lifecycle) {
    return { ...base, name: lifecycle };
  }
  if (error) {
    return { ...base, name: "error", message: error.message, retryable: error.retryable };
  }
  if (!connected) {
    return { ...base, name: "unsaved", message: "Reconnecting to the collaboration service." };
  }
  if (localStateVector === null) {
    return { ...base, name: "syncing", message: "Syncing the prompt." };
  }
  if (localStateVector === acknowledgedStateVector) {
    return { ...base, name: "saved", message: null };
  }
  if (inFlight) {
    return { ...base, name: "syncing", message: "Saving the prompt." };
  }
  return { ...base, name: "unsaved", message: null };
}
