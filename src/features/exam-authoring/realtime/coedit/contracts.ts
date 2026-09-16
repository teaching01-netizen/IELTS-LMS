// Domain-facing contracts for prompt co-editing.
//
// This package is the ONLY place that imports Yjs, Hocuspocus, or y-indexeddb.
// UI components consume the values below and never touch the CRDT directly.
import type { Doc } from "yjs";
import { isCoeditLifecycleOperation } from "./protocol";
import type { CoeditDecimalString, CoeditLifecycleOperation } from "./protocol";

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
  /** Additive rollout field; absent means a legacy epoch-zero server. */
  stateEpoch?: CoeditDecimalString;
  /** Additive rollout field for ordered durable acknowledgements. */
  commitSequence?: CoeditDecimalString;
  /** Workspace projection revision; never reinterpret as a prompt revision. */
  workspaceRevision?: number;
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
  /** Base64 state vector of the local Y.Doc at the last observation. */
  localStateVector: string | null;
  /** Base64 state vector the server acknowledged as committed (never assumed). */
  acknowledgedStateVector: string | null;
  /** Question revision carried by the last acknowledgement. */
  questionRevision: number | null;
  /** Human-readable, content-free status text for the footer. */
  message: string | null;
  /** True when the failure is transient and a retry is meaningful. */
  retryable: boolean;
}

