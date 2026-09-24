/**
 * Exam Response Durability V2 — Client Durability Engine
 *
 * The engine is the only client-side owner of response ordering and delivery.
 * UI code may update its visible state immediately, but a response is not
 * considered safely persisted until its exact write identity is acknowledged.
 */

import type {
  ConfirmedResponseState,
  DurabilitySyncStatus,
  PendingResponseState,
  QuarantinedWrite,
  ResponseAcknowledgementV2,
  ResponseBatchRequestV2,
  ResponseBatchResponseV2,
  ResponseCommandV2,
  ResponsePayload,
  ResponseSnapshotV2,
  SubmitAttemptV2Request,
  SubmitAttemptV2Response,
} from "./types";
import {
  clearDurableDraft,
  listDurableDrafts,
  saveDurableDraft,
} from "../../utils/durableDraftStore";

export interface TransportClient {
  sendBatch(attemptId: string, req: ResponseBatchRequestV2): Promise<ResponseBatchResponseV2>;
  submit(attemptId: string, req: SubmitAttemptV2Request): Promise<SubmitAttemptV2Response>;
  fetchSnapshot(attemptId: string): Promise<ResponseSnapshotV2 | ResponseAcknowledgementV2[]>;
}

export interface DurableResponseEngineOptions {
  scheduleId: string;
  attemptId: string;
  leaseEpoch: number;
  controlEpoch: number;
  transport: TransportClient;
  /** Delay network draining only; accepted edits are still checkpointed immediately. */
  drainDebounceMs?: number;
  onStatusChange?: (status: DurabilitySyncStatus, error?: string | null) => void;
  onStateChange?: (states: ReadonlyMap<string, import("./types").QuestionResponseState>) => void;
  /**
   * Reason-coded durability telemetry hook (WP7). Privacy-safe: the engine
   * only sends counter names plus reason/epoch/count fields — never
   * answer/payload content. Best-effort; never throws.
   */
  onDurabilityEvent?: (name: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
}

export interface AcceptResponseOptions {
  /** Bypass the normal typing debounce after the local durable checkpoint. */
  drainImmediately?: boolean;
}

const CHECKPOINT_PREFIX = "response-checkpoint:v2:";
const DURABLE_DRAFT_PREFIX = "v2_attempt_";
const QUARANTINE_PREFIX = "v2_quarantine:";
const MAX_RETRY_ATTEMPTS_PER_DRAIN = 8;
/**
 * Control-epoch self-heal budget. The server bumps `control_epoch` on every
 * cohort-clock or attempt-control transition — runtime start, pause/resume,
 * extend, a proctor warning, and the SAT module start itself — and this engine
 * learns the new value only from an authoritative snapshot. A student who
 * checked in after the proctor pressed Start snapshots epoch N, then
 * `modules/start` moves the attempt to N+1 and nothing tells the engine, so
 * the FIRST answer of the exam is refused as CONTROL_EPOCH_STALE.
 *
 * That refusal is a pure skew, not a conflict: same lease, attempt still
 * running, no newer server write for the question. It heals by re-reading the
 * snapshot and re-issuing the queued drafts under the current epoch — the
 * same operation an explicit reconcile performs, without the author having to
 * find a "re-check" button mid-exam. The budget bounds a server that keeps
 * moving the epoch during one drain; past it the drafts stay blocked, visible
 * and reconcilable, exactly as before.
 */
const MAX_CONTROL_EPOCH_HEALS_PER_DRAIN = 2;
/**
 * N1b self-heal budget: a per-question VERSION_COLLISION means another writer
 * under the SAME lease already consumed the version this engine minted (a
 * second tab sharing the client session, or a reload that could not seed the
 * version floor). Each heal refreshes the authoritative floor and re-issues
 * once; a server that keeps rejecting still ends in the honest terminal state.
 */
const MAX_COLLISION_HEALS_PER_DRAIN = 2;
/** F-A6: authoritative snapshot fetches never hang longer than this. */
const SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;
/**
 * Bug 6: the server rejects an envelope with more than 100 commands outright
 * (backend/go/internal/attempts/validate.go — MaxBatchCommands) before any
 * mutation, so one oversized batch strands every otherwise-valid answer.
 */
export const MAX_BATCH_COMMANDS = 100;
/**
 * Bug 6: the student-mutation body cap is 256 KiB
 * (backend/go/internal/platform/httpx/httpx.go — MaxStudentBodyBytes). Stay
 * well below it so the transport wrapper and any proxy overhead cannot push a
 * legal batch over the server's own limit.
 */
export const MAX_BATCH_BODY_BYTES = 192 << 10;
/** Rough cost of the fixed envelope fields (epochs, braces, quoting). */
const BATCH_ENVELOPE_OVERHEAD_BYTES = 1_024;

type CommandEpoch = {
  leaseEpoch: number;
  controlEpoch: number;
};

/**
 * Local extension of BlockedResponseInfo carrying the lease epoch the
 * blocked draft originated under. Kept engine-local (never sent to the
 * backend; telemetry only sees reason/epoch/ID) so types.ts stays untouched.
 * Pre-repair checkpoints lack it; readers fall back to the record leaseEpoch.
 */
interface BlockedInfoEx {
  reason: string;
  blockedAt: string;
  originLeaseEpoch?: number;
}

function isBlockedInfo(value: unknown): value is BlockedInfoEx {
  if (!isRecord(value)) return false;
  return typeof value["reason"] === "string" && typeof value["blockedAt"] === "string";
}

function readBlockedOriginLease(pending: PendingResponseState): number {
  const extra = pending.blocked as BlockedInfoEx | undefined;
  if (
    extra &&
    typeof extra.originLeaseEpoch === "number" &&
    Number.isSafeInteger(extra.originLeaseEpoch)
  ) {
    return extra.originLeaseEpoch;
  }
  return pending.leaseEpoch;
}

type SnapshotResponse = ResponseSnapshotV2 | ResponseAcknowledgementV2[];

function checkpointKey(attemptId: string, questionId: string): string {
  return `${CHECKPOINT_PREFIX}${encodeURIComponent(attemptId)}:${encodeURIComponent(questionId)}`;
}

function durableDraftKey(attemptId: string, questionId: string): string {
  return `${DURABLE_DRAFT_PREFIX}${attemptId}_${questionId}`;
}

function quarantineDraftKey(attemptId: string, writeId: string): string {
  return `${QUARANTINE_PREFIX}${attemptId}:${writeId}`;
}

function randomWriteId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * UTF-8 byte length of an encoded fragment. Deliberately hand-rolled: this
 * budget runs in browsers/embedded webviews where TextEncoder is not
 * guaranteed, and the server's cap counts bytes, not UTF-16 code units
 * (written answers are frequently non-ASCII).
 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair — one 4-byte code point.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Encoded wire size of one command, plus its array separator. */
function encodedCommandBytes(command: ResponseCommandV2): number {
  try {
    const json = JSON.stringify(command);
    return typeof json === "string" ? utf8ByteLength(json) + 1 : BATCH_ENVELOPE_OVERHEAD_BYTES;
  } catch {
    // An unserializable payload cannot be sized, so give it an envelope of its
    // own and let server validation — not this budget — reject it.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Bug 6: split sendable work into envelopes the server's own limits accept.
 * Order is preserved and every command keeps its write identity (writeId +
 * clientVersion) with per-command acknowledgements, so chunking never changes
 * delivery semantics — it only stops one over-cap batch from being rejected as
 * a whole and retried as a whole forever. A single command that is itself over
 * the byte budget still travels alone: it can still be rejected, but it can no
 * longer take its neighbors down with it.
 */
export function chunkResponseCommands(
  commands: readonly ResponseCommandV2[],
  maxCommands: number = MAX_BATCH_COMMANDS,
  maxBodyBytes: number = MAX_BATCH_BODY_BYTES
): ResponseCommandV2[][] {
  const chunks: ResponseCommandV2[][] = [];
  let current: ResponseCommandV2[] = [];
  let bytes = BATCH_ENVELOPE_OVERHEAD_BYTES;
  for (const command of commands) {
    const size = encodedCommandBytes(command);
    if (current.length > 0 && (current.length >= maxCommands || bytes + size > maxBodyBytes)) {
      chunks.push(current);
      current = [];
      bytes = BATCH_ENVELOPE_OVERHEAD_BYTES;
    }
    current.push(command);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function clonePayload(payload: ResponsePayload): ResponsePayload {
  return {
    answer: Array.isArray(payload.answer) ? [...payload.answer] : payload.answer,
    markedForReview: payload.markedForReview,
    eliminatedOptions: [...payload.eliminatedOptions],
    annotations: payload.annotations.map((annotation) => ({ ...annotation })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResponsePayload(value: unknown): value is ResponsePayload {
  if (!isRecord(value)) return false;
  const answer = value["answer"];
  const eliminatedOptions = value["eliminatedOptions"];
  const annotations = value["annotations"];
  const answerIsValid =
    answer === null ||
    typeof answer === "string" ||
    (Array.isArray(answer) && answer.every((item) => typeof item === "string"));
  return (
    answerIsValid &&
    typeof value["markedForReview"] === "boolean" &&
    Array.isArray(eliminatedOptions) &&
    eliminatedOptions.every((item) => typeof item === "string") &&
    Array.isArray(annotations) &&
    annotations.every((annotation) => isRecord(annotation) && typeof annotation["id"] === "string")
  );
}

function isPendingResponseState(value: unknown): value is PendingResponseState {
  if (!isRecord(value)) return false;
  return (
    isResponsePayload(value["payload"]) &&
    typeof value["writeId"] === "string" &&
    value["writeId"].trim().length > 0 &&
    typeof value["leaseEpoch"] === "number" &&
    Number.isSafeInteger(value["leaseEpoch"]) &&
    typeof value["controlEpoch"] === "number" &&
    Number.isSafeInteger(value["controlEpoch"]) &&
    typeof value["clientVersion"] === "number" &&
    Number.isSafeInteger(value["clientVersion"]) &&
    // Bug 1: an unversioned record (clientVersion 0) is a LEGAL durable
    // intent, not garbage — it is the provisional checkpoint written before
    // asynchronous storage/recovery granted a version. Excluding it here
    // silently dropped the newest local text on engine replacement. Version
    // issuance/seeding happens in recoverInternal; zero itself still never
    // reaches the outbox or the wire.
    value["clientVersion"] >= 0 &&
    // A present block marker must be well-formed: recovery branches on it to
    // decide whether a draft may be minted for the wire or must stay a
    // reconcilable, non-sendable draft.
    (value["blocked"] === undefined || isBlockedInfo(value["blocked"]))
  );
}

function pendingRecency(left: PendingResponseState): number {
  const parsed = typeof left.receivedAt === "string" ? Date.parse(left.receivedAt) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  return Number.NEGATIVE_INFINITY;
}

function pendingOrder(left: PendingResponseState): number {
  return typeof left.order === "number" && Number.isSafeInteger(left.order) ? left.order : 0;
}

function comparePendingResponses(left: PendingResponseState, right: PendingResponseState): number {
  // F-A2/A15: acceptSequence order is the PRIMARY recency signal — monotonic
  // per session (and seeded from storage at recovery, so it stays monotonic
  // across reloads), immune to wall-clock skew, manual clock steps, and
  // same-millisecond collisions. receivedAt is only a secondary tiebreak for
  // equal orders. Legacy pre-repair records have order 0 (field absent): they
  // predate both signals, so record-vs-record falls through to the version
  // chain below — never trust wall-clock alone to rank a legacy record.
  const leftOrder = pendingOrder(left);
  const rightOrder = pendingOrder(right);
  const leftSequenced = leftOrder > 0;
  const rightSequenced = rightOrder > 0;
  if (leftSequenced && rightSequenced) {
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    const leftRecency = pendingRecency(left);
    const rightRecency = pendingRecency(right);
    if (leftRecency !== rightRecency) {
      return leftRecency - rightRecency;
    }
  } else if (leftSequenced !== rightSequenced) {
    // A sequenced write is newer than any legacy order-0 record.
    return leftSequenced ? 1 : -1;
  }
  // Both legacy (order 0), or sequenced with equal order+recency: fall back
  // to the pre-repair ordering so old checkpoints keep deterministic behavior.
  if (left.leaseEpoch !== right.leaseEpoch) {
    return left.leaseEpoch - right.leaseEpoch;
  }
  if (left.controlEpoch !== right.controlEpoch) {
    return left.controlEpoch - right.controlEpoch;
  }
  if (left.clientVersion !== right.clientVersion) {
    return left.clientVersion - right.clientVersion;
  }
  const durabilityRank = { memory: 0, checkpoint: 1, indexeddb: 2 } as const;
  return durabilityRank[left.durability] - durabilityRank[right.durability];
}

function isSnapshotResponse(value: SnapshotResponse): value is ResponseSnapshotV2 {
  return !Array.isArray(value);
}

/**
 * F-A6: every authoritative snapshot fetch races the transport against a
 * timer (~15s, no new dep). A hung fetch resolves like an offline fetch:
 * the caller keeps pending drafts, emits the fetch-failure-class event,
 * and stays retryable — never hangs, never drops intent.
 */
function fetchSnapshotWithTimeout(
  fetch: (attemptId: string) => Promise<SnapshotResponse>,
  attemptId: string
): Promise<SnapshotResponse> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Response snapshot fetch timed out."));
    }, SNAPSHOT_FETCH_TIMEOUT_MS);
  });
  const request = fetch(attemptId);
  return Promise.race([request, timeout]).then(
    (snapshot) => {
      if (timer) clearTimeout(timer);
      return snapshot as SnapshotResponse;
    },
    (error: unknown) => {
      if (timer) clearTimeout(timer);
      // A late transport resolution must not surface as an unhandled
      // rejection after the timeout already settled the race.
      request.catch(() => undefined);
      throw error;
    }
  );
}

export class DurableResponseEngine {
  public readonly attemptId: string;
  public readonly scheduleId: string;

  private leaseEpoch: number;
  private controlEpoch: number;
  private attemptRevision = 0;
  private readonly transport: TransportClient;

  private readonly states = new Map<string, import("./types").QuestionResponseState>();
  private readonly versionTrackers = new Map<string, number>();
  private readonly confirmedVersions = new Map<string, number>();
  private readonly outbox = new Map<string, ResponseCommandV2>();
  private readonly inFlight = new Map<string, ResponseCommandV2>();
  private readonly issuedCommands = new Map<string, ResponseCommandV2>();
  private readonly commandEpochs = new Map<string, CommandEpoch>();
  private readonly quarantined: QuarantinedWrite[] = [];
  /** Incremented in destroy(); async archive/tombstone work aborts when it moves. */
  private engineGeneration = 0;
  /** Per-question reconcile mutex: one reconcileBlocked per question at a time. */
  private readonly reconciling = new Set<string>();
  private acceptSequence = 0;
  private recoveryStarted = false;
  private recoveryInitialized = false;
  private readonly recoveryWaiters = new Set<() => void>();

  private isDraining = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly drainDebounceMs: number;
  private drainPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private submissionPromise: Promise<SubmitAttemptV2Response> | null = null;
  private readonly pendingAcceptances = new Set<Promise<void>>();
  private readonly acceptanceChains = new Map<string, Promise<void>>();
  private recoveryQueue: Promise<unknown> = Promise.resolve();
  private isDestroyed = false;
  private terminalState = false;
  private syncStatus: DurabilitySyncStatus = "synced";
  private lastError: string | null = null;

  private onStatusChange:
    ((status: DurabilitySyncStatus, error?: string | null) => void) | undefined;
  private onStateChange:
    ((states: ReadonlyMap<string, import("./types").QuestionResponseState>) => void) | undefined;
  private onDurabilityEvent:
    ((name: string, fields?: Record<string, string | number | boolean | null | undefined>) => void) | undefined;

  constructor(options: DurableResponseEngineOptions) {
    this.scheduleId = options.scheduleId;
    this.attemptId = options.attemptId;
    this.leaseEpoch = options.leaseEpoch;
    this.controlEpoch = options.controlEpoch;
    this.transport = options.transport;
    this.drainDebounceMs = Number.isFinite(options.drainDebounceMs) ? Math.max(0, options.drainDebounceMs ?? 0) : 0;
    this.onStatusChange = options.onStatusChange;
    this.onStateChange = options.onStateChange;
    this.onDurabilityEvent = options.onDurabilityEvent;

    this.setupLifecycleListeners();
  }

  public getStatus(): DurabilitySyncStatus {
    return this.syncStatus;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getAttemptRevision(): number {
    return this.attemptRevision;
  }

  public getLeaseEpoch(): number {
    return this.leaseEpoch;
  }

  public getControlEpoch(): number {
    return this.controlEpoch;
  }

  public getStates(): ReadonlyMap<string, import("./types").QuestionResponseState> {
    return this.states;
  }

  public getQuarantined(): readonly QuarantinedWrite[] {
    return this.quarantined;
  }

  public getPendingCount(): number {
    return this.outbox.size + this.inFlight.size;
  }

  /** True once a snapshot (or explicit offline seeding) has initialized versions. */
  public isRecoveryInitialized(): boolean {
    return this.recoveryInitialized;
  }

  /** Resolves when the first recovery has seeded versions. Never rejects. */
  public waitForRecoveryInitialization(): Promise<void> {
    if (this.recoveryInitialized) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.recoveryWaiters.add(resolve);
    });
  }

  /** Questions with visible drafts that must not be sent without a decision. */
  public getBlockedQuestionIds(): string[] {
    const blocked: string[] = [];
    for (const [questionId, state] of this.states) {
      if (state.pending?.blocked) blocked.push(questionId);
    }
    return blocked;
  }

  public getBlockedCount(): number {
    return this.getBlockedQuestionIds().length;
  }

  /**
   * SAT-004: the single boundary barrier for module submission AND the
   * terminal submit. Throws when a visible answer would otherwise cross the
   * boundary unaccounted for. Providers call this after flush; the engine
   * refusal is classified by the caller (blocked/quarantine copy vs pending
   * retryable failure). A terminal receipt owns the remainder once it lands.
   */
  public assertBoundarySettled(): void {
    if (this.terminalState) return;
    if (this.getBlockedCount() > 0) {
      throw new Error("Blocked drafts need attention before submit. Reconcile or discard them first.");
    }
    if (this.quarantined.length > 0) {
      throw new Error("Some saved answers were quarantined and need attention before submit.");
    }
    if (this.getPendingCount() > 0 || this.hasUnacknowledgedIntent()) {
      throw new Error(
        this.getLastError() ?? "One or more responses have not been durably saved."
      );
    }
  }

  /**
   * Bug 5: a visible draft the server has not acknowledged. A provisional
   * intent awaiting its version is deliberately NOT in the outbox or in-flight
   * maps, so queue size alone cannot answer "is anything still outstanding?".
   */
  private hasUnacknowledgedIntent(): boolean {
    for (const state of this.states.values()) {
      if (state.pending) return true;
    }
    return false;
  }

  /**
   * Bug 5: accepting intent can never leave a server-saved claim standing.
   * Only a matching acknowledgement (or an explicit discard) restores the
   * server-saved truth; until then the honest state is "kept on this device"
   * when the intent reached durable storage and "saving" while it has not.
   * Explicit conflict/blocked/fault states are never downgraded here.
   */
  private markPendingIntent(locallyDurable: boolean): void {
    if (this.syncStatus !== "synced" && this.syncStatus !== "saving") return;
    const next: DurabilitySyncStatus = locallyDurable ? "saved_locally" : "saving";
    if (this.syncStatus === next) return;
    this.syncStatus = next;
    if (locallyDurable) this.lastError = null;
    this.notifyStatusChange();
  }

  /**
   * Adopt an authoritative lifecycle epoch. Writes created under a different
   * epoch are quarantined rather than relabeled and replayed under the new one.
   */
  public updateEpochs(leaseEpoch: number, controlEpoch: number): void {
    if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch <= 0) return;
    if (!Number.isSafeInteger(controlEpoch) || controlEpoch <= 0) return;

    // Epochs are database-owned monotonic fences. A delayed snapshot must not
    // roll a live engine back to an older lease/control epoch.
    const nextLeaseEpoch = Math.max(this.leaseEpoch, leaseEpoch);
    const nextControlEpoch = Math.max(this.controlEpoch, controlEpoch);
    const leaseChanged = nextLeaseEpoch !== this.leaseEpoch;
    const controlChanged = nextControlEpoch !== this.controlEpoch;
    this.leaseEpoch = nextLeaseEpoch;
    this.controlEpoch = nextControlEpoch;
    if (!leaseChanged && !controlChanged) return;

    if (!leaseChanged) {
      // Timing-only control bump (pause/resume/extend): keep unsent work
      // visible in place as blocked instead of quarantining it away (I4).
      // Lease changes keep the strict fence below — never auto-crossed (I6).
      this.blockPendingOnControlBump();
      return;
    }
    this.quarantineCommandsOutsideCurrentEpoch("EPOCH_STALE");
    // RISK-6: a lease change must NOT silently clear a fenced/terminal
    // conflict back to synced. The conflict persists until a user-visible
    // reconcile/discard or a fresh server ack resolves it (see
    // clearConflictOnExplicitResolution). Epoch adoption still proceeds above.
  }

  /**
   * Accept user input for one question aggregate.
   */
  public acceptResponse(
    questionId: string,
    payload: ResponsePayload,
    options: AcceptResponseOptions = {},
  ): Promise<void> {
    if (this.isDestroyed) return Promise.resolve();
    if (!questionId.trim()) return Promise.reject(new Error("Question id cannot be empty."));
    if (this.terminalState) {
      return Promise.reject(new Error(this.lastError ?? "This attempt is no longer writable."));
    }
    if (this.syncStatus === "conflict_fenced" || this.syncStatus === "conflict_terminal") {
      return Promise.reject(
        new Error(this.lastError ?? "This attempt is fenced by a newer session or terminal state.")
      );
    }

    // Update the visible state synchronously and checkpoint the intent
    // synchronously, then version it. Versions are allocated only after
    // recovery has seeded the trackers (I1/I3); the sync checkpoint is what
    // makes destroy()/reload safe, never the async IndexedDB completion.
    const normalized = clonePayload(payload);
    this.acceptSequence += 1;
    const receivedAt = new Date().toISOString();
    const order = this.acceptSequence;
    const provisionalWriteId = randomWriteId();
    const pendingState: PendingResponseState = {
      payload: normalized,
      writeId: provisionalWriteId,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      // Provisional until recovery seeds versions; replaced by the issued
      // version in persistAcceptedResponse. Never sent as-is.
      clientVersion: 0,
      durability: "memory",
      receivedAt,
      order,
    };
    const command: ResponseCommandV2 = {
      writeId: provisionalWriteId,
      questionId,
      clientVersion: 0,
      response: normalized,
    };

    const existing = this.states.get(questionId);
    // F-A10: typing on a blocked question must not silently drop the block or
    // re-enter the send path under the blocked epoch. Carry the blocked flag
    // (and its origin lease) into the new intent so it stays non-sendable and
    // reconcilable, never auto-issued.
    const priorPending = existing?.pending;
    if (priorPending?.blocked) {
      const carry: BlockedInfoEx = {
        reason: priorPending.blocked.reason,
        blockedAt: new Date().toISOString(),
        originLeaseEpoch: readBlockedOriginLease(priorPending),
      };
      pendingState.blocked = carry;
    }
    this.states.set(questionId, {
      confirmed: existing?.confirmed ?? null,
      pending: pendingState,
    });
    // Teardown-safe intent checkpoint runs inline — never behind the async
    // acceptance chain — so teardown/reload always sees the latest keystroke.
    const checkpointStored = this.checkpointIntentSync(questionId, pendingState);
    // Bug 5: accepting intent is not "saved". The provisional write is not in
    // the outbox yet (its version is allocated only after recovery seeds
    // versions), so a status that still claims server-saved would be a false
    // durability signal for the newest keystroke.
    this.markPendingIntent(checkpointStored);
    if (this.recoveryStarted && !this.recoveryInitialized) this.emitDurabilityEvent("intent_queued_during_recovery", { attemptId: this.attemptId, scheduleId: this.scheduleId });
    this.notifyStateChange();

    const previous = this.acceptanceChains.get(questionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.persistAcceptedResponse(command, pendingState, options.drainImmediately === true));
    this.acceptanceChains.set(questionId, operation);
    void operation.then(
      () => {
        if (this.acceptanceChains.get(questionId) === operation) {
          this.acceptanceChains.delete(questionId);
        }
      },
      () => {
        if (this.acceptanceChains.get(questionId) === operation) {
          this.acceptanceChains.delete(questionId);
        }
      }
    );

    this.pendingAcceptances.add(operation);
    void operation.then(
      () => this.pendingAcceptances.delete(operation),
      () => this.pendingAcceptances.delete(operation)
    );
    return operation;
  }

  private async persistAcceptedResponse(
    command: ResponseCommandV2,
    pendingState: PendingResponseState,
    drainImmediately = false,
  ): Promise<void> {
    if (this.isDestroyed) return;

    // If another edit superseded this command before its turn reached durable
    // storage, the newer command is the only one that needs to be persisted.
    if (this.states.get(command.questionId)?.pending?.writeId !== command.writeId) {
      return;
    }

    // I2: the intent checkpoint must be teardown-safe and independent of the
    // async IndexedDB write. A slow earlier chain entry must never delay the
    // latest intent, so checkpoint here synchronously before any await.
    const checkpointOk = this.checkpointIntentSync(command.questionId, pendingState);

    let indexedDbOk = false;
    try {
      const stored = this.states.get(command.questionId)?.pending;
      await saveDurableDraft(
        durableDraftKey(this.attemptId, command.questionId),
        stored && stored.writeId === command.writeId ? stored : pendingState
      );
      indexedDbOk = true;
      if (this.states.get(command.questionId)?.pending?.writeId === command.writeId) {
        const current = this.states.get(command.questionId)?.pending;
        if (current && current.durability !== "indexeddb") {
          current.durability = "indexeddb";
          // Compare-and-set: never let a stale async completion overwrite a
          // newer checkpoint written after this write started.
          const latest = this.readCheckpointSync(command.questionId);
          if (!latest || latest.writeId === command.writeId) {
            this.checkpointIntentSync(command.questionId, current);
          }
        }
      }
    } catch {
      // A memory-only response is not safe enough to enqueue for transport.
    }

    if (this.isDestroyed) return;

    // I3: no command enters the outbox/network with an uninitialized version.
    // Wait for the first recovery to seed version trackers from the server
    // snapshot (or explicit offline seeding) before issuing versions.
    // Only gate when recovery was explicitly started; acceptResponse without
    // recover() must never hang (recoveryInitialized stays false otherwise).
    if (this.recoveryStarted) await this.waitForRecoveryInitialization();
    if (this.isDestroyed) return;

    if (!checkpointOk && !indexedDbOk) {
      this.syncStatus = "durability_fault";
      this.lastError = "All browser durable storage failed. Exam cannot safely proceed.";
      this.notifyStatusChange();
      this.emitDurabilityEvent("checkpoint_sync_failed");
      throw new Error(this.lastError);
    }

    // A lifecycle change can arrive while browser storage is awaiting
    // IndexedDB. Never enqueue that command under the newly adopted epoch.
    // BUG-4: split the fence like updateEpochs does — a lease change
    // quarantines (strict fence, never crossed); a control-only change keeps
    // the draft visible as blocked/reconcilable. A blocked draft is never
    // enqueued here; reconcile re-issues it under the new epoch instead.
    if (pendingState.leaseEpoch !== this.leaseEpoch) {
      this.quarantineEntry(command, "EPOCH_STALE");
      return;
    }
    if (pendingState.controlEpoch !== this.controlEpoch) {
      const livePending = this.states.get(command.questionId)?.pending;
      if (livePending && livePending.writeId === command.writeId && !livePending.blocked) {
        const mark: BlockedInfoEx = {
          reason: "EPOCH_STALE",
          blockedAt: new Date().toISOString(),
          originLeaseEpoch: livePending.leaseEpoch,
        };
        livePending.blocked = mark;
        this.checkpointIntentSync(command.questionId, livePending);
        this.syncStatus = "blocked_attention";
        this.lastError =
          "Exam timing changed. Your latest answers are kept on this device and need re-check.";
        this.notifyStateChange();
        this.notifyStatusChange();
        this.emitDurabilityEvent("control_epoch_blocked", {
          reason: "CONTROL_EPOCH_STALE",
          controlEpoch: this.controlEpoch,
        });
      }
      return;
    }
    if (this.states.get(command.questionId)?.pending?.blocked) {
      return;
    }

    // A terminal/fencing conflict may have arrived while browser storage was
    // awaiting completion. Do not enqueue a late acceptance after the engine
    // has already quarantined the active ledger.
    if (this.syncStatus === "conflict_fenced" || this.syncStatus === "conflict_terminal") {
      this.quarantineEntry(
        command,
        this.syncStatus === "conflict_fenced" ? "LEASE_FENCED" : "TERMINAL_CONFLICT"
      );
      return;
    }

    // A newer command for this question may have been accepted while the
    // durable write was awaiting IndexedDB. Keep the latest unsent command and
    // retain older commands only when they are already in flight.
    const live = this.states.get(command.questionId)?.pending;
    if (!live || live.writeId !== command.writeId) {
      return;
    }
    // Issue the real version only now, after initialization. The provisional
    // clientVersion 0 is never sent; skipping superseded provisional writes
    // here also keeps the tracker monotonic.
    const issuedVersion = (this.versionTrackers.get(command.questionId) ?? 0) + 1;
    this.versionTrackers.set(command.questionId, issuedVersion);
    live.clientVersion = issuedVersion;
    live.leaseEpoch = this.leaseEpoch;
    live.controlEpoch = this.controlEpoch;
    command.clientVersion = issuedVersion;
    const previousOutbox = this.outbox.get(command.questionId);
    if (previousOutbox && previousOutbox.writeId !== command.writeId) {
      this.removeCommand(previousOutbox);
    }

    this.syncStatus = "saved_locally";
    this.lastError = null;
    this.notifyStatusChange();

    this.outbox.set(command.questionId, command);
    this.issuedCommands.set(command.writeId, command);
    this.commandEpochs.set(command.writeId, {
      leaseEpoch: live.leaseEpoch,
      controlEpoch: live.controlEpoch,
    });
    // P1 observation: the inline sync checkpoint above stored the provisional
    // clientVersion 0. In IDB-less environments that checkpoint is the ONLY
    // durable copy — recovery would see an unblocked v0 draft and drop it
    // via the clientVersion>0 gate. Re-checkpoint the versioned intent (sync
    // + best-effort IDB refresh) so reload recovery preserves the issued
    // write. Compare-and-set: never overwrite a newer checkpoint.
    const versioned = this.states.get(command.questionId)?.pending;
    if (versioned && versioned.writeId === command.writeId) {
      // Refresh only when the checkpoint is missing/unreadable (the v0
      // provisional fails the pending gate) or holds this same write —
      // never overwrite a newer write's checkpoint.
      const latest = this.readCheckpointSync(command.questionId);
      if (!latest || latest.writeId === command.writeId) {
        this.checkpointIntentSync(command.questionId, versioned);
      }
      void saveDurableDraft(durableDraftKey(this.attemptId, command.questionId), versioned).catch(
        () => undefined
      );
    }
    this.scheduleDrain(drainImmediately);
  }

  /**
   * Synchronous teardown-safe intent checkpoint (I2). Runs inline in
   * acceptResponse's chain — never behind an awaited IndexedDB write — so a
   * slow/stalled earlier entry cannot delay the latest student intent.
   * Best-effort: returns false when no sync storage is available.
   */
  private checkpointIntentSync(questionId: string, pending: PendingResponseState): boolean {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(
          checkpointKey(this.attemptId, questionId),
          JSON.stringify(pending)
        );
        if (pending.durability === "memory") pending.durability = "checkpoint";
        return true;
      }
    } catch {
      // IndexedDB is attempted by the caller when localStorage is unavailable.
    }
    return false;
  }

  private readCheckpointSync(questionId: string): PendingResponseState | null {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const raw = window.localStorage.getItem(checkpointKey(this.attemptId, questionId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      // A same-key tombstone is authoritative: the draft is gone by decision.
      // Never surface it as a live pending draft, so a stale async CAS write
      // can never resurrect a quarantined/discarded write as sendable.
      if (this.isTombstoneRecord(parsed)) return null;
      return isPendingResponseState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Origin lease recorded for a command at enqueue time (fallback: live pending). */
  private commandOriginLease(command: ResponseCommandV2): number {
    const epoch = this.commandEpochs.get(command.writeId);
    if (epoch && Number.isSafeInteger(epoch.leaseEpoch)) return epoch.leaseEpoch;
    const live = this.states.get(command.questionId)?.pending;
    if (live && live.writeId === command.writeId && Number.isSafeInteger(live.leaseEpoch)) {
      return live.leaseEpoch;
    }
    return this.leaseEpoch;
  }

  private markRecoveryInitialized(): void {
    if (this.recoveryInitialized) return;
    this.recoveryInitialized = true;
    for (const resolve of this.recoveryWaiters) {
      try { resolve(); } catch { /* never throws */ }
    }
    this.recoveryWaiters.clear();
  }

  /**
   * Recover durable drafts and overlay them on one authoritative server snapshot.
   * IndexedDB and the synchronous checkpoint are both consulted; the newest
   * tuple (lease, control, client version) wins for each question.
   */
  public recover(): Promise<void> {
    this.recoveryStarted = true;
    if (this.isDestroyed) return Promise.resolve();

    // Recovery is serialized. Takeover/bootstrap may request a fresh snapshot
    // while the initial snapshot is still in flight; the later recovery must
    // not be overwritten by an older response.
    const operation = this.recoveryQueue.then(
      () => this.recoverInternal(),
      () => this.recoverInternal()
    );
    this.recoveryQueue = operation.catch(() => undefined);
    return operation;
  }

  private async recoverInternal(): Promise<void> {
    this.recoveryStarted = true;
    if (this.isDestroyed) return;

    await this.rehydrateQuarantineLedger();
    if (this.isDestroyed) return;
    const recoveredPending = await this.loadRecoveredPending();
    if (this.isDestroyed) return;
    let snapshot: SnapshotResponse | null = null;

    try {
      // F-A6: a hung snapshot fetch times out like an offline fetch — local
      // durable drafts remain visible and queued, never dropped, never hung.
      snapshot = await fetchSnapshotWithTimeout(
        (attemptId) => this.transport.fetchSnapshot(attemptId),
        this.attemptId
      );
      if (this.isDestroyed) return;
    } catch {
      // Offline startup is valid: local durable drafts remain visible and queued.
    }

    // F-A2/A15: seed the accept sequence from recovered orders so order
    // stays a monotonic cross-reload recency signal (never reused, never
    // regressed by a reload).
    for (const pending of recoveredPending.values()) {
      if (
        typeof pending.order === "number" &&
        Number.isSafeInteger(pending.order) &&
        pending.order > this.acceptSequence
      ) {
        this.acceptSequence = pending.order;
      }
    }

    const serverResponses = snapshot
      ? isSnapshotResponse(snapshot)
        ? snapshot.responses
        : snapshot
      : [];

    if (snapshot && isSnapshotResponse(snapshot)) {
      if (snapshot.attemptId !== this.attemptId) {
        throw new Error("Response snapshot attempt binding mismatch.");
      }
      this.attemptRevision = Math.max(this.attemptRevision, snapshot.attemptRevision);
      this.updateEpochs(snapshot.leaseEpoch, snapshot.controlEpoch);
    }

    const serverByQuestion = new Map(
      serverResponses.map((response) => [response.questionId, response])
    );
    for (const response of serverResponses) {
      this.installServerResponse(response);
    }

    // Seed confirmed/server state first so live in-session edits (which carry
    // recency metadata) can never be regressed by a stale durable candidate.
    // Provisional pre-recovery writes (clientVersion 0) are always newer than
    // any stored draft: they were accepted after recovery started reading.
    for (const [questionId, pending] of recoveredPending) {
      // RISK-24: a reconcile in flight owns Q — recovery must not install a
      // stale candidate over it or issue competing versions under it.
      if (this.reconciling.has(questionId)) {
        continue;
      }
      const liveState = this.states.get(questionId);
      const live = liveState?.pending;
      if (live && (live.clientVersion <= 0 || comparePendingResponses(live, pending) > 0)) {
        this.versionTrackers.set(
          questionId,
          Math.max(this.versionTrackers.get(questionId) ?? 0, pending.clientVersion)
        );
        continue;
      }

      // BUG-2/F-A9/F-A11: never reinstall a command quarantined mid-flight.
      // Snapshot the quarantined writeIds before installing this batch and
      // skip any candidate already in the audit ledger.
      const quarantinedWrites = new Set(this.quarantined.map((entry) => entry.writeId));
      if (quarantinedWrites.has(pending.writeId)) {
        continue;
      }

      const server = serverByQuestion.get(questionId);
      const hasAuthoritativeEpoch = Boolean(snapshot && isSnapshotResponse(snapshot));
      const leaseMatches = pending.leaseEpoch === this.leaseEpoch;
      const controlMatches = pending.controlEpoch === this.controlEpoch;
      // Bug 1: a never-issued local intent (clientVersion 0) is newer than any
      // server write by construction — it was accepted locally and died before
      // the version allocator ran, so it cannot be compared against (or lost
      // to) a server version. Its version is minted below; zero never flies.
      const neverIssuedIntent = pending.clientVersion <= 0;
      const serverVersionIsNewer =
        !neverIssuedIntent &&
        server !== undefined &&
        (server.clientVersion > pending.clientVersion ||
          (server.clientVersion === pending.clientVersion && server.writeId !== pending.writeId));
      const serverAlreadyHasThisWrite = server?.writeId === pending.writeId;
      const terminal =
        snapshot &&
        isSnapshotResponse(snapshot) &&
        ["submitted", "terminated", "locked", "cancelled"].includes(snapshot.deliveryStatus);

      // An exact server write is authoritative even if the attempt has since
      // crossed an epoch or terminal boundary. It was accepted before that
      // boundary, so clear it rather than misclassifying it as stale.
      if (serverAlreadyHasThisWrite) {
        this.clearRecoveredWrite(questionId, pending.writeId);
        continue;
      }

      // BUG-19: split the fence like updateEpochs does. A lease mismatch
      // quarantines (strict fence, never crossed); a control-only mismatch
      // surfaces as blocked/reconcilable with the same blocked shape as
      // blockPendingOnControlBump — never quarantined away.
      if (!leaseMatches || (hasAuthoritativeEpoch && serverVersionIsNewer) || Boolean(terminal)) {
        this.quarantinePending(
          questionId,
          pending,
          !leaseMatches ? "EPOCH_STALE" : "STALE_HYDRATION"
        );
        continue;
      }
      if (!controlMatches && !pending.blocked) {
        const mark: BlockedInfoEx = {
          reason: "EPOCH_STALE",
          blockedAt: new Date().toISOString(),
          originLeaseEpoch: pending.leaseEpoch,
        };
        pending.blocked = mark;
        this.checkpointIntentSync(questionId, pending);
        this.emitDurabilityEvent("control_epoch_blocked", {
          reason: "CONTROL_EPOCH_STALE",
          controlEpoch: this.controlEpoch,
        });
        if (this.syncStatus !== "conflict_fenced" && this.syncStatus !== "conflict_terminal") {
          this.syncStatus = "blocked_attention";
          this.lastError =
            "Exam timing changed. Your latest answers are kept on this device and need re-check.";
        }
      }

      // RISK-26 (offline version cliff): a re-enqueued durable draft carries
      // the clientVersion it was minted with, so the version floor for this
      // question MUST be raised to at least that version before any new edit
      // mints from it. Without this seed an offline recovery (no snapshot to
      // seed trackers from, and no live-supersede branch to seed either)
      // leaves the tracker at 0, so the student's next keystroke mints v1 — a
      // version the server already consumed under this lease — and the whole
      // outbox is terminally quarantined via VERSION_COLLISION. Minting above
      // the recovered version is always safe: versions may skip, they may
      // never repeat, and the server's projection prefers lease over version.
      const existing = this.states.get(questionId);
      if (neverIssuedIntent && !pending.blocked) {
        // Bug 1: recovery is the only place that can allocate the version the
        // provisional never received. Mint it above the refreshed floor —
        // including the snapshot's own server version, so the send can never
        // draw a VERSION_COLLISION — and refresh both durable copies so a
        // second reload sees a sendable write instead of a raw zero.
        const issuedVersion =
          Math.max(this.versionTrackers.get(questionId) ?? 0, server?.clientVersion ?? 0) + 1;
        this.versionTrackers.set(questionId, issuedVersion);
        pending.clientVersion = issuedVersion;
        this.checkpointIntentSync(questionId, pending);
        void saveDurableDraft(durableDraftKey(this.attemptId, questionId), pending).catch(
          () => undefined
        );
        this.emitDurabilityEvent("unversioned_intent_recovered", {
          reason: "UNVERSIONED_INTENT",
          clientVersion: issuedVersion,
        });
      } else {
        this.versionTrackers.set(
          questionId,
          Math.max(this.versionTrackers.get(questionId) ?? 0, pending.clientVersion)
        );
      }
      this.states.set(questionId, {
        confirmed: existing?.confirmed ?? null,
        pending,
      });
      const command: ResponseCommandV2 = {
        writeId: pending.writeId,
        questionId,
        clientVersion: pending.clientVersion,
        response: clonePayload(pending.payload),
      };
      this.outbox.set(questionId, command);
      // A never-issued draft has no server footprint: it can never be
      // acknowledged, and the epoch sweep below only fences writes that could
      // have reached the wire. Registering it would tombstone a draft that
      // was never sent, instead of leaving it visible for reconcile/discard.
      if (pending.clientVersion > 0) {
        this.issuedCommands.set(command.writeId, command);
        this.commandEpochs.set(command.writeId, {
          leaseEpoch: pending.leaseEpoch,
          controlEpoch: pending.controlEpoch,
        });
      }
    }

    // First recovery seeds version ordering exactly once. Later recoveries
    // (takeover/bootstrap refresh) only raise the floor, never regress it.
    this.markRecoveryInitialized();

    // If the snapshot could not be fetched, the attempt bootstrap epochs are
    // still the only safe epoch boundary available to this browser.
    this.quarantineCommandsOutsideCurrentEpoch("EPOCH_STALE");

    if (
      snapshot &&
      isSnapshotResponse(snapshot) &&
      ["submitted", "terminated", "locked", "cancelled"].includes(snapshot.deliveryStatus)
    ) {
      this.fenceTerminalSnapshot(serverResponses);
    }

    // Bug 5: a recovered draft is unacknowledged work, so recovery must never
    // end on a server-saved claim. Recovered drafts are durable by definition
    // (they came out of storage), so the honest state is "kept on this device"
    // until the drain acknowledges them.
    if (this.hasUnacknowledgedIntent()) this.markPendingIntent(true);

    this.notifyStateChange();
    this.scheduleDrain();
  }

  /** Flush pending outbox entries. A missing acknowledgement is not treated as success. */
  public async flush(): Promise<void> {
    if (this.isDestroyed) return;
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }

    // A durable acceptance may begin while an earlier drain is awaiting the
    // network. Re-check both queues after that drain so the flush barrier never
    // returns while a newly accepted response is still only in memory.
    while (!this.isDestroyed) {
      await this.waitForPendingAcceptances();
      if (this.submissionPromise) {
        await this.submissionPromise;
        return;
      }
      if (this.retryTimer) return;
      if (this.isDraining) {
        await this.drainPromise;
        continue;
      }
      // Blocked drafts stay queued until reconcile/discard — flush must not
      // spin forever waiting for work that is deliberately never sent.
      if (this.outbox.size === 0 || !this.hasSendableOutbox()) return;

      this.drainPromise = this.drainOutbox();
      await this.drainPromise;
    }
  }

  /** Submit all currently pending writes in one atomic server request. */
  public submit(
    submissionId: string,
    expectedAttemptRevision: number
  ): Promise<SubmitAttemptV2Response> {
    if (this.submissionPromise) return this.submissionPromise;
    const promise = this.submitInternal(submissionId, expectedAttemptRevision);
    this.submissionPromise = promise;
    void promise.then(
      () => {
        if (this.submissionPromise === promise) this.submissionPromise = null;
      },
      () => {
        if (this.submissionPromise === promise) this.submissionPromise = null;
      }
    );
    return promise;
  }

  public destroy(): void {
    this.isDestroyed = true;
    // Archive windows (BUG-15/16/17, F-A5): async archive/tombstone work
    // captured the prior generation aborts instead of writing for a dead engine.
    this.engineGeneration += 1;
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    // In-flight network promises cannot be cancelled by every transport. Drop
    // callbacks immediately so a response from an unmounted/replaced engine
    // cannot publish into the next attempt instance.
    this.onStatusChange = undefined;
    this.onStateChange = undefined;
    this.onDurabilityEvent = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Unblock any persistAcceptedResponse awaiting recovery so unmount never hangs.
    this.markRecoveryInitialized();
    this.removeLifecycleListeners();
  }

  private async waitForPendingAcceptances(): Promise<void> {
    let firstError: unknown;
    let hasError = false;
    while (this.pendingAcceptances.size > 0) {
      const settled = await Promise.allSettled([...this.pendingAcceptances]);
      if (!hasError) {
        const rejected = settled.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") {
          firstError = rejected.reason;
          hasError = true;
        }
      }
    }
    if (hasError) throw firstError;
  }

  private isTombstoneRecord(value: unknown): boolean {
    if (!isRecord(value) || value["tombstoned"] !== true) return false;
    return (
      typeof value["writeId"] === "string" &&
      typeof value["questionId"] === "string" &&
      typeof value["reason"] === "string" &&
      typeof value["quarantinedAt"] === "string" &&
      isResponsePayload(value["payload"])
    );
  }

  private readTombstone(value: unknown): { writeId: string; reason: string; quarantinedAt: string; payload: ResponsePayload; originLeaseEpoch?: number } | null {
    if (!this.isTombstoneRecord(value) || !isRecord(value)) return null;
    const origin = value["originLeaseEpoch"];
    // exactOptionalPropertyTypes: only set originLeaseEpoch when defined —
    // never assign an explicit undefined to an optional property.
    const tombstone: { writeId: string; reason: string; quarantinedAt: string; payload: ResponsePayload; originLeaseEpoch?: number } = {
      writeId: value["writeId"] as string,
      reason: value["reason"] as string,
      quarantinedAt: value["quarantinedAt"] as string,
      payload: clonePayload(value["payload"] as ResponsePayload),
    };
    if (typeof origin === "number" && Number.isSafeInteger(origin)) {
      tombstone.originLeaseEpoch = origin;
    }
    return tombstone;
  }

  public getTombstonedQuestionIds(): string[] {
    const ids: string[] = [];
    try {
      if (typeof window === "undefined" || !window.localStorage) return ids;
      const prefix = checkpointKey(this.attemptId, "");
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const parsed: unknown = JSON.parse(raw);
          if (this.isTombstoneRecord(parsed)) {
            const questionId = decodeURIComponent(key.slice(prefix.length));
            ids.push(questionId);
          }
        } catch {
          continue;
        }
      }
    } catch {
      return ids;
    }
    return ids;
  }

  private async loadRecoveredPending(): Promise<Map<string, PendingResponseState>> {
    const candidates = new Map<string, PendingResponseState>();
    const consider = (questionId: string, value: unknown) => {
      const tombstone = this.readTombstone(value);
      if (tombstone) {
        this.surfaceTombstonedDraft(questionId, tombstone);
        return;
      }
      if (!isPendingResponseState(value)) return;
      const previous = candidates.get(questionId);
      if (!previous || comparePendingResponses(value, previous) > 0) {
        candidates.set(questionId, {
          ...value,
          payload: clonePayload(value.payload),
        });
      }
    };

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const prefix = checkpointKey(this.attemptId, "");
        const keys: string[] = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        for (const key of keys) {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          try {
            const questionId = decodeURIComponent(key.slice(prefix.length));
            consider(questionId, JSON.parse(raw));
          } catch {
            // Ignore one corrupt checkpoint without losing other questions.
          }
        }
      }
    } catch {
      // IndexedDB may still be available.
    }

    try {
      const prefix = durableDraftKey(this.attemptId, "");
      const drafts = await listDurableDrafts<PendingResponseState>(prefix);
      for (const draft of drafts) {
        const questionId = draft.key.slice(prefix.length);
        consider(questionId, draft.value);
      }
    } catch {
      // Checkpoint recovery remains available when IndexedDB is unavailable.
    }

    return candidates;
  }

  private surfaceTombstonedDraft(
    questionId: string,
    tombstone: { writeId: string; reason: string; quarantinedAt: string; payload: ResponsePayload; originLeaseEpoch?: number }
  ): void {
    const live = this.states.get(questionId)?.pending;
    if (live) return;
    // BUG-5: the surfaced record keeps the tombstone's origin lease so a
    // later reconcile refuses to cross the lease fence it was fenced by.
    const mark: BlockedInfoEx = {
      reason: tombstone.reason,
      blockedAt: tombstone.quarantinedAt,
      originLeaseEpoch: tombstone.originLeaseEpoch ?? this.leaseEpoch,
    };
    // RISK-9/10: synthetic tombstone IDs are per-write
    // (tombstoned-Q-writeId carries the fenced writeId) so two tombstones
    // for the same question never collide, and quarantineEntry must NEVER
    // re-quarantine a synthetic record (guard at entry).
    const fencedWriteId =
      typeof tombstone.writeId === "string" && tombstone.writeId.length > 0
        ? tombstone.writeId
        : questionId;
    const blocked: PendingResponseState = {
      payload: clonePayload(tombstone.payload),
      writeId: `tombstoned-${questionId}-${fencedWriteId}`,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      clientVersion: 0,
      durability: "checkpoint",
      receivedAt: tombstone.quarantinedAt,
      blocked: mark,
    };
    const existing = this.states.get(questionId);
    this.states.set(questionId, { confirmed: existing?.confirmed ?? null, pending: blocked });
  }

  private async rehydrateQuarantineLedger(): Promise<void> {
    try {
      const drafts = await listDurableDrafts<QuarantinedWrite>(`${QUARANTINE_PREFIX}${this.attemptId}:`);
      for (const draft of drafts) {
        const value = draft.value;
        if (!isRecord(value)) continue;
        const record = value as Record<string, unknown>;
        if (typeof record["writeId"] !== "string" || typeof record["questionId"] !== "string") continue;
        if (typeof record["reason"] !== "string" || typeof record["quarantinedAt"] !== "string") continue;
        if (!isResponsePayload(record["payload"])) continue;
        if (this.quarantined.some((entry) => entry.writeId === record["writeId"])) continue;
        this.quarantined.push({
          writeId: record["writeId"] as string,
          questionId: record["questionId"] as string,
          clientVersion: typeof record["clientVersion"] === "number" ? (record["clientVersion"] as number) : 0,
          payload: clonePayload(record["payload"] as ResponsePayload),
          reason: record["reason"] as string,
          quarantinedAt: record["quarantinedAt"] as string,
        });
        // 2B-1: NO silent drop-oldest here — the ledger only shrinks via the
        // two explicit prune triggers (ack-superseded, discard). The cap of
        // 50 counts durable IDB keys; memory growth past it is bounded by
        // prune-on-ack/discard, never by silent eviction.
      }
    } catch {
      // Quarantine rehydration is best-effort; checkpoints still surface drafts.
    }
  }

    private installServerResponse(response: ResponseAcknowledgementV2): void {
    if (!response.questionId || !Number.isSafeInteger(response.clientVersion)) return;
    this.versionTrackers.set(
      response.questionId,
      Math.max(this.versionTrackers.get(response.questionId) ?? 0, response.clientVersion)
    );
    const confirmedVersion = this.confirmedVersions.get(response.questionId) ?? 0;
    const existingState = this.states.get(response.questionId);
    if (
      response.clientVersion < confirmedVersion ||
      (response.clientVersion === confirmedVersion &&
        existingState?.confirmed &&
        response.serverRevision < existingState.confirmed.serverRevision)
    ) {
      return;
    }

    this.confirmedVersions.set(response.questionId, response.clientVersion);
    const existing = this.states.get(response.questionId);
    this.states.set(response.questionId, {
      confirmed: {
        payload: clonePayload(response.canonicalResponse),
        serverRevision: response.serverRevision,
        contentHash: response.contentHash,
      },
      pending: existing?.pending ?? null,
    });
  }

  private async submitInternal(
    submissionId: string,
    expectedAttemptRevision: number,
    revisionRaceRetried = false
  ): Promise<SubmitAttemptV2Response> {
    if (this.isDestroyed) throw new Error("Response durability engine is destroyed.");
    await this.waitForPendingAcceptances();
    if (this.isDraining && this.drainPromise) {
      await this.drainPromise;
    }
    if (this.syncStatus === "conflict_fenced" || this.syncStatus === "conflict_terminal") {
      throw new Error(this.lastError ?? "The attempt is no longer writable.");
    }
    // Providers gate on blocked drafts first; the engine refuses silent
    // exclusion as defense-in-depth so submit can never drop visible work.
    if (this.getBlockedCount() > 0) {
      throw new Error("Blocked drafts need attention before submit. Reconcile or discard them first.");
    }

    const finalCommands = this.collectPendingCommands();
    const request: SubmitAttemptV2Request = {
      submissionId,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      finalCommands,
      expectedAttemptRevision,
    };

    let response: SubmitAttemptV2Response;
    try {
      response = await this.transport.submit(this.attemptId, request);
    } catch (error: unknown) {
      const errorCode = this.extractErrorCode(error);
      // N1: the server's VERSION_COLLISION envelope is overloaded. A
      // submit-time expectedAttemptRevision mismatch (details.expected +
      // details.current, no questionId) is a benign race — a late batch ack or
      // a second session moved response_revision after our snapshot — and the
      // server explicitly asks for a refresh. Refresh the authoritative
      // snapshot and submit again exactly once; only a per-question collision
      // (questionId present) is a genuine terminal version fence.
      if (
        errorCode === "VERSION_COLLISION" &&
        !revisionRaceRetried &&
        this.isSubmitRevisionRace(error)
      ) {
        this.emitDurabilityEvent("submit_revision_refresh", {
          reason: "VERSION_COLLISION",
        });
        await this.recover();
        if (this.isDestroyed) throw error;
        return this.submitInternal(submissionId, this.attemptRevision, true);
      }
      if (this.isTerminalConflict(errorCode)) {
        this.quarantineAllPending(errorCode ?? "SUBMISSION_CONFLICT");
        // RISK-23/6: only a lease fence maps to conflict_fenced. A submit-time
        // CONTROL_EPOCH_STALE is terminal for the submitted attempt
        // (conflict_terminal) — the terminal request already went out, so
        // the drain's block-and-retry path does not apply here.
        this.syncStatus =
          errorCode === "LEASE_FENCED"
            ? "conflict_fenced"
            : "conflict_terminal";
        this.lastError = `Terminal error: ${errorCode ?? "SUBMISSION_CONFLICT"}`;
        this.notifyStatusChange();
        if (errorCode === "VERSION_COLLISION") this.emitDurabilityEvent("version_collision", { reason: errorCode });
      }
      throw error;
    }
    if (this.isDestroyed) return response;
    this.attemptRevision = Math.max(this.attemptRevision, response.attemptRevision);
    this.terminalState = true;

    // A user event can arrive while the terminal request is in flight. Let its
    // durable acceptance finish before quarantining it, otherwise its later
    // IndexedDB completion could enqueue a post-submission write. The receipt
    // itself is still processed if that late browser write failed: the server
    // may already have committed the terminal transition.
    let lateAcceptanceError: unknown = null;
    try {
      await this.waitForPendingAcceptances();
    } catch (error: unknown) {
      lateAcceptanceError = error;
    }

    const acknowledged = new Set<string>();
    for (const acknowledgement of response.acknowledgements) {
      if (this.handleAcknowledgement(acknowledgement)) {
        acknowledged.add(acknowledgement.writeId);
      }
    }

    for (const command of finalCommands) {
      if (acknowledged.has(command.writeId)) continue;
      // The submission receipt is terminal. A malformed/incomplete receipt
      // cannot be retried against a submitted attempt; retain an audit trail
      // instead of silently pretending the write was acknowledged.
      this.removeCommand(command);
      this.quarantineEntry(command, "SUBMISSION_ACK_MISSING");
    }

    // Any edit that arrived while submission was in flight is also unsafe to
    // replay after the terminal receipt.
    for (const command of [...this.outbox.values(), ...this.inFlight.values()]) {
      this.removeCommand(command);
      this.quarantineEntry(command, "SUBMISSION_COMPLETED");
    }
    this.quarantineUnissuedPending("SUBMISSION_COMPLETED");

    if (lateAcceptanceError) {
      this.syncStatus = "durability_fault";
      this.lastError = this.errorMessage(lateAcceptanceError);
      this.notifyStatusChange();
      throw lateAcceptanceError;
    }

    // Bug 5: the terminal receipt clears the server queue, but a draft that is
    // still visible-unacknowledged must not be reported as server-saved.
    if (this.getPendingCount() === 0 && !this.hasUnacknowledgedIntent()) {
      this.syncStatus = "synced";
      this.lastError = null;
      this.notifyStatusChange();
    }
    return response;
  }

  private collectPendingCommands(): ResponseCommandV2[] {
    const commands: ResponseCommandV2[] = [];
    const seen = new Set<string>();
    for (const command of [...this.inFlight.values(), ...this.outbox.values()]) {
      if (seen.has(command.writeId)) continue;
      // Blocked drafts are visible but never sendable without reconcile/discard.
      if (this.isBlockedPending(command.questionId, command.writeId)) continue;
      seen.add(command.writeId);
      commands.push(command);
    }
    return commands;
  }

  private scheduleDrain(immediate = false): void {
    if (this.isDraining || this.isDestroyed || this.retryTimer) return;
    if (this.drainTimer) {
      if (!immediate && !this.drainDebounceMs) return;
      clearTimeout(this.drainTimer);
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (!this.isDraining && !this.isDestroyed && !this.submissionPromise) {
        this.drainPromise = this.drainOutbox();
      }
    }, immediate ? 0 : this.drainDebounceMs);
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer || this.isDestroyed || this.submissionPromise) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.scheduleDrain();
    }, delayMs);
  }

  private async drainOutbox(): Promise<void> {
    if (this.isDraining || this.isDestroyed || this.submissionPromise) return;
    if (this.outbox.size === 0) return;

    this.isDraining = true;
    // BUG-20: a blocked-only outbox must preserve blocked_attention — never
    // claim saving/synced when nothing sendable is on the wire.
    if (
      this.syncStatus !== "conflict_fenced" &&
      this.syncStatus !== "conflict_terminal" &&
      this.syncStatus !== "blocked_attention" &&
      this.hasSendableOutbox()
    ) {
      this.syncStatus = "saving";
      this.notifyStatusChange();
    }

    let retryAttempt = 0;
    let collisionHeals = 0;
    let controlHeals = 0;
    try {
      while (this.outbox.size > 0 && !this.isDestroyed && !this.submissionPromise) {
        this.inFlight.clear();
        // Bug 6: claim ONE bounded chunk per iteration. The server rejects an
        // over-cap envelope (command count or body size) before any mutation,
        // so claiming the whole outbox would strand every otherwise-valid
        // answer behind one oversized batch. The outer loop keeps sending
        // bounded chunks until nothing sendable is left.
        const sendable: ResponseCommandV2[] = [];
        for (const [questionId, command] of this.outbox) {
          // Blocked drafts stay queued in the outbox map but never fly.
          if (this.isBlockedPending(questionId, command.writeId)) continue;
          sendable.push(command);
        }
        const nextChunk = chunkResponseCommands(sendable)[0] ?? [];
        for (const command of nextChunk) {
          this.inFlight.set(command.questionId, command);
        }
        for (const questionId of this.inFlight.keys()) {
          this.outbox.delete(questionId);
        }
        if (this.inFlight.size === 0) break;
        const commands = [...this.inFlight.values()];
        const request: ResponseBatchRequestV2 = {
          leaseEpoch: this.leaseEpoch,
          controlEpoch: this.controlEpoch,
          commands,
        };

        try {
          const batchResponse = await this.transport.sendBatch(this.attemptId, request);
          if (this.isDestroyed) return;
          retryAttempt = 0;
          this.attemptRevision = Math.max(this.attemptRevision, batchResponse.attemptRevision);

          const acknowledged = new Set<string>();
          for (const acknowledgement of batchResponse.acknowledgements) {
            if (this.handleAcknowledgement(acknowledgement)) {
              acknowledged.add(acknowledgement.writeId);
            }
          }

          const missingAcknowledgements: ResponseCommandV2[] = [];
          for (const [questionId, command] of this.inFlight) {
            if (acknowledged.has(command.writeId)) {
              this.inFlight.delete(questionId);
              continue;
            }
            missingAcknowledgements.push(command);
            if (!this.outbox.has(questionId)) {
              this.outbox.set(questionId, command);
            }
            this.inFlight.delete(questionId);
          }

          if (missingAcknowledgements.length > 0) {
            // RISK-6: never downgrade an explicit conflict to saved_locally
            // on a partial batch — the fence stands until reconcile/discard
            // or a fresh ack resolves it.
            if (
              this.syncStatus !== "conflict_fenced" &&
              this.syncStatus !== "conflict_terminal"
            ) {
              this.syncStatus = "saved_locally";
              this.lastError = "Server response omitted one or more write acknowledgements.";
              this.notifyStatusChange();
            }
            this.scheduleRetry(this.calculateJitterBackoff(1));
            break;
          }
        } catch (error: unknown) {
          const errorCode = this.extractErrorCode(error);
          // N1b: a per-question VERSION_COLLISION is a stale-floor symptom, not
          // necessarily a divergent writer. Refresh the authoritative version
          // floor for the offending question, re-issue its payload ABOVE that
          // floor as a new write, and re-drain — quarantine the whole outbox
          // only when the heal cannot help (no questionId, no snapshot, a
          // lease change, a blocked draft, or a server that keeps rejecting).
          if (
            errorCode === "VERSION_COLLISION" &&
            collisionHeals < MAX_COLLISION_HEALS_PER_DRAIN
          ) {
            const collidingQuestionId = this.extractCollisionQuestionId(error);
            const healed =
              collidingQuestionId !== null &&
              !this.isDestroyed &&
              (await this.recoverVersionCollision(collidingQuestionId));
            if (healed) {
              collisionHeals += 1;
              retryAttempt = 0;
              for (const [questionId, command] of this.inFlight) {
                if (!this.outbox.has(questionId)) this.outbox.set(questionId, command);
              }
              this.inFlight.clear();
              continue;
            }
          }
          // Retryable reason (SECTION_CLOCK_MISSING) falls through to the
          // bounded retry below — quarantining it would strand answers that
          // the next cohort-start bootstrap would accept.
          if (this.isTerminalConflict(errorCode) && !this.isRetryableConflictReason(error)) {
            // RISK-23: CONTROL_EPOCH_STALE is the control-only fence — it
            // follows the blocked/reconcilable path (mirrors
            // blockPendingOnControlBump), never the quarantine path. Only
            // lease-stale and true terminal codes fence/quarantine here.
            if (errorCode === "CONTROL_EPOCH_STALE") {
              // A control-only skew (same lease, attempt running, server
              // holds nothing newer) is healed in place: re-read the
              // authoritative epoch and re-issue the drafts under it. Only
              // when that is not provably safe do the drafts fall through to
              // the blocked/reconcilable posture below.
              if (controlHeals < MAX_CONTROL_EPOCH_HEALS_PER_DRAIN && !this.isDestroyed) {
                const healed = await this.recoverControlEpochSkew();
                if (this.isDestroyed) return;
                if (healed) {
                  controlHeals += 1;
                  retryAttempt = 0;
                  continue;
                }
              }
              for (const [questionId, command] of this.inFlight) {
                if (!this.outbox.has(questionId)) this.outbox.set(questionId, command);
              }
              this.inFlight.clear();
              this.blockQueuedOnControlStale();
              break;
            }
            // A heal in this drain adopted the server's epoch and re-issued
            // the drafts, so the fence itself is satisfied; when the very
            // next envelope is refused by the writability gate (runtime
            // waiting for the next section, section not started, attempt
            // paused a moment after the snapshot) the control change was a
            // gate, not a terminal state. Those drafts take the same blocked,
            // re-checkable posture the fence would have given them — never
            // the quarantine a true terminal code earns.
            if (controlHeals > 0 && errorCode === "ATTEMPT_NOT_WRITABLE") {
              for (const [questionId, command] of this.inFlight) {
                if (!this.outbox.has(questionId)) this.outbox.set(questionId, command);
              }
              this.inFlight.clear();
              this.blockQueuedOnControlStale("ATTEMPT_NOT_WRITABLE");
              break;
            }
            // Bug 6: a payload-scoped rejection (one invalid answer, one
            // unknown question or reused write id) is about THIS envelope, not
            // the attempt. Quarantine only the chunk that was rejected — still
            // visible, still audited, never a silent drop — and keep delivering
            // the other questions' answers instead of stranding the backlog
            // behind one bad command.
            if (this.isChunkScopedRejection(errorCode)) {
              for (const command of this.inFlight.values()) {
                this.removeCommand(command);
                this.quarantineEntry(command, errorCode ?? "TERMINAL_CONFLICT");
              }
              this.inFlight.clear();
              // Explicit conflict/fault/blocked states are never downgraded
              // here — only a plain saved/saving claim is corrected.
              if (
                this.syncStatus !== "conflict_fenced" &&
                this.syncStatus !== "conflict_terminal" &&
                this.syncStatus !== "durability_fault" &&
                this.syncStatus !== "blocked_attention"
              ) {
                this.syncStatus = "saved_locally";
                this.lastError =
                  "One answer was refused by the server and is kept on this device; the rest keep sending.";
                this.notifyStatusChange();
              }
              continue;
            }
            this.quarantineAllPending(errorCode ?? "TERMINAL_CONFLICT");
            this.syncStatus =
              errorCode === "LEASE_FENCED"
                ? "conflict_fenced"
                : "conflict_terminal";
            this.lastError = `Terminal error: ${errorCode}`;
            this.notifyStatusChange();
            if (errorCode === "VERSION_COLLISION") this.emitDurabilityEvent("version_collision", { reason: errorCode });
            break;
          }

          for (const [questionId, command] of this.inFlight) {
            if (!this.outbox.has(questionId)) this.outbox.set(questionId, command);
          }
          this.inFlight.clear();
          retryAttempt += 1;
          if (retryAttempt >= MAX_RETRY_ATTEMPTS_PER_DRAIN) {
            // RISK-6: retry exhaustion never clears an explicit conflict.
            if (
              this.syncStatus !== "conflict_fenced" &&
              this.syncStatus !== "conflict_terminal"
            ) {
              this.syncStatus = "saved_locally";
              this.lastError = this.errorMessage(error);
              this.notifyStatusChange();
            }
            this.scheduleRetry(this.calculateJitterBackoff(retryAttempt));
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, this.calculateJitterBackoff(retryAttempt))
          );
        }
      }

      if (
        this.outbox.size === 0 &&
        this.inFlight.size === 0 &&
        // Bug 5: the queue is empty, but a visible draft may still be
        // unacknowledged (a provisional intent awaiting its version). "Saved"
        // is a claim about the server, so it needs the queue AND the intents.
        !this.hasUnacknowledgedIntent() &&
        this.syncStatus !== "conflict_fenced" &&
        this.syncStatus !== "conflict_terminal" &&
        this.syncStatus !== "blocked_attention" &&
        this.syncStatus !== "durability_fault"
      ) {
        this.syncStatus = "synced";
        this.lastError = null;
        this.notifyStatusChange();
      } else if (
        // Bug 5: nothing left to send and nothing in flight — but a draft is
        // still unacknowledged. Queue length cannot see it, and claiming
        // server-saved here is exactly the false durability signal this gate
        // must never emit.
        this.outbox.size === 0 &&
        this.inFlight.size === 0 &&
        this.hasUnacknowledgedIntent() &&
        this.syncStatus !== "conflict_fenced" &&
        this.syncStatus !== "conflict_terminal" &&
        this.syncStatus !== "blocked_attention" &&
        this.syncStatus !== "durability_fault" &&
        this.syncStatus !== "saved_locally"
      ) {
        this.syncStatus = "saved_locally";
        this.lastError = null;
        this.notifyStatusChange();
      } else if (
        // BUG-20: blocked-only remainder keeps blocked_attention honest.
        (this.outbox.size > 0 || this.inFlight.size > 0) &&
        !this.hasSendableOutbox() &&
        this.getBlockedCount() > 0 &&
        this.syncStatus !== "conflict_fenced" &&
        this.syncStatus !== "conflict_terminal"
      ) {
        if (this.syncStatus !== "blocked_attention") {
          this.syncStatus = "blocked_attention";
          this.lastError =
            "Exam timing changed. Your latest answers are kept on this device and need re-check.";
          this.notifyStatusChange();
        }
      } else if (
        this.getBlockedCount() > 0 &&
        this.syncStatus === "synced"
      ) {
        // Defensive: blocked drafts visible means we were never fully synced.
        this.syncStatus = "blocked_attention";
        this.lastError =
          "Exam timing changed. Your latest answers are kept on this device and need re-check.";
        this.notifyStatusChange();
      }
    } finally {
      this.isDraining = false;
      this.drainPromise = null;
    }
  }

  /** Returns true only for an acknowledgement belonging to an issued command. */
  private handleAcknowledgement(acknowledgement: ResponseAcknowledgementV2): boolean {
    const issued = this.issuedCommands.get(acknowledgement.writeId);
    if (!issued) return false;
    if (
      issued.questionId !== acknowledgement.questionId ||
      issued.clientVersion !== acknowledgement.clientVersion
    ) {
      return false;
    }

    this.issuedCommands.delete(acknowledgement.writeId);
    this.commandEpochs.delete(acknowledgement.writeId);
    if (this.outbox.get(acknowledgement.questionId)?.writeId === acknowledgement.writeId) {
      this.outbox.delete(acknowledgement.questionId);
    }
    if (this.inFlight.get(acknowledgement.questionId)?.writeId === acknowledgement.writeId) {
      this.inFlight.delete(acknowledgement.questionId);
    }
    this.versionTrackers.set(
      acknowledgement.questionId,
      Math.max(
        this.versionTrackers.get(acknowledgement.questionId) ?? 0,
        acknowledgement.clientVersion
      )
    );

    const confirmedVersion = this.confirmedVersions.get(acknowledgement.questionId) ?? 0;
    if (acknowledgement.clientVersion >= confirmedVersion) {
      this.confirmedVersions.set(acknowledgement.questionId, acknowledgement.clientVersion);
      const existing = this.states.get(acknowledgement.questionId);
      const nextConfirmed: ConfirmedResponseState = {
        payload: clonePayload(acknowledgement.canonicalResponse),
        serverRevision: acknowledgement.serverRevision,
        contentHash: acknowledgement.contentHash,
      };
      this.states.set(acknowledgement.questionId, {
        confirmed: nextConfirmed,
        pending: existing?.pending ?? null,
      });
    }

    const existing = this.states.get(acknowledgement.questionId);
    // BUG-1: an ack must never clear a blocked pending draft. A blocked draft
    // stays visible until reconcile/discard; the ack only advances confirmed.
    if (existing?.pending?.writeId === acknowledgement.writeId && !existing.pending.blocked) {
      this.states.set(acknowledgement.questionId, {
        confirmed: existing.confirmed,
        pending: null,
      });
      this.clearCheckpoint(acknowledgement.questionId);
    }
    // 2B-1(a): a server ack of a write supersedes quarantined entries for
    // the same question — prune their durable keys + memory + event.
    this.pruneQuarantined(acknowledgement.questionId, "ack-superseded");
    // RISK-6: a fresh server ack is the third explicit-resolution signal — it
    // clears a lingering conflict only when nothing remains blocked or
    // quarantined. Drains and epoch events never clear it implicitly.
    this.clearConflictOnExplicitResolution();
    this.notifyStateChange();
    return true;
  }

  private fenceTerminalSnapshot(serverResponses: readonly ResponseAcknowledgementV2[]): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const serverWrites = new Map(serverResponses.map((response) => [response.writeId, response]));
    const commands = new Map<string, ResponseCommandV2>();
    for (const command of [
      ...this.issuedCommands.values(),
      ...this.outbox.values(),
      ...this.inFlight.values(),
    ]) {
      commands.set(command.writeId, command);
    }

    for (const command of commands.values()) {
      // BUG-14/22: never fence past live-newer input. A clientVersion 0
      // provisional (or any newer writeId) typed after recovery started
      // reading is newer than the fenced write — keep it visible.
      const liveBefore = this.states.get(command.questionId)?.pending;
      if (liveBefore && liveBefore.writeId !== command.writeId) {
        this.removeCommand(command);
        this.quarantineEntry(command, "TERMINAL_CONFLICT");
        continue;
      }
      const acknowledged = serverWrites.get(command.writeId);
      if (
        acknowledged &&
        acknowledged.questionId === command.questionId &&
        acknowledged.clientVersion === command.clientVersion
      ) {
        this.removeCommand(command);
        // BUG-14/22: an acked write clears pending only when it IS the live
        // write with a real issued version; a live-newer v0 provisional is
        // never acked and keeps its input visible.
        const state = this.states.get(command.questionId);
        if (state?.pending?.writeId === command.writeId && state.pending.clientVersion > 0) {
          this.states.set(command.questionId, {
            confirmed: state.confirmed,
            pending: null,
          });
          this.clearCheckpoint(command.questionId);
        }
        continue;
      }

      this.removeCommand(command);
      this.quarantineEntry(command, "TERMINAL_CONFLICT");
    }
    this.quarantineUnissuedPending("TERMINAL_CONFLICT");
    this.terminalState = true;
    this.syncStatus = "conflict_terminal";
    this.lastError = "Attempt is closed and does not accept new responses.";
    this.notifyStatusChange();
  }

  private quarantineUnissuedPending(reason: string): void {
    const commands = new Map<string, ResponseCommandV2>();
    for (const [questionId, state] of this.states) {
      const pending = state.pending;
      if (!pending) continue;
      // BUG-14/22: a live-newer v0 provisional (typed after recovery started
      // reading, never issued) is newer than any fenced write. The terminal
      // snapshot fence must keep it visible instead of tombstoning it away.
      if (reason === "TERMINAL_CONFLICT" && pending.clientVersion <= 0) continue;
      if (
        this.issuedCommands.has(pending.writeId) ||
        this.outbox.get(questionId)?.writeId === pending.writeId ||
        this.inFlight.get(questionId)?.writeId === pending.writeId
      ) {
        continue;
      }
      commands.set(pending.writeId, {
        writeId: pending.writeId,
        questionId,
        clientVersion: pending.clientVersion,
        response: clonePayload(pending.payload),
      });
    }
    for (const command of commands.values()) {
      this.quarantineEntry(command, reason);
    }
  }

  private quarantineAllPending(reason: string): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const commands = new Map<string, ResponseCommandV2>();
    for (const command of [
      ...this.inFlight.values(),
      ...this.outbox.values(),
      ...this.issuedCommands.values(),
    ]) {
      commands.set(command.writeId, command);
    }
    for (const command of commands.values()) {
      this.removeCommand(command);
      this.quarantineEntry(command, reason);
    }
  }

  private quarantineCommandsOutsideCurrentEpoch(reason: string): void {
    const commands = new Map<string, ResponseCommandV2>();
    for (const [writeId, command] of this.issuedCommands) {
      const epoch = this.commandEpochs.get(writeId);
      if (
        epoch &&
        (epoch.leaseEpoch !== this.leaseEpoch || epoch.controlEpoch !== this.controlEpoch)
      ) {
        commands.set(writeId, command);
      }
    }
    for (const command of commands.values()) {
      this.removeCommand(command);
      this.quarantineEntry(command, reason);
    }
  }

  /**
   * RISK-23 mirror of blockPendingOnControlBump for the drain failure path:
   * a control-only fence keeps every still-queued draft visible as blocked
   * (reconcilable) instead of quarantining it away. Lease fences never come
   * here — they keep the strict quarantine path.
   */
  private blockQueuedOnControlStale(
    reason: "CONTROL_EPOCH_STALE" | "ATTEMPT_NOT_WRITABLE" = "CONTROL_EPOCH_STALE"
  ): void {
    let blockedAny = false;
    const touch = (command: ResponseCommandV2): void => {
      const pending = this.states.get(command.questionId)?.pending;
      if (!pending || pending.writeId !== command.writeId || pending.blocked) return;
      const mark: BlockedInfoEx = {
        reason: "EPOCH_STALE",
        blockedAt: new Date().toISOString(),
        originLeaseEpoch: pending.leaseEpoch,
      };
      pending.blocked = mark;
      this.checkpointIntentSync(command.questionId, pending);
      this.emitDurabilityEvent("control_epoch_blocked", {
        reason,
        controlEpoch: this.controlEpoch,
      });
      blockedAny = true;
    };
    for (const command of [...this.outbox.values(), ...this.inFlight.values()]) {
      touch(command);
    }
    for (const command of this.issuedCommands.values()) {
      touch(command);
    }
    if (blockedAny) {
      this.syncStatus = "blocked_attention";
      this.lastError =
        "Exam timing changed. Your latest answers are kept on this device and need re-check.";
      this.notifyStateChange();
      this.notifyStatusChange();
    }
  }

  /**
   * RISK-6: conflict states clear ONLY on a user-visible reconcile/discard
   * or a fresh server acknowledgement — never silently on a later drain or
   * epoch event. Central gate for the two explicit-clear call sites.
   */
  private clearConflictOnExplicitResolution(): void {
    if (
      this.terminalState ||
      (this.syncStatus !== "conflict_fenced" && this.syncStatus !== "conflict_terminal")
    ) {
      return;
    }
    if (
      this.getBlockedCount() > 0 ||
      this.quarantined.length > 0 ||
      // Bug 5: an unacknowledged draft is not "resolved" either — a fresh ack
      // for it clears the fence once it actually lands.
      this.hasUnacknowledgedIntent()
    ) {
      return;
    }
    this.syncStatus = "synced";
    this.lastError = null;
    this.notifyStatusChange();
  }

  private removeCommand(command: ResponseCommandV2): void {
    if (this.outbox.get(command.questionId)?.writeId === command.writeId) {
      this.outbox.delete(command.questionId);
    }
    if (this.inFlight.get(command.questionId)?.writeId === command.writeId) {
      this.inFlight.delete(command.questionId);
    }
    this.issuedCommands.delete(command.writeId);
    this.commandEpochs.delete(command.writeId);
  }

  /**
   * Timing-only control bump (pause/resume/extend): keep every unsent draft
   * visible in place and mark it blocked (I4) instead of quarantining it
   * away. Lease changes keep the strict quarantine fence (I6).
   */
  private blockPendingOnControlBump(): void {
    let blockedAny = false;
    for (const [questionId, state] of this.states) {
      const pending = state.pending;
      if (!pending || pending.blocked) continue;
      // BUG-5: the blocked record carries its origin lease (engine-only) so
      // reconcile can refuse to cross a lease fence.
      const mark: BlockedInfoEx = {
        reason: "EPOCH_STALE",
        blockedAt: new Date().toISOString(),
        originLeaseEpoch: pending.leaseEpoch,
      };
      pending.blocked = mark;
      // Re-checkpoint so reload preserves the blocked draft, not a stale copy.
      this.checkpointIntentSync(questionId, pending);
      this.emitDurabilityEvent("control_epoch_blocked", { reason: "CONTROL_EPOCH_STALE", controlEpoch: this.controlEpoch });
      blockedAny = true;
    }
    if (blockedAny) {
      this.syncStatus = "blocked_attention";
      this.lastError = "Exam timing changed. Your latest answers are kept on this device and need re-check.";
      this.notifyStateChange();
      this.notifyStatusChange();
    }
  }

  /**
   * True when a command must never be sent without a decision.
   * BUG-1/21: a stale outbox entry (W1) must not fly just because live
   * pending moved on to a blocked W2 — any command for a question with a
   * blocked pending is non-sendable, as is any command whose enqueue-time
   * epochs no longer match the live fence.
   */
  private isBlockedPending(questionId: string, writeId: string): boolean {
    const pending = this.states.get(questionId)?.pending;
    if (pending?.blocked) return true;
    const epoch = this.commandEpochs.get(writeId);
    if (
      epoch &&
      (epoch.leaseEpoch !== this.leaseEpoch || epoch.controlEpoch !== this.controlEpoch)
    ) {
      return true;
    }
    return false;
  }

  /** True when the outbox holds at least one draft that is allowed to fly. */
  private hasSendableOutbox(): boolean {
    for (const [questionId, command] of this.outbox) {
      if (!this.isBlockedPending(questionId, command.writeId)) return true;
    }
    return false;
  }

  /**
   * Reconcile one blocked draft after a timing-only control change: adopt a
   * fresh snapshot, then re-issue the blocked payload as a NEW write under
   * the current epoch. Refuses (returns false, stays blocked) on lease
   * change, terminal delivery status, fetch failure, or server-newer state.
   */
  public async reconcileBlocked(questionId: string): Promise<boolean> {
    // BUG-7/8 + RISK-24: per-question mutex — concurrent reconciles for Q
    // would each re-issue the same blocked payload as a new write (duplicate
    // sends). The same guard also covers the recover-triggered path: recover
    // skips installing or issuing for a question while its reconcile is in
    // flight (see recoverInternal), so a snapshot refresh racing a reconcile
    // can neither resurrect the fenced write nor steal its version mint.
    if (this.reconciling.has(questionId)) {
      this.emitDurabilityEvent("reconcile_failed", { reason: "reconcile_in_progress" });
      return false;
    }
    const blocked = this.states.get(questionId)?.pending;
    if (!blocked?.blocked) return false;
    const blockedWriteId = blocked.writeId;
    // BUG-5: the blocked record carries its origin lease; a lease fence
    // crossed since the block must refuse, never re-issue across the fence.
    const originLease = readBlockedOriginLease(blocked);
    if (this.isDestroyed || this.terminalState || this.submissionPromise) { this.emitDurabilityEvent("reconcile_failed", { reason: "engine_not_writable" }); return false; }
    this.reconciling.add(questionId);
    try {
    let snapshot: SnapshotResponse;
    try {
      // F-A6: timeout surfaces as retryable, exactly like a fetch failure:
      // the blocked draft stays queued, reconcile_failed snapshot_fetch_failed
      // is emitted, nothing is dropped and the caller can retry.
      snapshot = await fetchSnapshotWithTimeout(
        (attemptId) => this.transport.fetchSnapshot(attemptId),
        this.attemptId
      );
    } catch {
      this.emitDurabilityEvent("reconcile_failed", { reason: "snapshot_fetch_failed" });
      return false;
    }
    // BUG-7/8: re-validate after EVERY await before touching shared state.
    const afterFetch = this.states.get(questionId)?.pending;
    if (this.terminalState || this.submissionPromise) { this.emitDurabilityEvent("reconcile_failed", { reason: "engine_not_writable" }); return false; }
    if (!afterFetch || afterFetch.writeId !== blockedWriteId || !afterFetch.blocked) { this.emitDurabilityEvent("reconcile_failed", { reason: "blocked_superseded" }); return false; }
    if (!isSnapshotResponse(snapshot)) { this.emitDurabilityEvent("reconcile_failed", { reason: "snapshot_not_authoritative" }); return false; }
    if (["submitted", "terminated", "locked", "cancelled"].includes(snapshot.deliveryStatus)) { this.emitDurabilityEvent("reconcile_failed", { reason: "attempt_terminal" }); return false; }
    if (snapshot.leaseEpoch !== this.leaseEpoch || originLease !== this.leaseEpoch) { this.emitDurabilityEvent("reconcile_failed", { reason: "lease_changed" }); return false; }
    if (this.isDestroyed || this.terminalState || this.submissionPromise) { this.emitDurabilityEvent("reconcile_failed", { reason: "engine_not_writable" }); return false; }
    const afterGuard = this.states.get(questionId)?.pending;
    if (!afterGuard || afterGuard.writeId !== blockedWriteId || !afterGuard.blocked) { this.emitDurabilityEvent("reconcile_failed", { reason: "blocked_superseded" }); return false; }
    this.attemptRevision = Math.max(this.attemptRevision, snapshot.attemptRevision);
    this.updateEpochs(snapshot.leaseEpoch, snapshot.controlEpoch);
    for (const response of snapshot.responses) {
      this.installServerResponse(response);
    }
    const live = this.states.get(questionId)?.pending;
    if (this.terminalState || this.submissionPromise) { this.emitDurabilityEvent("reconcile_failed", { reason: "engine_not_writable" }); return false; }
    if (!live || live.writeId !== blockedWriteId || !live.blocked) { this.emitDurabilityEvent("reconcile_failed", { reason: "blocked_superseded" }); return false; }
    // Refuse only when the server actually moved past the blocked draft: a
    // different writeId alone is normal (it is the last confirmed write the
    // blocked draft was edited on top of). Version comparison decides — but a
    // never-issued draft (clientVersion 0) has no server footprint to lose to:
    // the mint below starts ABOVE the refreshed floor, so refusing here would
    // strand the recovered Bug 1 intent as permanently blocked.
    const server = snapshot.responses.find((entry) => entry.questionId === questionId);
    const neverIssuedDraft = live.clientVersion <= 0;
    if (!neverIssuedDraft && server && server.writeId !== blocked.writeId && server.clientVersion >= live.clientVersion) { this.emitDurabilityEvent("reconcile_failed", { reason: "server_newer" }); return false; }
    // RISK-9/10: re-read the version tracker AFTER the snapshot await —
    // installServerResponse above (and any concurrent recover/ack path)
    // raises the floor. Capture the mint base now and revalidate before
    // enqueue: a floor that moved past our mint means a stale version, which
    // the backend would terminally reject as VERSION_COLLISION. Never mint
    // stale — refuse instead and let the caller retry against fresh state.
    const mintBase = Math.max(
      this.versionTrackers.get(questionId) ?? 0,
      server && server.questionId === questionId ? server.clientVersion : 0
    );
    const issuedVersion = mintBase + 1;
    this.versionTrackers.set(questionId, issuedVersion);
    const writeId = randomWriteId();
    const payload = clonePayload(live.payload);
    // exactOptionalPropertyTypes: only carry receivedAt/order when defined —
    // never assign an explicit undefined to an optional property.
    const pending: PendingResponseState = {
      payload,
      writeId,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      clientVersion: issuedVersion,
      durability: live.durability,
    };
    if (live.receivedAt !== undefined) pending.receivedAt = live.receivedAt;
    if (live.order !== undefined) pending.order = live.order;
    this.states.set(questionId, {
      confirmed: this.states.get(questionId)?.confirmed ?? null,
      pending,
    });
    this.checkpointIntentSync(questionId, pending);
    try {
      await saveDurableDraft(durableDraftKey(this.attemptId, questionId), pending);
    } catch {
      // Checkpoint above is the teardown-safe copy; IDB follows best-effort.
    }
    // BUG-7/8: the save above awaited — states now holds the NEW re-issued
    // write, so compare against the new writeId: a mismatch means someone
    // typed over our re-issue during the save (their write is preserved, we
    // just skip enqueue).
    const afterSave = this.states.get(questionId)?.pending;
    if (this.isDestroyed || this.terminalState || this.submissionPromise) { this.emitDurabilityEvent("reconcile_failed", { reason: "engine_not_writable" }); return false; }
    if (!afterSave || afterSave.writeId !== writeId) { this.emitDurabilityEvent("reconcile_failed", { reason: "blocked_superseded" }); return false; }
    // RISK-9/10 mint revalidation: the save await above can race a server
    // response that raised the version floor past our mint. Enqueuing the
    // stale version would draw a terminal VERSION_COLLISION; refuse instead
    // (blocked write is preserved in place) so the caller can retry fresh.
    if ((this.versionTrackers.get(questionId) ?? 0) > issuedVersion) { this.emitDurabilityEvent("reconcile_failed", { reason: "blocked_superseded" }); return false; }
    const command: ResponseCommandV2 = { writeId, questionId, clientVersion: issuedVersion, response: payload };
    this.outbox.set(questionId, command);
    this.issuedCommands.set(writeId, command);
    this.commandEpochs.set(writeId, { leaseEpoch: this.leaseEpoch, controlEpoch: this.controlEpoch });
    // RISK-6: reconcile is a user-visible explicit resolution — the success
    // path below owns conflict clearing (blocked_attention -> saved_locally).
    // A lingering conflict clears only when nothing remains fenced or
    // quarantined (see clearConflictOnExplicitResolution).
    if (this.getBlockedCount() === 0 && this.syncStatus === "blocked_attention") {
      this.syncStatus = "saved_locally";
      this.lastError = null;
      this.notifyStatusChange();
    }
    this.clearConflictOnExplicitResolution();
    this.notifyStateChange();
    this.scheduleDrain();
    this.emitDurabilityEvent("reconcile_succeeded");
    return true;
    } finally {
      this.reconciling.delete(questionId);
    }
  }

  /**
   * Explicit user discard of one blocked draft (providers confirm + audit
   * before calling). Removes visible pending, checkpoints, drafts, and
   * related quarantine audit entries. Never touches confirmed state.
   */
  public discardBlocked(questionId: string): boolean {
    const pending = this.states.get(questionId)?.pending;
    if (!pending?.blocked) return false;
    // BUG-3: discard is per-question, not per-writeId. Remove the outbox /
    // in-flight slot for Q plus EVERY issued command ever recorded for Q, so
    // no stale writeId for this question can fly after the discard.
    const tracked = this.outbox.get(questionId);
    if (tracked) this.removeCommand(tracked);
    const flying = this.inFlight.get(questionId);
    if (flying) this.removeCommand(flying);
    for (const [writeId, command] of [...this.issuedCommands]) {
      if (command.questionId === questionId) {
        this.issuedCommands.delete(writeId);
        this.commandEpochs.delete(writeId);
      }
    }
    this.states.set(questionId, {
      confirmed: this.states.get(questionId)?.confirmed ?? null,
      pending: null,
    });
    // 2B-1(b): explicit discard prunes durable quarantine keys for Q +
    // memory + event (never silently).
    this.pruneQuarantined(questionId, "discard");
    this.clearCheckpoint(questionId);
    if (this.getBlockedCount() === 0 && this.syncStatus === "blocked_attention") {
      this.syncStatus =
        this.getPendingCount() === 0 && !this.hasUnacknowledgedIntent() ? "synced" : "saved_locally";
      this.lastError = null;
      this.notifyStatusChange();
    }
    // RISK-6: discard is a user-visible explicit resolution — it may clear a
    // lingering conflict once nothing remains blocked or quarantined.
    this.clearConflictOnExplicitResolution();
    this.notifyStateChange();
    return true;
  }

  private quarantinePending(
    questionId: string,
    pending: PendingResponseState,
    reason: string
  ): void {
    const command: ResponseCommandV2 = {
      writeId: pending.writeId,
      questionId,
      clientVersion: pending.clientVersion,
      response: clonePayload(pending.payload),
    };
    this.quarantineEntry(command, reason);
  }

  private clearRecoveredWrite(questionId: string, writeId: string): void {
    const command =
      this.issuedCommands.get(writeId) ??
      (this.outbox.get(questionId)?.writeId === writeId
        ? this.outbox.get(questionId)
        : undefined) ??
      (this.inFlight.get(questionId)?.writeId === writeId
        ? this.inFlight.get(questionId)
        : undefined);
    if (command) {
      this.removeCommand(command);
    } else {
      this.issuedCommands.delete(writeId);
      this.commandEpochs.delete(writeId);
    }

    const state = this.states.get(questionId);
    const canClearDurableDraft = !state?.pending || state.pending.writeId === writeId;
    if (state?.pending?.writeId === writeId) {
      this.states.set(questionId, {
        confirmed: state.confirmed,
        pending: null,
      });
      this.notifyStateChange();
    }
    if (canClearDurableDraft) {
      this.clearCheckpoint(questionId);
    }
  }

  /** Synthetic tombstone IDs (tombstoned-Q-*) are audit surface only — never re-fenced. */
  private isSyntheticTombstoneWriteId(writeId: string): boolean {
    return writeId.startsWith("tombstoned-");
  }

  /**
   * 2B-1 spec-exact prune: the quarantine ledger cap (50) counts DURABLE IDB
   * keys, not just memory. Pruning happens ONLY on (a) server ack of a
   * replacement write (reason 'ack-superseded') or (b) explicit discardBlocked
   * (reason 'discard') — never on any other trigger. Each prune deletes the
   * durable IDB key, splices memory, and emits quarantine_pruned with
   * reason/epoch/ID fields only (never payload content).
   */
  private pruneQuarantined(questionId: string, reason: "ack-superseded" | "discard"): void {
    let pruned = 0;
    for (let index = this.quarantined.length - 1; index >= 0; index -= 1) {
      const candidate = this.quarantined[index];
      if (candidate?.questionId !== questionId) continue;
      this.quarantined.splice(index, 1);
      pruned += 1;
      void clearDurableDraft(quarantineDraftKey(this.attemptId, candidate.writeId)).catch(
        () => undefined
      );
    }
    if (pruned > 0) {
      this.emitDurabilityEvent("quarantine_pruned", {
        reason,
        questionId,
        count: pruned,
      });
    }
  }

  private quarantineEntry(command: ResponseCommandV2, reason: string): void {
    // RISK-9/10: NEVER re-quarantine a synthetic tombstone record. Surfaced
    // tombstones are visible-but-blocked audit surface; fencing them again
    // would tombstone the tombstone and lose the quarantine audit trail.
    if (this.isSyntheticTombstoneWriteId(command.writeId)) return;
    if (this.quarantined.some((entry) => entry.writeId === command.writeId)) return;
    const entry: QuarantinedWrite = {
      writeId: command.writeId,
      questionId: command.questionId,
      clientVersion: command.clientVersion,
      payload: clonePayload(command.response),
      reason,
      quarantinedAt: new Date().toISOString(),
    };
    this.quarantined.push(entry);
    // 2B-1: NO silent drop-oldest shift() — the 50-ledger cap counts durable
    // IDB keys and the ledger only shrinks via explicit prune triggers
    // (ack-superseded, discard) with durable deletes + quarantine_pruned
    // events. A silent shift would evict audit evidence without deleting its
    // durable key, diverging memory from IDB.

    // BUG-14/22: a live-newer intent for the same question must never be
    // clobbered — terminal path included. A stale command contributes only
    // the audit entry above; archiving/tombstoning its writeId would erase
    // the student's newest keystrokes.
    const live = this.states.get(command.questionId)?.pending;
    if (live && live.writeId !== command.writeId) {
      return;
    }

    // Archive windows (BUG-15/16/17, F-A5): keep the draft visible as
    // BLOCKED — never null — until the quarantine record is durable, so a
    // crash/teardown between quarantine and archive cannot lose the last copy.
    const existing = this.states.get(command.questionId);
    if (existing?.pending?.writeId === command.writeId && !existing.pending.blocked) {
      const mark: BlockedInfoEx = {
        reason,
        blockedAt: new Date().toISOString(),
        originLeaseEpoch: this.commandOriginLease(command),
      };
      existing.pending.blocked = mark;
      this.checkpointIntentSync(command.questionId, existing.pending);
      this.notifyStateChange();
    }

    const generation = this.engineGeneration;
    const questionId = command.questionId;
    const writeId = command.writeId;
    // I5 archive-before-delete: the source checkpoint/draft is removed only
    // after the quarantine audit record is durable. Archive failure keeps the
    // source and raises durability_fault instead of losing the last copy.
    void (async () => {
      try {
        await saveDurableDraft(quarantineDraftKey(this.attemptId, writeId), entry);
      } catch {
        this.syncStatus = "durability_fault";
        this.lastError = "Could not archive a blocked answer. Your work is kept on this device.";
        this.notifyStatusChange();
        this.emitDurabilityEvent("quarantine_failed", { reason: "quarantine_archive_failed" });
        return;
      }
      // A destroy/replace during the archive aborts: never write tombstones
      // for a dead engine generation.
      if (generation !== this.engineGeneration || this.isDestroyed) return;
      this.emitDurabilityEvent("quarantine_archived", { reason });
      // BUG-14/22 re-check: a live-newer intent (including a v0 provisional
      // typed after the fence) wins over the tombstone — never erase it.
      const current = this.states.get(questionId)?.pending;
      if (current && current.writeId !== writeId) return;
      // Same-key tombstone write: atomic for localStorage readers, so a
      // crash between archive and delete cannot resurrect a sendable draft.
      // BUG-5: the tombstone carries the origin lease (engine-only, never on
      // the wire) so recovery-time reconcile refuses to cross a lease fence.
      let tombstoneOk = false;
      const hasSyncStore =
        typeof window !== "undefined" && Boolean(window.localStorage);
      try {
        if (hasSyncStore) {
          window.localStorage.setItem(
            checkpointKey(this.attemptId, questionId),
            JSON.stringify({
              tombstoned: true,
              writeId,
              questionId,
              reason,
              quarantinedAt: entry.quarantinedAt,
              originLeaseEpoch: this.commandOriginLease(command),
              payload: clonePayload(command.response),
            })
          );
        }
        tombstoneOk = true;
      } catch {
        tombstoneOk = false;
      }
      if (!tombstoneOk && hasSyncStore) {
        // Tombstone-write failure: retain the source checkpoint AND the IDB
        // draft, raise a fault — never clear the last durable copy.
        this.syncStatus = "durability_fault";
        this.lastError = "Could not archive a blocked answer. Your work is kept on this device.";
        this.notifyStatusChange();
        this.emitDurabilityEvent("quarantine_failed", { reason: "quarantine_archive_failed" });
        return;
      }
      // Only clear the visible draft when the tombstone landed for THIS
      // write; a newer intent keeps its checkpoint.
      const still = this.states.get(questionId)?.pending;
      if (still && still.writeId === writeId) {
        this.states.set(questionId, {
          confirmed: this.states.get(questionId)?.confirmed ?? null,
          pending: null,
        });
        this.notifyStateChange();
      }
      void clearDurableDraft(durableDraftKey(this.attemptId, questionId)).catch(
        () => undefined
      );
    })();
  }

  private clearCheckpoint(questionId: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(checkpointKey(this.attemptId, questionId));
      }
    } catch {
      // The IndexedDB clear below is still attempted.
    }
    void clearDurableDraft(durableDraftKey(this.attemptId, questionId)).catch(() => undefined);
  }

  /**
   * Terminal-outcome set. ASSESSMENT_CONFLICT alone is NOT terminal: it
   * is the shared 409 envelope for structured reasons (see error-codes
   * REASON_MAP) — most are terminal/stop, but SECTION_CLOCK_MISSING is
   * a retryable operator/data state. isTerminalConflictWithReason splits
   * on details.reason; this code-only entry stays conservative (unknown
   * ASSESSMENT_CONFLICT quarantines as terminal = stop, never silent
   * drop, never infinite retry).
   */
  /**
   * Bug 6: rejections that are about ONE command in the envelope, never about
   * the session. The shared error-code map classifies these as per-write
   * recoveries (fix the payload / refresh / mint a new write id), unlike the
   * lease, epoch, protocol and assessment codes that fence the whole attempt —
   * so they must not quarantine every other question's answer with them.
   */
  private isChunkScopedRejection(code: string | null): boolean {
    return (
      code === "INVALID_RESPONSE" ||
      code === "QUESTION_NOT_IN_ATTEMPT" ||
      code === "IDEMPOTENCY_KEY_REUSED"
    );
  }

  private isTerminalConflict(code: string | null): boolean {
    return (
      code === "LEASE_FENCED" ||
      code === "CONTROL_EPOCH_STALE" ||
      code === "VERSION_COLLISION" ||
      code === "IDEMPOTENCY_KEY_REUSED" ||
      code === "ATTEMPT_NOT_WRITABLE" ||
      code === "DEADLINE_EXPIRED" ||
      code === "QUESTION_NOT_IN_ATTEMPT" ||
      code === "INVALID_RESPONSE" ||
      code === "PROTOCOL_VERSION_UNSUPPORTED" ||
      code === "ASSESSMENT_CONFLICT"
    );
  }

  /** SECTION_CLOCK_MISSING is the one retryable ASSESSMENT_CONFLICT reason. */
  private isRetryableConflictReason(error: unknown): boolean {
    const reason = this.extractConflictReason(error);
    return reason === "SECTION_CLOCK_MISSING";
  }

  /** Read details.reason (ApiClient surfaces backend details there). */
  private extractConflictReason(error: unknown): string | null {
    if (!isRecord(error)) return null;
    const read = (holder: unknown): string | null => {
      if (!isRecord(holder)) return null;
      const details = isRecord(holder["details"]) ? (holder["details"] as Record<string, unknown>) :
        isRecord(holder["backendDetails"]) ? (holder["backendDetails"] as Record<string, unknown>) : null;
      const reason = details?.["reason"];
      return typeof reason === "string" ? reason : null;
    };
    const nested = isRecord(error["error"]) ? error["error"] : null;
    const response = isRecord(error["response"]) ? error["response"] : null;
    const responseData = isRecord(response?.["data"]) ? response["data"] : null;
    return read(error) ?? read(nested) ?? read(responseData) ?? null;
  }

  /** Question id from a per-question VERSION_COLLISION envelope, if present. */
  private extractCollisionQuestionId(error: unknown): string | null {
    if (!isRecord(error)) return null;
    const read = (holder: unknown): string | null => {
      if (!isRecord(holder)) return null;
      const details = isRecord(holder["details"])
        ? (holder["details"] as Record<string, unknown>)
        : isRecord(holder["backendDetails"])
          ? (holder["backendDetails"] as Record<string, unknown>)
          : null;
      const questionId = details?.["questionId"];
      return typeof questionId === "string" && questionId.trim() !== "" ? questionId : null;
    };
    const nested = isRecord(error["error"]) ? error["error"] : null;
    const response = isRecord(error["response"]) ? error["response"] : null;
    const responseData = isRecord(response?.["data"]) ? response["data"] : null;
    return read(error) ?? read(nested) ?? read(responseData);
  }

  /**
   * N1b self-heal: adopt a fresh authoritative snapshot, raise the version floor
   * for one question to the server's own version, and re-issue the visible
   * payload above that floor as a NEW write (mirrors reconcileBlocked's mint
   * discipline). Refuses — leaving the caller on the existing terminal path —
   * on a fetch failure, a non-authoritative snapshot, a lease change, a
   * terminal delivery status, or a blocked draft (which needs the reconcile
   * UX). Never mints a version at or below the refreshed floor.
   */
  private async recoverVersionCollision(questionId: string): Promise<boolean> {
    if (this.isDestroyed) return false;
    let snapshot: SnapshotResponse;
    try {
      snapshot = await fetchSnapshotWithTimeout(
        (attemptId) => this.transport.fetchSnapshot(attemptId),
        this.attemptId
      );
    } catch {
      this.emitDurabilityEvent("version_collision_recovery_failed", {
        reason: "snapshot_fetch_failed",
      });
      return false;
    }
    if (this.isDestroyed) return false;
    if (!isSnapshotResponse(snapshot)) return false;
    if (snapshot.attemptId !== this.attemptId) return false;
    if (["submitted", "terminated", "locked", "cancelled"].includes(snapshot.deliveryStatus)) {
      return false;
    }
    // Never cross a lease fence implicitly — that path belongs to reconcile.
    if (snapshot.leaseEpoch !== this.leaseEpoch) return false;
    const live = this.states.get(questionId)?.pending;
    if (!live || live.blocked) return false;

    this.attemptRevision = Math.max(this.attemptRevision, snapshot.attemptRevision);
    for (const response of snapshot.responses) {
      this.installServerResponse(response);
    }
    const server = snapshot.responses.find((entry) => entry.questionId === questionId);
    this.reissueUnderCurrentEpochs(questionId, live, server ? server.clientVersion : 0);
    this.emitDurabilityEvent("version_collision_recovered", { reason: "VERSION_COLLISION" });
    this.notifyStateChange();
    return true;
  }

  /**
   * Re-issues one live draft as a NEW write under the engine's current lease
   * and control epochs, minted above `serverVersionFloor`, replacing both the
   * queued and the in-flight entry for the question so the superseded version
   * can never fly again. Shared by the VERSION_COLLISION and CONTROL_EPOCH
   * heals; the caller decides whether re-issuing is safe.
   */
  private reissueUnderCurrentEpochs(
    questionId: string,
    live: PendingResponseState,
    serverVersionFloor: number
  ): void {
    const floor = Math.max(this.versionTrackers.get(questionId) ?? 0, serverVersionFloor);
    const issuedVersion = floor + 1;
    this.versionTrackers.set(questionId, issuedVersion);

    const writeId = randomWriteId();
    const pending: PendingResponseState = {
      payload: clonePayload(live.payload),
      writeId,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      clientVersion: issuedVersion,
      durability: live.durability,
    };
    if (live.receivedAt !== undefined) pending.receivedAt = live.receivedAt;
    if (live.order !== undefined) pending.order = live.order;
    this.states.set(questionId, {
      confirmed: this.states.get(questionId)?.confirmed ?? null,
      pending,
    });
    this.checkpointIntentSync(questionId, pending);
    void saveDurableDraft(durableDraftKey(this.attemptId, questionId), pending).catch(
      () => undefined
    );

    const staleQueued = this.outbox.get(questionId);
    if (staleQueued) {
      this.outbox.delete(questionId);
      this.issuedCommands.delete(staleQueued.writeId);
      this.commandEpochs.delete(staleQueued.writeId);
    }
    const staleFlight = this.inFlight.get(questionId);
    if (staleFlight) {
      this.inFlight.delete(questionId);
      this.issuedCommands.delete(staleFlight.writeId);
      this.commandEpochs.delete(staleFlight.writeId);
    }
    const command: ResponseCommandV2 = {
      writeId,
      questionId,
      clientVersion: issuedVersion,
      response: clonePayload(pending.payload),
    };
    this.outbox.set(questionId, command);
    this.issuedCommands.set(writeId, command);
    this.commandEpochs.set(writeId, {
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
    });
  }

  /**
   * Heals a CONTROL_EPOCH_STALE refusal that is a pure epoch skew.
   *
   * The server refused the batch because its control epoch moved past the
   * one this engine holds (a runtime command, a proctor action, or the SAT
   * module start bumped it after our last snapshot). Re-read the authoritative
   * snapshot and, ONLY when every fence still holds — same attempt, same
   * lease, attempt running, epoch genuinely ahead of ours — adopt the epoch
   * and re-issue every queued and in-flight draft under it. A draft the server
   * has already moved past stays queued as blocked for an explicit reconcile.
   *
   * Anything else (a lease change, a paused or terminal attempt, a snapshot
   * that does not show a newer epoch, a fetch failure) returns false and the
   * caller keeps the blocked/reconcilable posture. Lease fences are never
   * crossed here; a paused attempt is not writable, so re-sending would trade
   * a recoverable block for a terminal refusal.
   */
  private async recoverControlEpochSkew(): Promise<boolean> {
    if (this.isDestroyed || this.terminalState || this.submissionPromise) return false;
    const fail = (reason: string): false => {
      this.emitDurabilityEvent("control_epoch_recovery_failed", { reason });
      return false;
    };
    let snapshot: SnapshotResponse;
    try {
      snapshot = await fetchSnapshotWithTimeout(
        (attemptId) => this.transport.fetchSnapshot(attemptId),
        this.attemptId
      );
    } catch {
      return fail("snapshot_fetch_failed");
    }
    if (this.isDestroyed || this.terminalState || this.submissionPromise) return false;
    if (!isSnapshotResponse(snapshot)) return fail("snapshot_not_authoritative");
    if (snapshot.attemptId !== this.attemptId) return fail("attempt_mismatch");
    if (["submitted", "terminated", "locked", "cancelled"].includes(snapshot.deliveryStatus)) {
      return fail("attempt_terminal");
    }
    if (snapshot.leaseEpoch !== this.leaseEpoch) return fail("lease_changed");
    if (snapshot.deliveryStatus !== "running") return fail("attempt_not_running");
    if (
      !Number.isSafeInteger(snapshot.controlEpoch) ||
      snapshot.controlEpoch <= this.controlEpoch
    ) {
      // The server refused our epoch but does not show a newer one: not a
      // skew this engine can reason about, so it must not spin on it.
      return fail("epoch_not_advanced");
    }

    this.attemptRevision = Math.max(this.attemptRevision, snapshot.attemptRevision);
    for (const response of snapshot.responses) {
      this.installServerResponse(response);
    }
    const previousControlEpoch = this.controlEpoch;
    this.controlEpoch = snapshot.controlEpoch;

    // Every queued and in-flight draft was minted under the old epoch and is
    // non-sendable now (isBlockedPending compares enqueue-time epochs). Per
    // question the LIVE draft decides: it is re-issued as a new write and
    // every stale command for that question — queued or in flight, whatever
    // writeId it carried — is dropped, so no superseded envelope can fly and
    // nothing lingers in the outbox as an unsendable zombie. A draft the
    // snapshot already superseded has nothing left to send; a blocked draft
    // keeps exactly its own command queued for the explicit reconcile path.
    const stale = [...this.inFlight.values(), ...this.outbox.values()];
    this.inFlight.clear();
    const questionIds = new Set(stale.map((command) => command.questionId));
    const keepOnlyLiveCommand = (
      questionId: string,
      live: PendingResponseState,
      staleForQuestion: readonly ResponseCommandV2[]
    ): void => {
      const own = staleForQuestion.find((command) => command.writeId === live.writeId);
      for (const command of staleForQuestion) {
        // By writeId, not identity: removeCommand on a same-writeId duplicate
        // would drop the live draft's own issued/epoch bookkeeping.
        if (command.writeId !== live.writeId) this.removeCommand(command);
      }
      if (own && !this.outbox.has(questionId)) this.outbox.set(questionId, own);
    };
    let reissued = 0;
    for (const questionId of questionIds) {
      const staleForQuestion = stale.filter((command) => command.questionId === questionId);
      const live = this.states.get(questionId)?.pending;
      if (!live) {
        // installServerResponse cleared the draft: the server already holds
        // this write, so the refused command is spent, not re-sendable.
        for (const command of staleForQuestion) this.removeCommand(command);
        continue;
      }
      if (live.blocked) {
        keepOnlyLiveCommand(questionId, live, staleForQuestion);
        continue;
      }
      const server = snapshot.responses.find((entry) => entry.questionId === questionId);
      const neverIssuedDraft = live.clientVersion <= 0;
      if (
        !neverIssuedDraft &&
        server &&
        server.writeId !== live.writeId &&
        server.clientVersion >= live.clientVersion
      ) {
        keepOnlyLiveCommand(questionId, live, staleForQuestion);
        const mark: BlockedInfoEx = {
          reason: "EPOCH_STALE",
          blockedAt: new Date().toISOString(),
          originLeaseEpoch: live.leaseEpoch,
        };
        live.blocked = mark;
        this.checkpointIntentSync(questionId, live);
        this.emitDurabilityEvent("control_epoch_blocked", {
          reason: "CONTROL_EPOCH_STALE",
          controlEpoch: this.controlEpoch,
        });
        continue;
      }
      for (const command of staleForQuestion) this.removeCommand(command);
      this.reissueUnderCurrentEpochs(questionId, live, server ? server.clientVersion : 0);
      reissued += 1;
    }
    this.emitDurabilityEvent("control_epoch_recovered", {
      reason: "CONTROL_EPOCH_STALE",
      previousControlEpoch,
      controlEpoch: this.controlEpoch,
      reissued,
    });
    if (this.getBlockedCount() > 0 && this.syncStatus !== "conflict_fenced" && this.syncStatus !== "conflict_terminal") {
      this.syncStatus = "blocked_attention";
      this.lastError =
        "Exam timing changed. Your latest answers are kept on this device and need re-check.";
      this.notifyStatusChange();
    }
    this.notifyStateChange();
    return true;
  }

  /**
   * N1: true only for the submit-time response-revision race. The backend
   * returns `VERSION_COLLISION` with `details: {expected, current}` (no
   * questionId) when `expectedAttemptRevision` no longer matches; that state
   * is recoverable by refreshing and resubmitting. A per-question collision
   * carries `questionId`/`clientVersion` and must stay terminal.
   */
  private isSubmitRevisionRace(error: unknown): boolean {
    if (!isRecord(error)) return false;
    const read = (holder: unknown): boolean => {
      if (!isRecord(holder)) return false;
      const details = isRecord(holder["details"])
        ? (holder["details"] as Record<string, unknown>)
        : isRecord(holder["backendDetails"])
          ? (holder["backendDetails"] as Record<string, unknown>)
          : null;
      if (!details) return false;
      const expected = details["expected"];
      const current = details["current"];
      return (
        typeof expected === "number" &&
        Number.isSafeInteger(expected) &&
        typeof current === "number" &&
        Number.isSafeInteger(current) &&
        details["questionId"] === undefined
      );
    };
    const nested = isRecord(error["error"]) ? error["error"] : null;
    const response = isRecord(error["response"]) ? error["response"] : null;
    const responseData = isRecord(response?.["data"]) ? response["data"] : null;
    for (const holder of [error, nested, responseData]) {
      if (read(holder)) return true;
    }
    return false;
  }

  private extractErrorCode(error: unknown): string | null {
    if (!isRecord(error)) return null;
    const nestedValue = error["error"];
    const responseValue = error["response"];
    const nested = isRecord(nestedValue) ? nestedValue : null;
    const response = isRecord(responseValue) ? responseValue : null;
    const responseDataValue = response?.["data"];
    const responseData = isRecord(responseDataValue) ? responseDataValue : null;
    const candidates = [
      error["backendCode"],
      error["code"],
      nested?.["backendCode"],
      nested?.["code"],
      responseData?.["backendCode"],
      responseData?.["code"],
    ];
    return (
      candidates.find((candidate): candidate is string => typeof candidate === "string") ?? null
    );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (isRecord(error) && typeof error["message"] === "string") return error["message"];
    return "Response batch could not be delivered.";
  }

  private calculateJitterBackoff(attempt: number): number {
    const base = Math.min(250 * 2 ** Math.max(0, attempt - 1), 3_000);
    return Math.floor(Math.random() * base);
  }

  private notifyStatusChange(): void {
    this.onStatusChange?.(this.syncStatus, this.lastError);
  }

  private notifyStateChange(): void {
    this.onStateChange?.(new Map(this.states));
  }

  /** Best-effort reason-coded telemetry; never throws, never carries payload content. */
  private emitDurabilityEvent(name: string, fields?: Record<string, string | number | boolean | null | undefined>): void {
    try { this.onDurabilityEvent?.(name, fields); } catch { /* never throws */ }
  }

  private lifecycleDrainHandler = (): void => {
    void this.flush().catch(() => undefined);
  };

  private setupLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.lifecycleDrainHandler);
    }
    window.addEventListener("pagehide", this.lifecycleDrainHandler);
    window.addEventListener("freeze", this.lifecycleDrainHandler);
  }

  private removeLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.lifecycleDrainHandler);
    }
    window.removeEventListener("pagehide", this.lifecycleDrainHandler);
    window.removeEventListener("freeze", this.lifecycleDrainHandler);
  }
}
