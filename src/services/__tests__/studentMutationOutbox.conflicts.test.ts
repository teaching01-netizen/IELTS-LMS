import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createStudentMutationOutbox, PendingMutationDurabilityMirror } from '../studentMutationOutbox';
import type { StudentAttempt, StudentAttemptMutation } from '@types/studentAttempt';

function makeAttempt(overrides?: Partial<StudentAttempt>): StudentAttempt {
  return {
    id: 'attempt-1',
    scheduleId: 'schedule-1',
    candidateId: 'c1',
    examId: 'exam-1',
    currentModule: 'listening',
    startedAt: '2026-07-05T10:00:00Z',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    integrity: { reason: null, triggeredAt: null, expiresAt: null },
    recovery: { pendingMutationCount: 0, syncState: 'idle' },
    updatedAt: '2026-07-05T10:00:00Z',
    ...overrides,
  } as StudentAttempt;
}

function makeMutation(overrides?: Partial<StudentAttemptMutation>): StudentAttemptMutation {
  return {
    id: `mut-${Date.now()}-${Math.random()}`,
    type: 'answer',
    payload: { questionId: 'q1', value: 'A', slotIndex: 0, interactionType: 'discrete' },
    timestamp: new Date().toISOString(),
    ...overrides,
  } as StudentAttemptMutation;
}

function createDeps(overrides?: {
  conflictReason?: string | null;
  saveAttemptError?: Error;
  online?: boolean;
  persistenceEnabled?: boolean;
  hasCredential?: boolean;
}) {
  let attempt = makeAttempt();
  const pendingMutations: StudentAttemptMutation[] = [];
  const onReplayAfterSubmit = vi.fn();
  const clearAttemptMutationWatermark = vi.fn();
  const syncAttemptState = vi.fn((a: StudentAttempt) => { attempt = a; });
  const getAttempt = vi.fn(() => attempt);
  const saveAttempt = overrides?.saveAttemptError
    ? vi.fn(() => Promise.reject(overrides.saveAttemptError))
    : vi.fn(() => Promise.resolve());
  const clearPendingMutations = vi.fn(() => Promise.resolve());
  const getAttemptsByScheduleId = vi.fn(() => Promise.resolve([attempt]));

  const mirror = new PendingMutationDurabilityMirror({
    debounceMs: 100,
    getAttempt: () => attempt,
    savePendingMutations: vi.fn(() => Promise.resolve()),
    clearPendingMutations: vi.fn(() => Promise.resolve()),
    setStorageDurabilityBlocking: vi.fn(),
    onPersistError: vi.fn(),
    onPendingMutationCountChange: vi.fn(),
  });

  return {
    getAttempt,
    syncAttemptState,
    setRuntimeAttemptSyncState: vi.fn(),
    setStorageDurabilityBlocking: vi.fn(),
    mirror,
    persistenceEnabled: vi.fn(() => overrides?.persistenceEnabled ?? true),
    isOnline: vi.fn(() => overrides?.online ?? true),
    hasAttemptCredential: vi.fn(() => overrides?.hasCredential ?? true),
    refreshAttemptCredentialForAttempt: vi.fn(() => Promise.resolve(true)),
    backendConflictReason: vi.fn(() => overrides?.conflictReason ?? null),
    clearAttemptMutationWatermark,
    onReplayAfterSubmit,
    saveAttempt,
    clearPendingMutations,
    getAttemptsByScheduleId,
    pendingMutations,
  };
}

describe('studentMutationOutbox conflict handling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ATTEMPT_SUBMITTED: calls onReplayAfterSubmit, resets mirror, clears watermarks', async () => {
    const deps = createDeps({
      conflictReason: 'ATTEMPT_SUBMITTED',
      saveAttemptError: new Error('conflict'),
    });

    const outbox = createStudentMutationOutbox(deps);

    // Add a pending mutation so flushNow has work to do
    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();

    expect(result).toBe(true);
    expect(deps.onReplayAfterSubmit).toHaveBeenCalledTimes(1);
    expect(deps.clearAttemptMutationWatermark).toHaveBeenCalledTimes(1);
  });

  it('SECTION_MISMATCH: returns false, syncs with saving/offline state', async () => {
    const deps = createDeps({
      conflictReason: 'SECTION_MISMATCH',
      saveAttemptError: new Error('conflict'),
    });

    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();

    expect(result).toBe(false);
    expect(deps.syncAttemptState).toHaveBeenCalled();
    const lastCall = deps.syncAttemptState.mock.calls[deps.syncAttemptState.mock.calls.length - 1];
    expect(lastCall[0].recovery.syncState).toBe('saving');
  });

  it('OBJECTIVE_LOCKED: returns false, syncs with saving/offline state', async () => {
    const deps = createDeps({
      conflictReason: 'OBJECTIVE_LOCKED',
      saveAttemptError: new Error('conflict'),
    });

    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();

    expect(result).toBe(false);
    expect(deps.syncAttemptState).toHaveBeenCalled();
    const lastCall = deps.syncAttemptState.mock.calls[deps.syncAttemptState.mock.calls.length - 1];
    expect(lastCall[0].recovery.syncState).toBe('saving');
  });

  it('unknown error: returns false, syncs with error state', async () => {
    const deps = createDeps({
      saveAttemptError: new Error('network failure'),
    });

    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();

    expect(result).toBe(false);
    const lastCall = deps.syncAttemptState.mock.calls[deps.syncAttemptState.mock.calls.length - 1];
    expect(lastCall[0].recovery.syncState).toBe('error');
  });

  it('returns true immediately when persistence is disabled', async () => {
    const deps = createDeps({ persistenceEnabled: false });
    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();
    expect(result).toBe(true);
  });

  it('returns false when offline', async () => {
    const deps = createDeps({ online: false });
    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();
    expect(result).toBe(false);
    const lastCall = deps.syncAttemptState.mock.calls[deps.syncAttemptState.mock.calls.length - 1];
    expect(lastCall[0].recovery.syncState).toBe('offline');
  });

  it('returns true when no pending mutations', async () => {
    const deps = createDeps();
    const outbox = createStudentMutationOutbox(deps);

    const result = await outbox.flushNow();
    expect(result).toBe(true);
  });

  it('returns true when no attempt', async () => {
    const deps = createDeps();
    deps.getAttempt.mockReturnValue(null);
    const outbox = createStudentMutationOutbox(deps);

    const result = await outbox.flushNow();
    expect(result).toBe(true);
  });

  it('retries credential refresh and returns false if refresh fails', async () => {
    const deps = createDeps({ hasCredential: false });
    deps.refreshAttemptCredentialForAttempt.mockResolvedValue(false);

    const outbox = createStudentMutationOutbox(deps);

    deps.mirror.setPendingMutations([makeMutation()], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
    });

    const result = await outbox.flushNow();
    expect(result).toBe(false);
  });
});
