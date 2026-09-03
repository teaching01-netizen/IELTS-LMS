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
  onStatusChange?: (status: DurabilitySyncStatus, error?: string | null) => void;
  onStateChange?: (states: ReadonlyMap<string, import("./types").QuestionResponseState>) => void;
}

const CHECKPOINT_PREFIX = "response-checkpoint:v2:";
const DURABLE_DRAFT_PREFIX = "v2_attempt_";
const MAX_RETRY_ATTEMPTS_PER_DRAIN = 8;

type CommandEpoch = {
  leaseEpoch: number;
  controlEpoch: number;
};

type SnapshotResponse = ResponseSnapshotV2 | ResponseAcknowledgementV2[];

function checkpointKey(attemptId: string, questionId: string): string {
  return `${CHECKPOINT_PREFIX}${encodeURIComponent(attemptId)}:${encodeURIComponent(questionId)}`;
}

function durableDraftKey(attemptId: string, questionId: string): string {
  return `${DURABLE_DRAFT_PREFIX}${attemptId}_${questionId}`;
}

function randomWriteId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    value["clientVersion"] > 0
  );
}

function comparePendingResponses(left: PendingResponseState, right: PendingResponseState): number {
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

  private isDraining = false;
  private drainScheduled = false;
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

  constructor(options: DurableResponseEngineOptions) {
    this.scheduleId = options.scheduleId;
    this.attemptId = options.attemptId;
    this.leaseEpoch = options.leaseEpoch;
    this.controlEpoch = options.controlEpoch;
    this.transport = options.transport;
    this.onStatusChange = options.onStatusChange;
    this.onStateChange = options.onStateChange;

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
    const changed = nextLeaseEpoch !== this.leaseEpoch || nextControlEpoch !== this.controlEpoch;
    this.leaseEpoch = nextLeaseEpoch;
    this.controlEpoch = nextControlEpoch;
    if (!changed) return;

    this.quarantineCommandsOutsideCurrentEpoch("EPOCH_STALE");
    if (
      !this.terminalState &&
      (this.syncStatus === "conflict_fenced" || this.syncStatus === "conflict_terminal")
    ) {
      this.syncStatus = "synced";
      this.lastError = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Accept user input for one question aggregate.
   */
  public acceptResponse(questionId: string, payload: ResponsePayload): Promise<void> {
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

    // Allocate the version and update the visible state synchronously. Durable
    // storage writes are then serialized per question so an older async
    // IndexedDB/localStorage completion cannot overwrite a newer edit.
    const normalized = clonePayload(payload);
    const currentVersion = this.versionTrackers.get(questionId) ?? 0;
    const clientVersion = currentVersion + 1;
    this.versionTrackers.set(questionId, clientVersion);
    const command: ResponseCommandV2 = {
      writeId: randomWriteId(),
      questionId,
      clientVersion,
      response: normalized,
    };
    const pendingState: PendingResponseState = {
      payload: normalized,
      writeId: command.writeId,
      leaseEpoch: this.leaseEpoch,
      controlEpoch: this.controlEpoch,
      clientVersion,
      durability: "memory",
    };

    const existing = this.states.get(questionId);
    this.states.set(questionId, {
      confirmed: existing?.confirmed ?? null,
      pending: pendingState,
    });
    this.notifyStateChange();

    const previous = this.acceptanceChains.get(questionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.persistAcceptedResponse(command, pendingState));
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
    pendingState: PendingResponseState
  ): Promise<void> {
    if (this.isDestroyed) return;

    // If another edit superseded this command before its turn reached durable
    // storage, the newer command is the only one that needs to be persisted.
    if (this.states.get(command.questionId)?.pending?.writeId !== command.writeId) {
      return;
    }

    let checkpointOk = false;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(
          checkpointKey(this.attemptId, command.questionId),
          JSON.stringify(pendingState)
        );
        checkpointOk = true;
        pendingState.durability = "checkpoint";
      }
    } catch {
      // IndexedDB is attempted below when localStorage is unavailable.
    }

    let indexedDbOk = false;
    try {
      await saveDurableDraft(durableDraftKey(this.attemptId, command.questionId), pendingState);
      indexedDbOk = true;
      pendingState.durability = "indexeddb";
    } catch {
      // A memory-only response is not safe enough to enqueue for transport.
    }

    if (this.isDestroyed) return;

    if (!checkpointOk && !indexedDbOk) {
      this.syncStatus = "durability_fault";
      this.lastError = "All browser durable storage failed. Exam cannot safely proceed.";
      this.notifyStatusChange();
      throw new Error(this.lastError);
    }

    // A lifecycle change can arrive while browser storage is awaiting
    // IndexedDB. Never enqueue that command under the newly adopted epoch.
    if (
      pendingState.leaseEpoch !== this.leaseEpoch ||
      pendingState.controlEpoch !== this.controlEpoch
    ) {
      this.quarantineEntry(command, "EPOCH_STALE");
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
    if (this.states.get(command.questionId)?.pending?.writeId !== command.writeId) {
      return;
    }
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
      leaseEpoch: pendingState.leaseEpoch,
      controlEpoch: pendingState.controlEpoch,
    });
    this.scheduleDrain();
  }

  /**
   * Recover durable drafts and overlay them on one authoritative server snapshot.
   * IndexedDB and the synchronous checkpoint are both consulted; the newest
   * tuple (lease, control, client version) wins for each question.
   */
  public recover(): Promise<void> {
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
    if (this.isDestroyed) return;

    const recoveredPending = await this.loadRecoveredPending();
    if (this.isDestroyed) return;
    let snapshot: SnapshotResponse | null = null;

    try {
      snapshot = await this.transport.fetchSnapshot(this.attemptId);
      if (this.isDestroyed) return;
    } catch {
      // Offline startup is valid: local durable drafts remain visible and queued.
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

    for (const [questionId, pending] of recoveredPending) {
      this.versionTrackers.set(
        questionId,
        Math.max(this.versionTrackers.get(questionId) ?? 0, pending.clientVersion)
      );

      const existingState = this.states.get(questionId);
      // A local edit accepted while recovery was reading storage wins over an
      // older durable candidate. Never let hydration regress the visible draft.
      if (existingState?.pending && comparePendingResponses(existingState.pending, pending) > 0) {
        continue;
      }

      const server = serverByQuestion.get(questionId);
      const hasAuthoritativeEpoch = Boolean(snapshot && isSnapshotResponse(snapshot));
      const epochMatches =
        pending.leaseEpoch === this.leaseEpoch && pending.controlEpoch === this.controlEpoch;
      const serverVersionIsNewer =
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

      if (!epochMatches || (hasAuthoritativeEpoch && serverVersionIsNewer) || Boolean(terminal)) {
        this.quarantinePending(
          questionId,
          pending,
          !epochMatches ? "EPOCH_STALE" : "STALE_HYDRATION"
        );
        continue;
      }

      const existing = this.states.get(questionId);
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
      this.issuedCommands.set(command.writeId, command);
      this.commandEpochs.set(command.writeId, {
        leaseEpoch: pending.leaseEpoch,
        controlEpoch: pending.controlEpoch,
      });
    }

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

    this.notifyStateChange();
    this.scheduleDrain();
  }

  /** Flush pending outbox entries. A missing acknowledgement is not treated as success. */
  public async flush(): Promise<void> {
    if (this.isDestroyed) return;

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
      if (this.outbox.size === 0) return;

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
    // In-flight network promises cannot be cancelled by every transport. Drop
    // callbacks immediately so a response from an unmounted/replaced engine
    // cannot publish into the next attempt instance.
    this.onStatusChange = undefined;
    this.onStateChange = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
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

  private async loadRecoveredPending(): Promise<Map<string, PendingResponseState>> {
    const candidates = new Map<string, PendingResponseState>();
    const consider = (questionId: string, value: unknown) => {
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
    expectedAttemptRevision: number
  ): Promise<SubmitAttemptV2Response> {
    if (this.isDestroyed) throw new Error("Response durability engine is destroyed.");
    await this.waitForPendingAcceptances();
    if (this.isDraining && this.drainPromise) {
      await this.drainPromise;
    }
    if (this.syncStatus === "conflict_fenced" || this.syncStatus === "conflict_terminal") {
      throw new Error(this.lastError ?? "The attempt is no longer writable.");
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
      if (this.isTerminalConflict(errorCode)) {
        this.quarantineAllPending(errorCode ?? "SUBMISSION_CONFLICT");
        this.syncStatus =
          errorCode === "LEASE_FENCED" || errorCode === "CONTROL_EPOCH_STALE"
            ? "conflict_fenced"
            : "conflict_terminal";
        this.lastError = `Terminal error: ${errorCode ?? "SUBMISSION_CONFLICT"}`;
        this.notifyStatusChange();
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

    if (this.getPendingCount() === 0) {
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
      seen.add(command.writeId);
      commands.push(command);
    }
    return commands;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.isDraining || this.isDestroyed || this.retryTimer) return;
    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      if (!this.isDraining && !this.isDestroyed && !this.submissionPromise) {
        this.drainPromise = this.drainOutbox();
      }
    }, 0);
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
    if (this.syncStatus !== "conflict_fenced" && this.syncStatus !== "conflict_terminal") {
      this.syncStatus = "saving";
      this.notifyStatusChange();
    }

    let retryAttempt = 0;
    try {
      while (this.outbox.size > 0 && !this.isDestroyed && !this.submissionPromise) {
        this.inFlight.clear();
        for (const [questionId, command] of this.outbox) {
          this.inFlight.set(questionId, command);
        }
        this.outbox.clear();
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
            this.syncStatus = "saved_locally";
            this.lastError = "Server response omitted one or more write acknowledgements.";
            this.notifyStatusChange();
            this.scheduleRetry(this.calculateJitterBackoff(1));
            break;
          }
        } catch (error: unknown) {
          const errorCode = this.extractErrorCode(error);
          if (this.isTerminalConflict(errorCode)) {
            this.quarantineAllPending(errorCode ?? "TERMINAL_CONFLICT");
            this.syncStatus =
              errorCode === "LEASE_FENCED" || errorCode === "CONTROL_EPOCH_STALE"
                ? "conflict_fenced"
                : "conflict_terminal";
            this.lastError = `Terminal error: ${errorCode}`;
            this.notifyStatusChange();
            break;
          }

          for (const [questionId, command] of this.inFlight) {
            if (!this.outbox.has(questionId)) this.outbox.set(questionId, command);
          }
          this.inFlight.clear();
          retryAttempt += 1;
          if (retryAttempt >= MAX_RETRY_ATTEMPTS_PER_DRAIN) {
            this.syncStatus = "saved_locally";
            this.lastError = this.errorMessage(error);
            this.notifyStatusChange();
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
        this.syncStatus !== "conflict_fenced" &&
        this.syncStatus !== "conflict_terminal"
      ) {
        this.syncStatus = "synced";
        this.lastError = null;
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
    if (existing?.pending?.writeId === acknowledgement.writeId) {
      this.states.set(acknowledgement.questionId, {
        confirmed: existing.confirmed,
        pending: null,
      });
      this.clearCheckpoint(acknowledgement.questionId);
    }
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
      const acknowledged = serverWrites.get(command.writeId);
      if (
        acknowledged &&
        acknowledged.questionId === command.questionId &&
        acknowledged.clientVersion === command.clientVersion
      ) {
        this.removeCommand(command);
        const state = this.states.get(command.questionId);
        if (state?.pending?.writeId === command.writeId) {
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
    const currentPending = this.states.get(questionId)?.pending;
    if (!currentPending || currentPending.writeId === pending.writeId) {
      this.clearCheckpoint(questionId);
    }
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

  private quarantineEntry(command: ResponseCommandV2, reason: string): void {
    if (this.quarantined.some((entry) => entry.writeId === command.writeId)) return;
    this.quarantined.push({
      writeId: command.writeId,
      questionId: command.questionId,
      clientVersion: command.clientVersion,
      payload: clonePayload(command.response),
      reason,
      quarantinedAt: new Date().toISOString(),
    });

    const existing = this.states.get(command.questionId);
    if (existing?.pending?.writeId === command.writeId) {
      this.states.set(command.questionId, {
        confirmed: existing.confirmed,
        pending: null,
      });
      this.clearCheckpoint(command.questionId);
      this.notifyStateChange();
    }
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

  private isTerminalConflict(code: string | null): boolean {
    return (
      code === "LEASE_FENCED" ||
      code === "CONTROL_EPOCH_STALE" ||
      code === "VERSION_COLLISION" ||
      code === "IDEMPOTENCY_KEY_REUSED" ||
      code === "ATTEMPT_NOT_WRITABLE" ||
      code === "QUESTION_NOT_IN_ATTEMPT" ||
      code === "INVALID_RESPONSE" ||
      code === "PROTOCOL_VERSION_UNSUPPORTED"
    );
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

  private lifecycleDrainHandler = (): void => {
    void this.flush().catch(() => undefined);
  };

  private setupLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("visibilitychange", this.lifecycleDrainHandler);
    window.addEventListener("pagehide", this.lifecycleDrainHandler);
    window.addEventListener("freeze", this.lifecycleDrainHandler);
  }

  private removeLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("visibilitychange", this.lifecycleDrainHandler);
    window.removeEventListener("pagehide", this.lifecycleDrainHandler);
    window.removeEventListener("freeze", this.lifecycleDrainHandler);
  }
}
