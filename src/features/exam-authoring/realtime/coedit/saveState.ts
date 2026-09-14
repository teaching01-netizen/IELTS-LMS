import { createHash } from "./stateHash";
import type { CoeditSaveState, CoeditSaveStateName } from "./contracts";
import { INITIAL_SAVE_STATE } from "./contracts";

/**
 * Hash of a Yjs state vector, hex encoded.
 *
 * SHA-256 is available in browsers and in Node; the hash only identifies the
 * exact state a client is asking to be acknowledged, so a weaker digest would
 * still be sufficient — we use SHA-256 to keep the identity check simple.
 */
export function stateVectorHash(encodedStateVector: Uint8Array): string {
  return createHash(encodedStateVector);
}

export interface SaveStateInputs {
  /** Hash of the CURRENT local state vector, or null before first sync. */
  localStateHash: string | null;
  /** Hash last acknowledged as committed by Go/MySQL. */
  acknowledgedStateHash: string | null;
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
 * state hash. If another local or remote edit advanced the state vector before
 * the acknowledgement arrived, the editor stays `unsaved` — this is what
 * prevents a stale ack from claiming newer work is durable.
 */
export function deriveSaveState(inputs: SaveStateInputs): CoeditSaveState {
  const {
    localStateHash,
    acknowledgedStateHash,
    questionRevision,
    connected,
    inFlight,
    error,
    lifecycle,
  } = inputs;

  const base: CoeditSaveState = {
    ...INITIAL_SAVE_STATE,
    localStateHash,
    acknowledgedStateHash,
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
  if (localStateHash === null) {
    return { ...base, name: "syncing", message: "Syncing the prompt." };
  }
  if (localStateHash === acknowledgedStateHash) {
    return { ...base, name: "saved", message: null };
  }
  if (inFlight) {
    return { ...base, name: "syncing", message: "Saving the prompt." };
  }
  return { ...base, name: "unsaved", message: null };
}
