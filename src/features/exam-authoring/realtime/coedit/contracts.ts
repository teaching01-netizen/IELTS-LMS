// Domain-facing contracts for prompt co-editing.
//
// This package is the ONLY place that imports Yjs, Hocuspocus, or y-indexeddb.
// UI components consume the values below and never touch the CRDT directly.
import type { Doc } from "yjs";

/** Wire shape of POST /coedit-token. Mirrors authoringcoedit.CoeditTokenResponse. */
export interface CoeditTokenResponse {
  token: string;
  documentName: string;
  serviceUrl: string;
  expiresAt: number;
  schemaVersion: number;
  fieldSet: string;
  mode: "write" | "read";
  /** Server-derived caret identity. The service replaces these anyway. */
  actorId: string;
  displayName: string;
  capability: boolean;
}

/**
 * Save state is deliberately three-valued before "saved" and never lies:
 *
 *   local edit  -> unsaved   (visible locally, not yet durable)
 *   accepted    -> syncing   (accepted by Hocuspocus, not yet committed)
 *   committed   -> saved     (binary + prompt committed by Go/MySQL)
 *
 * A local or remote edit that advances the state vector returns the editor to
 * `unsaved`, so a stale acknowledgement can never mark newer work saved.
 */
export type CoeditSaveStateName = "idle" | "unsaved" | "syncing" | "saved" | "error";

export interface CoeditSaveState {
  name: CoeditSaveStateName;
  /** Hash of the local Y.Doc state vector at the last observation. */
  localStateHash: string | null;
  /** Hash the server acknowledged as committed (never assumed). */
  acknowledgedStateHash: string | null;
  /** Question revision carried by the last acknowledgement. */
  questionRevision: number | null;
  /** Human-readable, content-free status text for the footer. */
  message: string | null;
  /** True when the failure is transient and a retry is meaningful. */
  retryable: boolean;
}

export const INITIAL_SAVE_STATE: CoeditSaveState = {
  name: "idle",
  localStateHash: null,
  acknowledgedStateHash: null,
  questionRevision: null,
  message: null,
  retryable: false,
};

/** Server-derived collaborator identity (awareness is sanitized server-side). */
export interface CoeditCollaborator {
  clientId: number;
  actorId: string | null;
  name: string;
  color: string;
  isSelf: boolean;
  selectedQuestionId?: string;
}

export type CoeditConnectionPhase = "connecting" | "connected" | "disconnected";
export type CoeditLifecyclePhase = "active" | "freezing" | "frozen";

/** Private, stateless service-to-room message used while publishing. */
export interface CoeditLifecycleMessage {
  type: "coedit.lifecycle";
  documentName: string;
  phase: "freezing" | "active";
  reason: "publish";
}

/** Private persistence failure sent only to clients in the active room. */
export interface CoeditSaveFailureMessage {
  type: "coedit.save_failed";
  documentName: string;
  retryable: boolean;
  /**
   * Machine-readable domain reason (`coedit_previous_hash_mismatch`, …) when
   * the service knows it. Optional for wire compatibility with older builds.
   */
  reason: string | null;
  /**
   * True when the row's committed state moved past this room's commit, so a
   * verbatim retry can never succeed — the room must resync first.
   * `retryable` is false whenever this is true.
   */
  requiresResync: boolean;
}

/** Invalid or unrelated stateless payloads are deliberately ignored. */
export function parseCoeditLifecycleMessage(raw: unknown): CoeditLifecycleMessage | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    value["type"] !== "coedit.lifecycle" ||
    typeof value["documentName"] !== "string" ||
    value["documentName"].trim() === "" ||
    (value["phase"] !== "freezing" && value["phase"] !== "active") ||
    value["reason"] !== "publish"
  ) {
    return null;
  }
  return {
    type: "coedit.lifecycle",
    documentName: value["documentName"],
    phase: value["phase"],
    reason: "publish",
  };
}

/** Invalid or unrelated persistence messages are deliberately ignored. */
export function parseCoeditSaveFailureMessage(raw: unknown): CoeditSaveFailureMessage | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    value["type"] !== "coedit.save_failed" ||
    typeof value["documentName"] !== "string" ||
    value["documentName"].trim() === "" ||
    typeof value["retryable"] !== "boolean"
  ) {
    return null;
  }
  return {
    type: "coedit.save_failed",
    documentName: value["documentName"],
    retryable: value["retryable"],
    reason: typeof value["reason"] === "string" && value["reason"].trim() !== "" ? value["reason"] : null,
    requiresResync: value["requiresResync"] === true,
  };
}

export type CoeditLifecycleIssue =
  | "none"
  | "closed"
  | "replaced"
  | "frozen"
  | "offline"
  | "service_unavailable"
  | "token_expired"
  | "oversized"
  | "rejected";

