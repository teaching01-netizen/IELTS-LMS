// Frozen domain contract for SAT authoring realtime (Phase 01, revised).
// Backward-compat rule: additive fields only. Renames/removals require a
// version bump (version: 2) and a new parse path; v1 readers refetch.
//
// Boundary rule: the DOMAIN event carries no transport cursor. The bus
// sequence (live_update_events.sequence_id) travels in the TRANSPORT frame
// (AuthoringEventFrame.cursor) and is added at frame-construction time.

import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
} from '../contracts/assessment';

export const AUTHORING_EVENT_VERSION = 1 as const;
export type AuthoringEventVersion = typeof AUTHORING_EVENT_VERSION;

/** Exact kind vocabulary. Never extend without a version-compat review. */
export const AUTHORING_EVENT_KINDS = [
  'question.changed',
  'question.created',
  'question.deleted',
  'question.moved',
  'question.duplicated',
  'question.bulk_changed',
  'exam.changed',
  'draft.opened',
  'draft.replaced',
  'exam.published',
] as const;
export type AuthoringEventKind = (typeof AUTHORING_EVENT_KINDS)[number];

export type AuthoringEntityKind = 'question' | 'module' | 'exam' | 'draft';

export interface QuestionEntityRef {
  kind: 'question';
  /** exam_questions row id (the authoring identity; stable across revisions). */
  examQuestionId: string;
  /** Canonical question id (nullable for deleted tombstones; null serializes as JSON null). */
  questionId: string | null;
  /** Owning module at event time (hint only; refetch is authoritative; null serializes as JSON null). */
  moduleId: string | null;
}
export interface ModuleEntityRef {
  kind: 'module';
  moduleId: string;
}
export interface ExamEntityRef {
  kind: 'exam';
  examId: string;
}
export interface DraftEntityRef {
  kind: 'draft';
  examId: string;
  draftVersionId: string;
}
export type AuthoringEntityRef =
  | QuestionEntityRef
  | ModuleEntityRef
  | ExamEntityRef
  | DraftEntityRef;

export interface AuthoringEventScope {
  /**
   * Tenant scope. null = platform scope (exam_entities.organization_id IS
   * NULL). Empty string is never used to mean platform scope: it would be
   * indistinguishable from a missing field or a failed query.
   */
  organizationId: string | null;
  examId: string;
  /** Shell.versionId of the draft that produced the event. */
  draftVersionId: string;
}

/**
 * Security invariant (enforced Phase 03): a correctly authorized server never
 * delivers an event from another organization or exam. The SUBSCRIPTION scope
 * is organization + exam only — NOT draft. A draft is replaceable state, so a
 * subscriber bound to Draft 7 must still receive a draft.replaced event whose
 * scope carries Draft 8 (that event is exactly how it learns its draft is
 * obsolete).
 *
 * So a mismatched ORG/EXAM is a security fault: drop it, close the subscription,
 * record telemetry, and require a clean resubscribe (which re-derives scope from
 * session + DB). A mismatched DRAFT is normal collaboration: compare
 * scope.draftVersionId against your own draft to choose content reconciliation
 * (same draft) vs lifecycle recovery (different draft) — never treat it as a
 * security fault.
 */
export const AUTHORING_SCOPE_MISMATCH_POLICY = 'drop-close-telemetry-resubscribe' as const;

export interface AuthoringEventActor {
  /** Server-resolved staff user id. Never accepted from the client. */
  id: string;
  kind: 'staff';
}

/**
 * changedFields vocabulary (names only, never values). Readers must ignore
 * unknown names. Values such as prompt/answer/rationale TEXT are forbidden.
 */
export const AUTHORING_CHANGED_FIELDS = [
  'prompt',
  'stimulus',
  'answer',
  'rationale',
  'metadata.domain',
  'metadata.skill',
  'metadata.difficulty',
  'metadata.tags',
  'accessibility',
  'displayOrder',
  'moduleId',
  'isPretest',
  'questionType',
  'readiness',
  'deliverySettings',
  'draftRevision',
] as const;
export type AuthoringChangedField = (typeof AUTHORING_CHANGED_FIELDS)[number] | (string & {});

