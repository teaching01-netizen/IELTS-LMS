import type {
  AttemptSyncState,
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptMutationType,
} from '../types/studentAttempt';

const ANSWER_SYNC_CHECKPOINT_KEY_PREFIX = 'ielts_student_answer_checkpoint_v1';

export type DurablePersistTriggerSource =
  | 'mutation'
  | 'debounce_timer'
  | 'focusout'
  | 'visibility_hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'freeze'
  | 'window_blur'
  | 'hydrate_checkpoint'
  | 'dom_rescue_commit';

export function isAnswerMutationType(type: StudentAttemptMutationType): boolean {
  return type === 'answer' || type === 'writing_answer';
}

export type PendingMutationDurableWriteMode = 'immediate' | 'debounced';

export type PendingMutationFlushKind = 'objective' | 'writing';

export function getMutationCoalesceKey(mutation: StudentAttemptMutation): string | null {
  switch (mutation.type) {
    case 'answer': {
      const questionId = mutation.payload.questionId;
      if (!(typeof questionId === 'string' && questionId.trim())) {
        return null;
      }

      const slotIndex = mutation.payload.slotIndex;
      if (typeof slotIndex === 'number' && Number.isInteger(slotIndex) && slotIndex >= 0) {
        return `answer:${questionId}:slot:${slotIndex}`;
      }

      return `answer:${questionId}`;
    }
    case 'writing_answer': {
      const taskId = mutation.payload.taskId;
      return typeof taskId === 'string' && taskId.trim() ? `writing_answer:${taskId}` : null;
    }
    case 'flag': {
      const questionId = mutation.payload.questionId;
      return typeof questionId === 'string' && questionId.trim() ? `flag:${questionId}` : null;
    }
    case 'position':
    case 'network':
    case 'device_fingerprint':
      return mutation.type;
    case 'violation':
    case 'precheck':
    case 'heartbeat':
    case 'sync':
    default:
      return null;
  }
}

export function coalescePendingMutations(
  pending: StudentAttemptMutation[],
  nextMutation: StudentAttemptMutation,
): StudentAttemptMutation[] {
  const coalesceKey = getMutationCoalesceKey(nextMutation);
  if (!coalesceKey) {
    return [...pending, nextMutation];
  }

  const filtered = pending.filter((existing) => getMutationCoalesceKey(existing) !== coalesceKey);
  return [...filtered, nextMutation];
}

interface AnswerSyncCheckpointRecord {
  attemptId: string;
  savedAt: string;
  mutationVersion: number;
  mutations: StudentAttemptMutation[];
}

function checkpointStorageKey(attemptId: string): string {
  return `${ANSWER_SYNC_CHECKPOINT_KEY_PREFIX}:${attemptId}`;
}

function readCheckpointStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCheckpointEligibleMutationType(type: StudentAttemptMutationType): boolean {
  return type === 'answer' || type === 'writing_answer' || type === 'flag';
}

function isCheckpointRecord(candidate: unknown): candidate is AnswerSyncCheckpointRecord {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const parsed = candidate as Partial<AnswerSyncCheckpointRecord>;
  return (
    typeof parsed.attemptId === 'string' &&
    typeof parsed.savedAt === 'string' &&
    typeof parsed.mutationVersion === 'number' &&
    Number.isFinite(parsed.mutationVersion) &&
    Array.isArray(parsed.mutations)
  );
}