export const INITIAL_SAVE_STATE: CoeditSaveState = {
  name: "idle",
  localStateVector: null,
  acknowledgedStateVector: null,
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
export interface CoeditLifecycleMessage extends Partial<CoeditLifecycleOperation> {
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
  const hasOperationMetadata =
    value["freezeOperationId"] !== undefined || value["freezeExpiresAt"] !== undefined;
  if (
    hasOperationMetadata &&
    !isCoeditLifecycleOperation({
      freezeOperationId: value["freezeOperationId"],
      freezeExpiresAt: value["freezeExpiresAt"],
    })
  ) {
    return null;
  }
  return {
    type: "coedit.lifecycle",
    documentName: value["documentName"],
    phase: value["phase"],
    reason: "publish",
    ...(hasOperationMetadata
      ? {
          freezeOperationId: value["freezeOperationId"] as string,
          freezeExpiresAt: value["freezeExpiresAt"] as number,
        }
      : {}),
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

/**
 * Failure reasons the service sends in a `coedit.save_failed` frame. Each one
 * is mirrored on the service side (`COEDIT_WRITE_REFUSED_REASON` in
 * services/authoring-coedit/src/main.ts, `COEDIT_OVERSIZED_REASON` in
 * documentCodec.ts) and, for the size refusal, in Go
 * (authoringcoedit.CodeOversized). A reason outside this vocabulary is
 * deliberately treated as a generic failure rather than guessed at.
 */
export const COEDIT_WRITE_REFUSED_REASON = "coedit_write_refused";
export const COEDIT_OVERSIZED_REASON = "coedit_oversized";

/**
 * Resolves a persistence refusal into the recovery the author is shown.
 *
 * Three refusals are terminal for the work held by this editor and must offer
 * the export affordances rather than a retry that cannot succeed:
 *
 *   - a stale-hash resync (the row's committed state moved past this room)
 *   - a write the room refused outright (`coedit_write_refused`, which the
 *     transport reports to the browser only as an ignored SyncStatus frame)
 *   - a room over its size limit (`coedit_oversized`), which is not refused but
 *     cannot be persisted as it stands
 *
 * Every other reason stays a transient failure: `null` means "no special
 * recovery", not "nothing happened".
 */
export function coeditRecoveryFromSaveFailure(failure: CoeditSaveFailureMessage): {
  issue: Extract<CoeditLifecycleIssue, "rejected" | "oversized">;
  message: string;
} | null {
  if (failure.requiresResync) {
    return {
      issue: "rejected",
      message:
        "This prompt was changed elsewhere and cannot be saved from this editor. Reload the prompt to continue.",
    };
  }
  if (failure.reason === COEDIT_WRITE_REFUSED_REASON) {
    return {
      issue: "rejected",
      message:
        "The collaboration service refused your latest changes, so they are not saved. Copy them out before leaving.",
    };
  }
  if (failure.reason === COEDIT_OVERSIZED_REASON) {
    return {
      issue: "oversized",
      message:
        "This prompt is too large to save as one collaborative document. Remove some content, or copy your changes out before leaving.",
    };
  }
  return null;
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
  | "rejected"
  /**
   * A local copy written before a durable compaction still holds content the
   * room does not have. It is preserved, never merged, and never discarded
   * without the author seeing it first.
   */
  | "stale_cache";

/**
 * One preserved older-epoch local copy, byte-exact.
 *
 * The payload is the Yjs update rather than a rendered projection: the promise
 * is that the author can get their local work out of the browser unharmed, and
 * only the bytes keep that promise for rich text with marks and embedded media.
 */
export interface CoeditStaleCacheExport {
  /** Logical room name (opaque; never a domain id). */
  room: string;
  /** Epoch of the preserved copy. */
  stateEpoch: CoeditDecimalString;
  /** Base64 Yjs update holding everything the copy held. */
  update: string;
  /** Base64 state vector of that copy. */
  stateVector: string;
}

/**
 * Why a flush-and-wait ended. Navigation must never treat anything but `saved`
 * as durable, so the outcome is a closed vocabulary rather than a boolean.
 */
export type CoeditFlushOutcome =
  /** The exact state vector this tab holds is committed. */
  | "saved"
  /** Connected, flushed, still not acknowledged when the deadline expired. */
  | "pending"
  /** No transport: the work cannot reach the service right now. */
  | "offline"
  /** The room refused the work (a fence, or an oversized document). */
  | "refused"
  /** A read-only session (observer or frozen room) cannot flush anything. */
  | "read_only"
  /** A preserved pre-compaction copy has not been reconciled. */
  | "stale_cache"
  /** The room ended (closed or replaced). */
  | "ended";

export interface CoeditFlushResult {
  outcome: CoeditFlushOutcome;
  /** True only for `saved`; the single fact a navigation gate may trust. */
  saved: boolean;
  /** The local state vector the result was judged against. */
  stateVector: string | null;
}

/** Recovery body for a preserved pre-compaction local copy. */
export const COEDIT_STALE_CACHE_MESSAGE =
  "An earlier local copy of this room is still on this device and has content the room does not. Copy it out before discarding it.";

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
 * Resolves a provider close reason into the recovery the design requires
 * ("Offline and recovery behavior", docs/sat-authoring-coedit.md).
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
  /**
   * True while a preserved pre-compaction copy exists. The copy is exportable
   * first and discardable only on an explicit user action, so no local work is
   * ever removed by the client on its own.
   */
  canExportStaleCache: boolean;
  /** Byte-exact copies of every preserved older-epoch cache. */
  exportStaleCache: () => CoeditStaleCacheExport[] | null;
  /** Deletes the preserved copies (explicit discard only). */
  discardStaleCache: () => Promise<void>;
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
  /**
   * True once the provider completed initial sync AND replayed its local copy
   * (the editor may mount).
   */
  ready: boolean;
  /** Live transport state. */
  connected: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
  /**
   * Flushes the transport and resolves once THIS tab's state vector is durable.
   * Navigation must await it rather than assume `destroy()` persisted anything.
   */
  flushAndWaitForSaved: (timeoutMs: number) => Promise<CoeditFlushResult>;
  /** Read-only (observer or frozen room). */
  readOnly: boolean;
  /**
   * True when this session's token grants write, even if the room has since
   * frozen. A caller deciding whether unsynced local content must be protected
   * (or exported) before leaving reads this: an observer has nothing to lose.
   */
  writeCapable: boolean;
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

export type {
  CoeditDecimalString,
  CoeditDurabilityMetadata,
  CoeditLifecycleOperation,
  CoeditPhase1Reason,
} from "./protocol";
export {
  COEDIT_EPOCH_MISMATCH_REASON,
  COEDIT_FINAL_STORE_REQUIRED_REASON,
  COEDIT_FREEZE_CONFLICT_REASON,
  COEDIT_PHASE1_REASONS,
  COEDIT_SEED_CONFLICT_REASON,
  COEDIT_STALE_CACHE_REASON,
  isCoeditDecimalString,
  isCoeditLifecycleOperation,
  isCoeditPhase1Reason,
  parseCoeditDurabilityMetadata,
} from "./protocol";