export interface AuthoringEventV1 {
  version: AuthoringEventVersion;
  kind: AuthoringEventKind;
  /** Client-opaque UUID (uuid v4, server-minted). Dedupe key with the frame cursor. */
  eventId: string;
  /** ISO-8601 timestamp of commit (server clock). */
  occurredAt: string;
  actor: AuthoringEventActor;
  scope: AuthoringEventScope;
  entity: AuthoringEntityRef;
  /**
   * Fencing revision of the affected ENTITY after the mutation (e.g. the
   * question revision after a save). 0 when not applicable (draft/exam
   * scoped events). A hint, not a fence.
   */
  revision: number;
  /**
   * Working-draft GENERATION after the in-tx bump (exam_versions.revision).
   * A state hint, never an ordering key: Undo restores an older checkpoint
   * and can move this value BACKWARDS, so events are ordered by the frame
   * cursor (sequence_id) alone. Never infer loss or ordering from it.
   */
  draftRevision: number;
  changedFields: string[];
  /**
   * Affected exam-question ids for coarse events (question.moved,
   * question.bulk_changed). Bounded (<= 200). Omitted for single-entity
   * events. Ids only — never content.
   */
  affectedExamQuestionIds?: string[];
  /** Idempotency correlation (operationKey echo). Omitted when none. */
  causationId?: string;
}

/**
 * TRANSPORT frame: what arrives over the socket. The cursor is the opaque,
 * monotonically increasing live_update_events.sequence_id, added when the
 * server constructs the frame — never persisted inside the domain payload.
 * Clients accept any cursor > lastProcessedCursor; 381 -> 384 is valid
 * (skipped values belong to other exams, kinds, or origins). Loss is
 * signaled explicitly (snapshot_required, cursor expiry, queue overflow,
 * reconnect replay failure), never inferred from arithmetic.
 *
 * Bus mapping (server side): event_kind = 'authoring', event_target_id =
 * EXAM id, event_revision = draftRevision, event_name = kind. Routing is
 * exam-scoped because a draft is replaceable state: Undo swaps the working
 * draft while collaborators stay subscribed, and a draft-scoped stream
 * would deliver nothing exactly when the replacement must be announced.
 * Compare event.scope.draftVersionId against your own draft to choose
 * content reconciliation vs lifecycle recovery.
 *
 * Two revision concepts stay separate: `revision` fences an entity,
 * `draftRevision` describes the working copy's generation. Neither orders
 * events — only `cursor` does.
 */
export interface AuthoringEventFrame {
  type: 'authoring.event';
  v: 1;
  /** Opaque transport cursor from live_update_events.sequence_id. */
  cursor: number;
  event: AuthoringEventV1;
}

/**
 * Frozen Phase 03 wire vocabulary. Every frame carries `v: 1`; receivers
 * IGNORE unknown optional fields and REJECT unknown `type`. The transport
 * scope is organization + exam: a `draftVersionId` mismatch is normal
 * collaboration (compare it to choose reconcile-vs-lifecycle), NOT a fault.
 *
 * Freeze reference: Phase 03 backend `protocol.go` (handlers_authoring_realtime)
 * + `authoringrealtime/replay.go` after the barrier/exam-scope review.
 */
export const AUTHORING_PROTOCOL_VERSION = 1 as const;

export type AuthoringSnapshotReason =
  | 'cursor_too_old'
  | 'replay_too_large'
  | 'delivery_gap'
  | 'unsupported_event';

/** client -> server: the ONLY outbound frame the protocol defines. */
export interface AuthoringSubscribeFrame {
  type: 'authoring.subscribe';
  v: 1;
  examId: string;
  /** Absent = fresh subscribe (no replay); present = resume from that cursor. */
  lastSeenCursor?: number;
}

/** server -> client handshake ack. draftVersionId + barrierCursor are server-derived. */
export interface AuthoringSubscribedFrame {
  type: 'authoring.subscribed';
  v: 1;
  examId: string;
  draftVersionId: string;
  /** Replay covers (lastSeenCursor, barrierCursor]; live covers (barrier, ...]. */
  barrierCursor: number;
  /**
   * This socket's presence identity, present only when presence was
   * negotiated. Needed to exclude YOURSELF from presence while still seeing
   * the same user's other tabs, which arrive under different connection ids.
   */
  connectionId?: string;
}