/**
 * Wire prefix the service puts on the close reason when Go deliberately closes
 * a room. A close carrying it is a lifecycle decision; every other close is a
 * transport event and must stay on the reconnecting/offline path.
 */
export const COEDIT_LIFECYCLE_CLOSE_PREFIX = "coedit:";

/** A lifecycle close, already resolved into the UI vocabulary. */
export interface CoeditLifecycleClose {
  issue: Extract<CoeditLifecycleIssue, "closed" | "replaced">;
  message: string;
  /** A successful publish is frozen/read-only, not draft replacement recovery. */
  published?: boolean;
}

/** Recovery shown when a replaced draft ends the room. */
export const COEDIT_REPLACED_LIFECYCLE: CoeditLifecycleClose = {
  issue: "replaced",
  message: "This draft was replaced. Copy your prompt before opening the new draft.",
};

/** Recovery shown when any other lifecycle reason ends the room. */
export const COEDIT_CLOSED_LIFECYCLE: CoeditLifecycleClose = {
  issue: "closed",
  message: "This prompt's collaboration session was closed. Copy your prompt if you still need it.",
};

/**
 * Resolves a provider close reason into the recovery the design requires.
 *
 * A replaced draft is the one case that mixes durable work into a reused exam
 * question, so it offers the prompt for copy/export; every other lifecycle
 * close offers the same export without promising a replacement is coming.
 */
export function coeditLifecycleFromCloseReason(
  reason: string | null | undefined,
): CoeditLifecycleClose | null {
  if (typeof reason !== "string") return null;
  const normalized = reason.trim().toLowerCase();
  if (!normalized.startsWith(COEDIT_LIFECYCLE_CLOSE_PREFIX)) return null;
  switch (normalized.slice(COEDIT_LIFECYCLE_CLOSE_PREFIX.length)) {
    case "draft_replaced":
    case "workbook_replaced":
      return COEDIT_REPLACED_LIFECYCLE;
    case "question_deleted":
    case "feature_disabled":
    case "other":
      return COEDIT_CLOSED_LIFECYCLE;
    case "exam_published":
      return { ...COEDIT_CLOSED_LIFECYCLE, published: true };
    default:
      return null;
  }
}

/** Recovery affordances offered when the room cannot continue. */
export interface CoeditRecovery {
  issue: CoeditLifecycleIssue;
  message: string | null;
  published?: boolean;
  /** Prompt JSON captured for copy/export before a replacement is opened. */
  canExport: boolean;
  exportPrompt: () => unknown | null;
  /** Deletes local IndexedDB state after an explicit user discard. */
  discardLocal: () => Promise<void>;
  /** Refetches the HTTP revision and re-mints a token. */
  reload: () => void;
}

/** Deterministic caret color from a server-derived actor id. */
export function colorForActor(actorId: string): string {
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) {
    hash = (hash * 31 + actorId.charCodeAt(index)) >>> 0;
  }
  const palette = [
    "#2563EB",
    "#7C3AED",
    "#DB2777",
    "#0891B2",
    "#4F46E5",
    "#C026D3",
    "#0369A1",
    "#9333EA",
  ];
  return palette[hash % palette.length] as string;
}

/** The local author's server-derived caret identity. */
export interface CoeditSelfIdentity {
  actorId: string;
  displayName: string;
  color: string;
}

/** The single value UI components consume. */
export interface PromptCoeditingSession {
  /** Y.Doc holding the `prompt` fragment. */
  ydoc: Doc;
  /** Server-derived local identity (never trusted from the browser). */
  self: CoeditSelfIdentity;
  /** Field name inside the Y.Doc (`prompt`). */
  field: string;
  /** True once the provider completed initial sync (editor may mount). */
  ready: boolean;
  /** Live transport state. */
  connected: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  /** Read-only (observer or frozen room). */
  readOnly: boolean;
  saveState: CoeditSaveState;
  collaborators: CoeditCollaborator[];
  recovery: CoeditRecovery;
  /** Tear down provider, IndexedDB attachment, and observers. */
  destroy: () => void;
}

/** Feature posture for the client. */
export interface CoeditClientCapability {
  /** Server-granted capability (both Go co-edit gates on). */
  server: boolean;
  /** Compatibility field; the application supplies the always-on posture. */
  frontendEnabled: boolean;
  /** Selected question is in the current editable draft. */
  activeEditableDraft: boolean;
  /** The signed-in role may write. */
  writeCapableRole: boolean;
}

/**
 * Effective enablement is owned by the co-edit transport. The legacy authoring
 * event socket is intentionally not a prerequisite: it delivers structural
 * notifications, while Hocuspocus/Yjs delivers prompt changes. The frontend
 * and server rollout fields are compatibility inputs; the application enables
 * them by default.
 */
export function resolveCoeditEnabled(capability: CoeditClientCapability): boolean {
  return (
    capability.server &&
    capability.frontendEnabled &&
    capability.activeEditableDraft &&
    capability.writeCapableRole
  );
}