export function writeAnswerSyncCheckpoint(
  attemptId: string,
  mutationVersion: number,
  mutations: StudentAttemptMutation[],
): boolean {
  const storage = readCheckpointStorage();
  if (!storage) {
    return false;
  }

  try {
    const eligibleMutations = mutations.filter((mutation) =>
      isCheckpointEligibleMutationType(mutation.type),
    );
    const key = checkpointStorageKey(attemptId);
    if (eligibleMutations.length === 0) {
      storage.removeItem(key);
      return true;
    }

    const payload: AnswerSyncCheckpointRecord = {
      attemptId,
      savedAt: new Date().toISOString(),
      mutationVersion,
      mutations: eligibleMutations,
    };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readAnswerSyncCheckpoint(attemptId: string): StudentAttemptMutation[] {
  const storage = readCheckpointStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(checkpointStorageKey(attemptId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isCheckpointRecord(parsed) || parsed.attemptId !== attemptId) {
      return [];
    }

    return parsed.mutations.filter((mutation) => isCheckpointEligibleMutationType(mutation.type));
  } catch {
    return [];
  }
}

function shouldDebounceAnswerDurability(mutation: StudentAttemptMutation): boolean {
  if (mutation.type === 'writing_answer') {
    return true;
  }
  if (mutation.type !== 'answer') {
    return false;
  }
  const interactionType = mutation.payload.interactionType;
  return interactionType !== 'discrete';
}

export class PendingMutationDurabilityMirror {
  private pendingMutations: StudentAttemptMutation[] = [];
  private mutationVersion = 0;
  private durablePersistedMutationVersion = 0;
  private latestAnswerMutationVersion = 0;
  private persistChain: Promise<boolean> = Promise.resolve(true);
  private pendingWriteTimeout: number | null = null;
  private lastTrigger: DurablePersistTriggerSource = 'mutation';

  constructor(
    private readonly deps: {
      debounceMs: number;
      getAttempt: () => StudentAttempt | null;
      savePendingMutations: (attemptId: string, mutations: StudentAttemptMutation[]) => Promise<void>;
      clearPendingMutations: (attemptId: string) => Promise<void>;
      setStorageDurabilityBlocking: (active: boolean) => void;
      onPersistError: (
        error: unknown,
        pendingMutationCount: number,
        fallbackAttempt: StudentAttempt,
        source: DurablePersistTriggerSource,
        durablePersistResult?: 'failed' | 'checkpoint_failed',
      ) => void;
      onPendingMutationCountChange: (count: number) => void;
      onMutationVersionChange?: (version: number) => void;
      nowIso?: () => string;
    },
  ) {}

  reset(): void {
    this.pendingMutations = [];
    this.mutationVersion = 0;
    this.durablePersistedMutationVersion = 0;
    this.latestAnswerMutationVersion = 0;
    this.persistChain = Promise.resolve(true);
    this.lastTrigger = 'mutation';
    if (this.pendingWriteTimeout) {
      window.clearTimeout(this.pendingWriteTimeout);
      this.pendingWriteTimeout = null;
    }
    this.deps.onPendingMutationCountChange(0);
    this.deps.onMutationVersionChange?.(this.mutationVersion);
  }

  cancelDebouncedPersist(): void {
    this.clearDebounce();
  }

  getPendingMutations(): StudentAttemptMutation[] {
    return this.pendingMutations;
  }

  finalizeAfterSuccessfulClear(attemptId: string): void {
    this.cancelDebouncedPersist();
    this.pendingMutations = [];
    this.deps.onPendingMutationCountChange(0);
    this.mutationVersion += 1;
    this.durablePersistedMutationVersion = this.mutationVersion;
    this.latestAnswerMutationVersion = this.mutationVersion;
    this.deps.onMutationVersionChange?.(this.mutationVersion);
    void writeAnswerSyncCheckpoint(attemptId, this.mutationVersion, []);
    this.deps.setStorageDurabilityBlocking(false);
  }

  setPendingMutations(
    nextMutations: StudentAttemptMutation[],
    options?: {
      durableWriteMode?: PendingMutationDurableWriteMode;
      includesAnswerMutation?: boolean;
      awaitPersistence?: boolean;
      source?: DurablePersistTriggerSource;
    },
  ): Promise<boolean> | void {
    this.pendingMutations = nextMutations;
    this.deps.onPendingMutationCountChange(nextMutations.length);
    this.mutationVersion += 1;
    this.deps.onMutationVersionChange?.(this.mutationVersion);

    if (options?.includesAnswerMutation) {
      this.latestAnswerMutationVersion = this.mutationVersion;
    }

    const attempt = this.deps.getAttempt();
    if (attempt && options?.includesAnswerMutation) {
      const ok = writeAnswerSyncCheckpoint(attempt.id, this.mutationVersion, nextMutations);
      if (!ok) {
        this.deps.onPersistError(
          new Error('failed_to_write_sync_checkpoint'),
          nextMutations.length,
          attempt,
          options?.source ?? 'mutation',
          'checkpoint_failed',
        );
      }
    }

    if (options?.durableWriteMode === 'debounced') {
      this.scheduleDebouncedPersist();
      if (options?.awaitPersistence) {
        this.clearDebounce();
        return this.persistNow(options?.source ?? 'mutation');
      }
      return;
    }

    this.clearDebounce();
    const persistence = this.persistNow(options?.source ?? 'mutation');
    if (options?.awaitPersistence) {
      return persistence;
    }
    void persistence;
  }

  flushAnswerDurableMirrorNow(source: DurablePersistTriggerSource): void {
    if (this.durablePersistedMutationVersion >= this.latestAnswerMutationVersion) {
      return;
    }
    this.clearDebounce();
    void this.persistNow(source);
  }

  isDurableMirrorUpToDate(): boolean {
    return this.durablePersistedMutationVersion >= this.mutationVersion;
  }

  async persistNow(source: DurablePersistTriggerSource = 'mutation'): Promise<boolean> {
    this.lastTrigger = source;
    const persistTask = this.persistChain.then(async () => {
      const attempt = this.deps.getAttempt();
      if (!attempt) {
        return true;
      }

      const currentVersion = this.mutationVersion;
      if (currentVersion <= this.durablePersistedMutationVersion) {
        return true;
      }

      try {
        const pending = this.pendingMutations;
        if (pending.length > 0) {
          await this.deps.savePendingMutations(attempt.id, pending);
        } else {
          await this.deps.clearPendingMutations(attempt.id);
        }
      } catch (error) {
        this.deps.onPersistError(
          error,
          this.pendingMutations.length,
          attempt,
          this.lastTrigger,
          'failed',
        );
        return false;
      }

      this.durablePersistedMutationVersion = Math.max(
        this.durablePersistedMutationVersion,
        currentVersion,
      );
      this.deps.setStorageDurabilityBlocking(false);
      return true;
    });

    this.persistChain = persistTask;
    return persistTask;
  }

  hydratePendingMutations(args: {
    mutations: StudentAttemptMutation[];
    recoveredFromCheckpoint: boolean;
  }): void {
    // This matches the previous provider behavior:
    // - set RAM pending mutations
    // - if recovered from checkpoint, consider durable mirror stale and persist again
    // - else mark mirror as up-to-date
    const includesAnswerMutation = args.mutations.some(
      (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
    );
    this.pendingMutations = args.mutations;
    this.deps.onPendingMutationCountChange(args.mutations.length);
    this.mutationVersion += 1;
    this.deps.onMutationVersionChange?.(this.mutationVersion);
    if (includesAnswerMutation) {
      this.latestAnswerMutationVersion = this.mutationVersion;
    }

    if (args.recoveredFromCheckpoint && args.mutations.length > 0) {
      this.durablePersistedMutationVersion = Math.max(0, this.mutationVersion - 1);
      void this.persistNow('hydrate_checkpoint');
    } else {
      this.durablePersistedMutationVersion = this.mutationVersion;
    }
  }

  private clearDebounce(): void {
    if (this.pendingWriteTimeout) {
      window.clearTimeout(this.pendingWriteTimeout);
      this.pendingWriteTimeout = null;
    }
  }

  private scheduleDebouncedPersist(): void {
    this.clearDebounce();
    this.pendingWriteTimeout = window.setTimeout(() => {
      void this.persistNow('debounce_timer');
    }, this.deps.debounceMs);
  }
}

type StudentAttemptPatch = Omit<Partial<StudentAttempt>, 'integrity' | 'recovery'> & {
  integrity?: Partial<StudentAttempt['integrity']> | undefined;
  recovery?: Partial<StudentAttempt['recovery']> | undefined;
};

function mergeStudentAttempt(attempt: StudentAttempt, patch: StudentAttemptPatch): StudentAttempt {
  return {
    ...attempt,
    ...patch,
    answers: patch.answers ? { ...attempt.answers, ...patch.answers } : attempt.answers,
    writingAnswers: patch.writingAnswers
      ? { ...attempt.writingAnswers, ...patch.writingAnswers }
      : attempt.writingAnswers,
    flags: patch.flags ? { ...attempt.flags, ...patch.flags } : attempt.flags,
    violations: patch.violations ?? attempt.violations,
    integrity: patch.integrity
      ? {
          ...attempt.integrity,
          ...patch.integrity,
        }
      : attempt.integrity,
    recovery: patch.recovery
      ? {
          ...attempt.recovery,
          ...patch.recovery,
        }
      : attempt.recovery,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
}

export interface StudentMutationOutbox {
  flushNow: () => Promise<boolean>;
}

function generateLifecycleCycleId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function shouldSampleLifecycleSuccessLogs(sampleRate = 0.2): boolean {
  if (!(sampleRate > 0)) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  return Math.random() < sampleRate;
}

function normalizedComparableAnswer(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length === 0) return undefined;
  if (value === null) return undefined;
  return value;
}

function mutationIsRepresentedBySubmittedAttempt(
  attempt: StudentAttempt,
  mutation: StudentAttemptMutation,
): boolean {
  const final = attempt.finalSubmission;
  if (!final || !attempt.submittedAt) return false;

  if (mutation.type === 'answer') {
    const actual = final.answers?.[mutation.payload.questionId];
    const slotIndex = mutation.payload.slotIndex;
    if (typeof slotIndex === 'number' && Number.isInteger(slotIndex) && slotIndex >= 0) {
      const expectedSource = mutation.payload.value;
      const expected = Array.isArray(expectedSource) ? expectedSource[slotIndex] : expectedSource;
      const actualSlot = Array.isArray(actual) ? actual[slotIndex] : undefined;
      return normalizedComparableAnswer(actualSlot) === normalizedComparableAnswer(expected);
    }
    return JSON.stringify(normalizedComparableAnswer(actual)) ===
      JSON.stringify(normalizedComparableAnswer(mutation.payload.value));
  }

  if (mutation.type === 'writing_answer') {
    const actual = final.writingAnswers?.[mutation.payload.taskId];
    const expected = mutation.payload.value.trim().length > 0 ? mutation.payload.value : undefined;
    return (actual && actual.trim().length > 0 ? actual : undefined) === expected;
  }

  if (mutation.type === 'flag') {
    return Boolean(final.flags?.[mutation.payload.questionId]) === mutation.payload.value;
  }

  return false;
}

export function createStudentMutationOutbox(deps: {
  getAttempt: () => StudentAttempt | null;
  syncAttemptState: (attempt: StudentAttempt) => void;
  setRuntimeAttemptSyncState: (state: AttemptSyncState) => void;
  setStorageDurabilityBlocking: (active: boolean) => void;
  mirror: PendingMutationDurabilityMirror;
  persistenceEnabled: () => boolean;
  isOnline: () => boolean;
  hasAttemptCredential: (scheduleId: string, attemptId: string) => boolean;
  refreshAttemptCredentialForAttempt: (attempt: StudentAttempt) => Promise<boolean>;
  backendConflictReason: (error: unknown) => string | null;
  clearAttemptMutationWatermark: (attempt: StudentAttempt) => void;
  onReplayAfterSubmit?: (attempt: StudentAttempt) => void;
  saveAttempt: (
    attempt: StudentAttempt,
    context?: { flushCycleId?: string; sampledSuccessLogs?: boolean },
  ) => Promise<void>;
  clearPendingMutations: (attemptId: string) => Promise<void>;
  getAttemptsByScheduleId: (scheduleId: string) => Promise<StudentAttempt[]>;
  getCanonicalAttempt: (attempt: StudentAttempt) => Promise<StudentAttempt | null>;
}): StudentMutationOutbox {
  return {
    flushNow: async () => {
      const flushCycleId = generateLifecycleCycleId('flush');
      const sampledSuccessLogs = shouldSampleLifecycleSuccessLogs();
      const currentAttempt = deps.getAttempt();
      if (!currentAttempt) {
        return true;
      }

      if (!deps.persistenceEnabled()) {
        deps.mirror.reset();
        deps.setStorageDurabilityBlocking(false);
        const idleAttempt = mergeStudentAttempt(currentAttempt, {
          recovery: { pendingMutationCount: 0, syncState: 'idle' },
        });
        deps.syncAttemptState(idleAttempt);
        return true;
      }

      if (!deps.isOnline()) {
        const offlineAttempt = mergeStudentAttempt(currentAttempt, {
          recovery: {
            syncState: 'offline',
            pendingMutationCount: deps.mirror.getPendingMutations().length,
          },
        });
        deps.syncAttemptState(offlineAttempt);
        return false;
      }

      if (deps.mirror.getPendingMutations().length === 0) {
        deps.setRuntimeAttemptSyncState(currentAttempt.recovery.syncState);
        return true;
      }

      if (!deps.mirror.isDurableMirrorUpToDate()) {
        const persistedMirror = await deps.mirror.persistNow('mutation');
        if (!persistedMirror) {
          const erroredAttempt = mergeStudentAttempt(currentAttempt, {
            recovery: {
              syncState: 'error',
              pendingMutationCount: deps.mirror.getPendingMutations().length,
            },
          });
          deps.syncAttemptState(erroredAttempt);
          return false;
        }
      }

      if (!deps.hasAttemptCredential(currentAttempt.scheduleId, currentAttempt.id)) {
        const refreshed = await deps.refreshAttemptCredentialForAttempt(currentAttempt).catch(() => false);
        if (!refreshed) {
          const erroredAttempt = mergeStudentAttempt(currentAttempt, {
            recovery: {
              syncState: 'error',
              pendingMutationCount: deps.mirror.getPendingMutations().length,
            },
          });
          deps.syncAttemptState(erroredAttempt);
          return false;
        }
      }

      while (deps.mirror.getPendingMutations().length > 0) {
        const attemptBeforeFlush = deps.getAttempt() ?? currentAttempt;
        const mutationsBeingFlushed = deps.mirror.getPendingMutations();
        const flushedMutationIds = new Set(mutationsBeingFlushed.map((mutation) => mutation.id));
        const savingAttempt = mergeStudentAttempt(attemptBeforeFlush, {
          recovery: {
            syncState: 'saving',
            pendingMutationCount: mutationsBeingFlushed.length,
          },
        });
        deps.syncAttemptState(savingAttempt);

        try {
          const persistedAt = new Date().toISOString();
          // Finding #6: the record handed to the persist dependency must not
          // claim the flush succeeded before it has. A crash or a failed
          // persist between here and the mutation clear would otherwise leave
          // a durable "saved / 0 pending" claim for work that never landed.
          // The honest pre-send state is `saving` with the true pending count;
          // the `saved` record is written only after the mutations are cleared.
          const flushingAttempt = mergeStudentAttempt(savingAttempt, {
            recovery: {
              lastPersistedAt: persistedAt,
              pendingMutationCount: mutationsBeingFlushed.length,
              syncState: 'saving',
            },
          });

          await deps.saveAttempt(flushingAttempt, {
            flushCycleId,
            sampledSuccessLogs,
          });

          const remainingMutations = deps.mirror.getPendingMutations().filter(
            (mutation) => !flushedMutationIds.has(mutation.id),
          );

          if (remainingMutations.length > 0) {
            const persistedMirror = await (
              deps.mirror.setPendingMutations(remainingMutations, {
                durableWriteMode: 'immediate',
                includesAnswerMutation: remainingMutations.some(
                  (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
                ),
                awaitPersistence: true,
                source: 'mutation',
              }) ?? Promise.resolve(true)
            );
            if (!persistedMirror) {
              return false;
            }
            const stillSavingAttempt = mergeStudentAttempt(deps.getAttempt() ?? flushingAttempt, {
              recovery: {
                lastPersistedAt: persistedAt,
                pendingMutationCount: remainingMutations.length,
                syncState: deps.isOnline() ? 'saving' : 'offline',
              },
            });
            deps.syncAttemptState(stillSavingAttempt);

            if (!deps.isOnline()) {
              return false;
            }

            continue;
          }

          deps.mirror.cancelDebouncedPersist();
          await deps.clearPendingMutations(flushingAttempt.id);
          const postClearMutations = deps.mirror.getPendingMutations().filter(
            (mutation) => !flushedMutationIds.has(mutation.id),
          );
          if (postClearMutations.length > 0) {
            const persistedMirror = await (
              deps.mirror.setPendingMutations(postClearMutations, {
                durableWriteMode: 'immediate',
                includesAnswerMutation: postClearMutations.some(
                  (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
                ),
                awaitPersistence: true,
                source: 'mutation',
              }) ?? Promise.resolve(true)
            );
            if (!persistedMirror) {
              return false;
            }
            const stillSavingAttempt = mergeStudentAttempt(deps.getAttempt() ?? flushingAttempt, {
              recovery: {
                lastPersistedAt: persistedAt,
                pendingMutationCount: postClearMutations.length,
                syncState: deps.isOnline() ? 'saving' : 'offline',
              },
            });
            deps.syncAttemptState(stillSavingAttempt);

            if (!deps.isOnline()) {
              return false;
            }

            continue;
          }

          deps.mirror.finalizeAfterSuccessfulClear(flushingAttempt.id);
          // Only now — after the delivery attempt resolved AND the mutation
          // ledger was cleared — is it honest to record the saved state.
          const savedAttempt = mergeStudentAttempt(deps.getAttempt() ?? flushingAttempt, {
            recovery: {
              lastPersistedAt: persistedAt,
              pendingMutationCount: 0,
              syncState: 'saved',
            },
          });
          // The mutations are already delivered; a failure to record the local
          // bookkeeping must not turn a successful flush into a failed one.
          await deps.saveAttempt(savedAttempt, { flushCycleId, sampledSuccessLogs }).catch(
            () => undefined,
          );
          const cachedAttempts = await deps.getAttemptsByScheduleId(savedAttempt.scheduleId);
          const refreshed =
            cachedAttempts.find((candidate) => candidate.id === savedAttempt.id) ?? savedAttempt;
          deps.syncAttemptState(refreshed);
          return true;
        } catch (error) {
          const conflictReason = deps.backendConflictReason(error);
          if (conflictReason === 'ATTEMPT_SUBMITTED') {
            deps.onReplayAfterSubmit?.(currentAttempt);
            const pendingAtSeal = deps.mirror.getPendingMutations();
            const canonical = await deps.getCanonicalAttempt(currentAttempt).catch(() => null);
            const fullyRepresented = Boolean(
              canonical?.finalSubmission &&
              canonical.submittedAt &&
              pendingAtSeal.length > 0 &&
              pendingAtSeal.every((mutation) =>
                mutationIsRepresentedBySubmittedAttempt(canonical, mutation)
              )
            );

            if (fullyRepresented && canonical) {
              deps.mirror.reset();
              await deps.clearPendingMutations(currentAttempt.id);
              deps.clearAttemptMutationWatermark(currentAttempt);
              deps.setStorageDurabilityBlocking(false);
              deps.syncAttemptState(mergeStudentAttempt(canonical, {
                recovery: { pendingMutationCount: 0, syncState: 'saved' },
              }));
              return true;
            }

            const sealedAttempt = mergeStudentAttempt(deps.getAttempt() ?? savingAttempt, {
              recovery: {
                syncState: 'error',
                pendingMutationCount: pendingAtSeal.length,
              },
            });
            deps.syncAttemptState(sealedAttempt);
            return false;
          }

          if (conflictReason === 'SECTION_MISMATCH' || conflictReason === 'OBJECTIVE_LOCKED') {
            const retryingAttempt = mergeStudentAttempt(deps.getAttempt() ?? savingAttempt, {
              recovery: {
                syncState: deps.isOnline() ? 'saving' : 'offline',
                pendingMutationCount: deps.mirror.getPendingMutations().length,
              },
            });
            deps.syncAttemptState(retryingAttempt);
            return false;
          }

          const erroredAttempt = mergeStudentAttempt(deps.getAttempt() ?? savingAttempt, {
            recovery: {
              syncState: deps.isOnline() ? 'error' : 'offline',
              pendingMutationCount: deps.mirror.getPendingMutations().length,
            },
          });
          deps.syncAttemptState(erroredAttempt);
          return false;
        }
      }

      deps.setRuntimeAttemptSyncState((deps.getAttempt() ?? currentAttempt).recovery.syncState);
      return true;
    },
  };
}

export function buildQueuedMutationUpdate(args: {
  currentAttempt: Pick<StudentAttempt, 'id' | 'scheduleId' | 'currentModule'>;
  pending: StudentAttemptMutation[];
  mutation: StudentAttemptMutation;
  patchSyncState?: AttemptSyncState | null | undefined;
  online: boolean;
  flushDelayMs: number;
  forceImmediateDurability?: boolean;
}): {
  nextPendingMutations: StudentAttemptMutation[];
  includesAnswerMutation: boolean;
  durableWriteMode: PendingMutationDurableWriteMode;
  syncState: AttemptSyncState;
  flush: { kind: PendingMutationFlushKind; delayMs: number } | null;
} {
  const nextPendingMutations = coalescePendingMutations(args.pending, args.mutation);
  const mutationIsAnswer = isAnswerMutationType(args.mutation.type);

  return {
    nextPendingMutations,
    includesAnswerMutation: mutationIsAnswer,
    durableWriteMode:
      args.forceImmediateDurability
        ? 'immediate'
        : mutationIsAnswer && shouldDebounceAnswerDurability(args.mutation)
          ? 'debounced'
          : 'immediate',
    syncState: args.patchSyncState ?? (args.online ? 'saving' : 'offline'),
    flush:
      args.online
        ? {
            kind: args.mutation.type === 'writing_answer' ? 'writing' : 'objective',
            delayMs: args.forceImmediateDurability ? 0 : args.flushDelayMs,
          }
        : null,
  };
}