/** server -> client capability posture (server-granted; the kill switch may narrow). */
export interface AuthoringCapabilitiesFrame {
  type: 'authoring.capabilities';
  v: 1;
  delivery: boolean;
  presence: boolean;
  conflictCompare: boolean;
}

/** server -> client: the cursor is unrecoverable; refetch authoritatively over HTTP. */
export interface AuthoringSnapshotRequiredFrame {
  type: 'authoring.snapshot_required';
  v: 1;
  examId: string;
  draftVersionId: string;
  reason: AuthoringSnapshotReason;
}

/** server -> client: typed protocol error. Fatal codes stop retrying. */
export interface AuthoringErrorFrame {
  type: 'authoring.error';
  v: 1;
  code: string;
  message: string;
}

export type AuthoringInboundFrame =
  | AuthoringEventFrame
  | AuthoringSubscribedFrame
  | AuthoringCapabilitiesFrame
  | AuthoringSnapshotRequiredFrame
  | AuthoringErrorFrame;

/** Fatal server codes: subscribe is forbidden/denied, so never retry-storm. */
export const AUTHORING_FATAL_ERROR_CODES: readonly string[] = [
  'subscription_forbidden',
  'permission_denied',
  'UNAUTHORIZED',
  'FORBIDDEN',
];

/**
 * Resolved handshake ack. `resumed` distinguishes the two — and only two —
 * legal baselines:
 *
 *   resumed=true  -> the client asked to continue from lastSeenCursor, so the
 *                    server replays (lastSeenCursor, barrierCursor] and the
 *                    client's existing cursor is already the correct baseline.
 *   resumed=false -> a FRESH subscribe: nothing is replayed, so the barrier is
 *                    the baseline and any change that landed between the last
 *                    HTTP read and the barrier is invisible to the socket.
 *                    The orchestrator closes that window with one authoritative
 *                    shell refetch (HTTP is the source of truth).
 *
 * Without this, the first arbitrary event would silently become the baseline
 * and a pre-subscribe change could be lost forever.
 */
export interface AuthoringSubscribedInfo {
  examId: string;
  draftVersionId: string;
  barrierCursor: number;
  resumed: boolean;
  /** Server-minted presence identity for this socket; null when absent. */
  connectionId: string | null;
}

/** Remote structural operations that can target a locally-dirty question. */
export type AuthoringRemoteStructuralKind = 'deleted' | 'moved' | 'bulk_changed';

/**
 * Connection-state machine. Phase 04 only EXPOSES this (and Phase 05 renders
 * it); it is never a visible warning in this phase.
 */
export type AuthoringConnectionState =
  | 'disabled' // flag off / no draft / read-only role
  | 'connecting'
  | 'live' // subscribed and heartbeat-fresh
  | 'reconnecting' // backing off between attempts
  | 'degraded-http' // socket or snapshot recovery failed; HTTP editing still works
  | 'stale-draft' // draft.replaced / exam.published seen; workspace re-resolves
  | 'forbidden'; // fatal subscription denial; manual reconnect only

export interface AuthoringRealtimeStats {
  received: number;
  malformed: number;
  duplicates: number;
  outOfOrder: number;
  staleDraft: number;
  /** Valid frames carrying a future event kind: cursor advances, one safe refetch per rawKind. */
  unknownKind: number;
  snapshotsRequired: number;
  snapshotRecoveries: number;
  reconciled: number;
}

export function createAuthoringRealtimeStats(): AuthoringRealtimeStats {
  return {
    received: 0,
    malformed: 0,
    duplicates: 0,
    outOfOrder: 0,
    staleDraft: 0,
    unknownKind: 0,
    snapshotsRequired: 0,
    snapshotRecoveries: 0,
    reconciled: 0,
  };
}

/**
 * Narrow capability interface for the reconciler: it never imports react-query
 * or the workspace; the hook binds it to the QueryClient.
 *
 * There is deliberately NO patchSummary: the frozen Phase 01 envelope carries
 * no preview/content fields (only `changedFields` NAMES), so a `question.changed`
 * event can never patch a summary row. Content always arrives via HTTP refetch.
 */
export interface ReconcilerContext {
  examId: string;
  draftVersionId: string | null;
  /** true -> record the remote revision and write NOTHING (Phase 05 raises divergence UI). */
  isQuestionDirty(examQuestionId: string): boolean;
  selectedExamQuestionId: string | null;
  invalidateShell(refetch: 'active' | 'none'): void;
  invalidateQuestion(examQuestionId: string, refetch: 'active' | 'none'): void;
  removeQuestionCache(examQuestionId: string): void;
  invalidateReadinessAndRelease(): void;
  noteRemoteRevision(
    examQuestionId: string,
    eventRevision: number,
    actorId?: string | undefined,
  ): void;
  /**
   * A remote structural op (delete / move / bulk change) landed on a question
   * with an unsaved local draft. Record divergence for Phase 05 and write
   * nothing: a dirty draft is NEVER destroyed by a remote event.
   */
  noteRemoteStructuralChange(
    examQuestionId: string,
    kind: AuthoringRemoteStructuralKind,
    actorId?: string | undefined,
  ): void;
}

/** Wire shape: what arrives inside live_update_events.event_payload (domain only). */
export interface AuthoringEventWireV1 extends AuthoringEventV1 {
  version: 1;
}

/**
 * Unknown-kind / unsupported-version tolerant parse result (schemas.ts
 * classifies). A v1 client must never execute v2 semantics merely because
 * the kind name is familiar: any version !== 1 is unsupported-version and
 * resolves to an authoritative refetch, never to event interpretation.
 */
export type ClassifiedAuthoringEvent =
  | { status: 'known'; event: AuthoringEventV1 }
  | {
      status: 'unknown-kind';
      rawKind: string;
      eventId: string;
      scope: AuthoringEventScope;
    }
  | {
      status: 'unsupported-version';
      version: number;
      eventId: string | null;
      scope: AuthoringEventScope | null;
    };

/** Typed domain error codes (snake_case on the wire, details.authoringReason). */
export const AUTHORING_ERROR_CODES = [
  'revision_conflict',
  'draft_replaced',
  'draft_not_editable',
  'permission_denied',
  'entity_deleted',
  'cursor_too_old',
  'subscription_forbidden',
] as const;
export type AuthoringErrorCode = (typeof AUTHORING_ERROR_CODES)[number];

/**
 * Server-authoritative capabilities, negotiated after WS subscription
 * succeeds (authoring.capabilities frame). The frontend kill switch
 * (flags.ts) can only DISABLE a server-granted capability, never enable
 * one the server withheld.
 */
export interface AuthoringCapabilities {
  delivery: boolean;
  presence: boolean;
  conflictCompare: boolean;
}

/** Injectable socket factory: real WebSocket in prod, a stub in dev/tests. */
export interface AuthoringSocketFactory {
  create(url: string): WebSocket;
}

export interface AuthoringClientOptions {
  url: string;
  examId: string;
  getLastSeenCursor(): number | null;
  socketFactory?: AuthoringSocketFactory;
  /** No inbound frame for this long -> close + reconnect. Default 45_000. */
  heartbeatTimeoutMs?: number;
  /** Client keepalive cadence: send a re-subscribe so the server re-acks. Default 25_000. */
  keepaliveIntervalMs?: number;
  /** Continuous open + heartbeat-fresh time that resets backoff. Default 30_000. */
  stableResetMs?: number;
  /** Backoff base. Default 500. */
  minReconnectDelayMs?: number;
  /** Backoff hard cap. Default 30_000. */
  maxReconnectDelayMs?: number;
  onStateChange?(state: AuthoringConnectionState): void;
  onFrame?(frame: AuthoringInboundFrame): void;
  onMalformed?(info: { raw: string; reason: string }): void;
  /**
   * A structurally valid frame whose event kind this client does not know.
   * The cursor advances (so a later known event never looks like a loss) and
   * a conservative refetch runs, but no business behavior is executed.
   */
  onUnknownKind?(info: { rawKind: string; cursor: number }): void;
  /** Fires once per socket handshake ack, before the first delivery frame. */
  onSubscribed?(info: AuthoringSubscribedInfo): void;
  /**
   * One inbound presence frame, raw. Presence has its own vocabulary and is
   * routed before the delivery-frame union so an advisory frame can never be
   * counted (or dropped) as a malformed delivery frame.
   */
  onPresence?(raw: unknown): void;
  onCapabilities?(capabilities: AuthoringCapabilities): void;
}

/** The four independent flags. All default OFF. No mega-flag. */
export type AuthoringRealtimeFlagName =
  | 'authoring_realtime_events'
  | 'authoring_realtime_delivery'
  | 'authoring_presence'
  | 'authoring_conflict_compare';
export interface AuthoringRealtimeFlags {
  authoring_realtime_events: boolean;
  authoring_realtime_delivery: boolean;
  authoring_presence: boolean;
  authoring_conflict_compare: boolean;
}
export const AUTHORING_REALTIME_FLAGS_OFF: AuthoringRealtimeFlags = {
  authoring_realtime_events: false,
  authoring_realtime_delivery: false,
  authoring_presence: false,
  authoring_conflict_compare: false,
};

/**
 * Authoritative HTTP source used by snapshot recovery. The socket is NEVER the
 * source of truth: recovery always refetches over HTTP.
 */
export interface SnapshotSource {
  getShell(examId: string): Promise<AssessmentAuthoringShell>;
  getQuestion(examQuestionId: string): Promise<AssessmentQuestionDetail>;
}

export interface UseAuthoringRealtimeOptions {
  examId: string;
  /** false when the flag is off, no draft exists, or the role is read-only. */
  enabled: boolean;
  draftVersionId: string | null;
  selectedExamQuestionId: string | null;
  isQuestionDirty(examQuestionId: string): boolean;
  socketFactory?: AuthoringSocketFactory;
  /** Raw inbound presence frames, forwarded to the presence hook. */
  onPresence?(raw: unknown): void;
  /**
   * Server-negotiated capability posture. The caller ANDs this with the local
   * kill switch; the server can withhold a capability but never be talked into
   * granting one it did not advertise.
   */
  onCapabilities?(capabilities: AuthoringCapabilities): void;
  onLifecycle?(signal: 'draft-replaced' | 'published' | 'exam-changed'): void;
  /**
   * A newer revision of an open, DIRTY question exists. `actorId` is the server
   * -resolved staff id from the frozen envelope (`event.actor.id`).
   *
   * It is an ID and never a name: the envelope is contractually forbidden from
   * carrying display names, emails, or any other identity detail, so a caller
   * that wants to say "Alice saved Q14" must resolve the id through the
   * presence roster — the one channel authorized to carry names — and fall back
   * to neutral wording when that person is no longer in the room.
   */
  onRemoteRevision?(
    examQuestionId: string,
    eventRevision: number,
    actorId?: string | undefined,
  ): void;
  onRemoteStructuralChange?(
    examQuestionId: string,
    kind: AuthoringRemoteStructuralKind,
    actorId?: string | undefined,
  ): void;
  /** Injectable for tests; defaults to the real assessment authoring API. */
  snapshotSource?: SnapshotSource;
  /** Injectable for tests; defaults to `buildAuthoringSocketUrl`. */
  buildUrl?(examId: string): string;
  /** Delay before the single snapshot-recovery retry. Default 1000; tests use 0. */
  snapshotRetryDelayMs?: number;
}

export interface UseAuthoringRealtimeResult {
  connectionState: AuthoringConnectionState;
  lastProcessedCursor: number | null;
  stats: AuthoringRealtimeStats;
  reconnect(): void;
  /**
   * Send one outbound frame on the authoring socket. Only presence uses this;
   * every mutation stays on HTTP. Returns false when no socket is open, so a
   * caller can treat a dropped advisory frame as normal rather than an error.
   */
  sendFrame(frame: unknown): boolean;
  /** This socket's presence identity, learned from the handshake ack. */
  selfConnectionId: string | null;
}
