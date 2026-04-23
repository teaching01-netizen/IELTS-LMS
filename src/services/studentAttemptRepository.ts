import {
  backendGet,
  backendPost,
  rememberAttemptSchedule,
} from './backendBridge';
import type { ApiRequestConfig } from '../app/api/apiClient';
import type {
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptSeed,
  StudentHeartbeatEvent,
} from '../types/studentAttempt';
import {
  mergeStudentAttemptRecovery,
  normalizeStudentAttempt,
} from './studentAttemptNormalization';

const STORAGE_KEY_ATTEMPTS = 'ielts_student_attempts_v1';
const STORAGE_KEY_PENDING_MUTATIONS = 'ielts_student_attempt_pending_mutations_v1';
const STORAGE_KEY_HEARTBEAT_EVENTS = 'ielts_student_attempt_heartbeat_events_v1';
const STORAGE_KEY_ATTEMPT_CREDENTIALS = 'ielts_student_attempt_credentials_v1';
const MAX_HEARTBEAT_EVENTS_PER_ATTEMPT = 200;
const MAX_HEARTBEAT_FLUSH_EVENTS = 50;
const MUTATION_BATCH_CHUNK_SIZE = 100;

interface PendingAttemptMutationRecord {
  attemptId: string;
  mutations: StudentAttemptMutation[];
}

interface BackendStudentAttempt {
  id: string;
  scheduleId: string;
  studentKey: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  phase: StudentAttempt['phase'];
  currentModule: StudentAttempt['currentModule'];
  currentQuestionId?: string | null | undefined;
  answers?: StudentAttempt['answers'] | null | undefined;
  writingAnswers?: StudentAttempt['writingAnswers'] | null | undefined;
  flags?: StudentAttempt['flags'] | null | undefined;
  violationsSnapshot?: StudentAttempt['violations'] | null | undefined;
  integrity?: Partial<StudentAttempt['integrity']> | null | undefined;
  recovery?: Partial<StudentAttempt['recovery']> | null | undefined;
  createdAt: string;
  updatedAt: string;
}

interface BackendStudentSessionContext {
  attempt?: BackendStudentAttempt | null | undefined;
  attemptCredential?: BackendAttemptCredential | null | undefined;
}

interface BackendMutationBatchResponse {
  attempt: BackendStudentAttempt;
  appliedMutationCount: number;
  serverAcceptedThroughSeq: number;
  refreshedAttemptCredential?: BackendAttemptCredential | null | undefined;
}

interface BackendHeartbeatResponse {
  attempt: BackendStudentAttempt;
  refreshedAttemptCredential?: BackendAttemptCredential | null | undefined;
}

interface BackendSubmitResponse {
  attempt: BackendStudentAttempt;
  submissionId: string;
  submittedAt: string;
  refreshedAttemptCredential?: BackendAttemptCredential | null | undefined;
}

interface BackendAttemptCredential {
  attemptToken: string;
  expiresAt: string;
}

interface StoredAttemptCredential extends BackendAttemptCredential {
  attemptId: string;
  scheduleId: string;
}

const mutationSequenceWatermarks = new Map<string, number>();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
}

function getAttemptCredentialStorage(): StoredAttemptCredential[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.sessionStorage.getItem(STORAGE_KEY_ATTEMPT_CREDENTIALS);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as StoredAttemptCredential[];
  } catch {
    return [];
  }
}

function setAttemptCredentialStorage(credentials: StoredAttemptCredential[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(
    STORAGE_KEY_ATTEMPT_CREDENTIALS,
    JSON.stringify(credentials),
  );
}

function storeAttemptCredential(
  attempt: Pick<StudentAttempt, 'id' | 'scheduleId'>,
  credential: BackendAttemptCredential | null | undefined,
): void {
  if (!credential) {
    return;
  }

  const credentials = getAttemptCredentialStorage().filter(
    (candidate) =>
      !(candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId),
  );
  credentials.push({
    attemptId: attempt.id,
    scheduleId: attempt.scheduleId,
    attemptToken: credential.attemptToken,
    expiresAt: credential.expiresAt,
  });
  setAttemptCredentialStorage(credentials);
}

function loadAttemptCredential(
  attempt: Pick<StudentAttempt, 'id' | 'scheduleId'>,
): StoredAttemptCredential | null {
  return (
    getAttemptCredentialStorage().find(
      (candidate) =>
        candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId,
    ) ?? null
  );
}

function buildAttemptAuthorizationHeader(
  attempt: Pick<StudentAttempt, 'id' | 'scheduleId'>,
): Record<string, string> {
  const credential = loadAttemptCredential(attempt);
  if (!credential) {
    throw new Error('Missing attempt credential for student session.');
  }

  return {
    Authorization: `Bearer ${credential.attemptToken}`,
  };
}

export function tryBuildAttemptAuthorizationHeader(
  scheduleId: string,
  attemptId: string,
): Record<string, string> | null {
  try {
    return buildAttemptAuthorizationHeader({ scheduleId, id: attemptId });
  } catch {
    return null;
  }
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 401
  );
}

function isMissingAttemptCredentialError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('missing attempt credential');
}

function getClientSessionStorageKey(scheduleId: string, studentKey: string): string {
  return `ielts-student-client-session:${scheduleId}:${studentKey}`;
}

function ensureClientSessionId(
  scheduleId: string,
  studentKey: string,
  preferredId?: string | null,
): string {
  if (typeof window === 'undefined') {
    return generateUuid();
  }

  const storageKey = getClientSessionStorageKey(scheduleId, studentKey);
  const stored = window.sessionStorage.getItem(storageKey);
  const normalizedPreferred = preferredId?.trim() ?? '';
  if (stored && normalizedPreferred && stored !== normalizedPreferred) {
    // If the backend has recorded a clientSessionId for this attempt, treat it as authoritative
    // and override any stale/mismatched sessionStorage value to prevent mutation sequence drift.
    window.sessionStorage.setItem(storageKey, normalizedPreferred);
    return normalizedPreferred;
  }

  if (stored) {
    return stored;
  }

  if (normalizedPreferred) {
    window.sessionStorage.setItem(storageKey, normalizedPreferred);
    return normalizedPreferred;
  }

  const generated = generateUuid();
  window.sessionStorage.setItem(storageKey, generated);
  return generated;
}

export function ensureClientSessionIdForAttempt(attempt: StudentAttempt): string {
  return ensureClientSessionId(
    attempt.scheduleId,
    attempt.studentKey,
    attempt.recovery.clientSessionId ?? attempt.integrity.clientSessionId,
  );
}

export async function refreshAttemptCredentialForAttempt(attempt: StudentAttempt): Promise<boolean> {
  const clientSessionId = ensureClientSessionIdForAttempt(attempt);
  const query = new URLSearchParams({
    refreshAttemptCredential: 'true',
    clientSessionId,
  });

  const session = await backendGet<BackendStudentSessionContext>(
    `/v1/student/sessions/${attempt.scheduleId}?${query.toString()}`,
    { retries: 0 },
  );

  if (!session.attemptCredential) {
    return false;
  }

  storeAttemptCredential(attempt, session.attemptCredential);
  return true;
}

function mutationWatermarkKey(attemptId: string, clientSessionId: string): string {
  return `${attemptId}:${clientSessionId}`;
}

export function mapBackendStudentAttempt(payload: BackendStudentAttempt): StudentAttempt {
  rememberAttemptSchedule(payload.id, payload.scheduleId);

  return normalizeStudentAttempt({
    id: payload.id,
    scheduleId: payload.scheduleId,
    studentKey: payload.studentKey,
    examId: payload.examId,
    examTitle: payload.examTitle,
    candidateId: payload.candidateId,
    candidateName: payload.candidateName,
    candidateEmail: payload.candidateEmail,
    phase: payload.phase,
    currentModule: payload.currentModule,
    currentQuestionId: payload.currentQuestionId ?? null,
    answers: payload.answers ?? {},
    writingAnswers: payload.writingAnswers ?? {},
    flags: payload.flags ?? {},
    violations: payload.violationsSnapshot ?? [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    integrity: {
      preCheck: payload.integrity?.preCheck ?? null,
      deviceFingerprintHash: payload.integrity?.deviceFingerprintHash ?? null,
      clientSessionId:
        payload.integrity?.clientSessionId ??
        payload.recovery?.clientSessionId ??
        null,
      lastDisconnectAt: payload.integrity?.lastDisconnectAt ?? null,
      lastReconnectAt: payload.integrity?.lastReconnectAt ?? null,
      lastHeartbeatAt: payload.integrity?.lastHeartbeatAt ?? null,
      lastHeartbeatStatus: payload.integrity?.lastHeartbeatStatus ?? 'idle',
    },
    recovery: {
      lastRecoveredAt: payload.recovery?.lastRecoveredAt ?? null,
      lastLocalMutationAt: payload.recovery?.lastLocalMutationAt ?? null,
      lastPersistedAt: payload.recovery?.lastPersistedAt ?? null,
      pendingMutationCount: payload.recovery?.pendingMutationCount ?? 0,
      serverAcceptedThroughSeq: payload.recovery?.serverAcceptedThroughSeq ?? 0,
      clientSessionId:
        payload.recovery?.clientSessionId ??
        payload.integrity?.clientSessionId ??
        null,
      syncState: payload.recovery?.syncState ?? 'idle',
    },
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
}

function primeMutationSequenceWatermark(attempt: StudentAttempt): void {
  const backendSeq = attempt.recovery.serverAcceptedThroughSeq ?? 0;
  const clientSessionId = attempt.recovery.clientSessionId ?? attempt.integrity.clientSessionId;
  if (!clientSessionId) {
    return;
  }

  const key = mutationWatermarkKey(attempt.id, clientSessionId);
  const current = mutationSequenceWatermarks.get(key);
  if (current === undefined || backendSeq > current) {
    mutationSequenceWatermarks.set(key, backendSeq);
  }
}

export function hasAttemptCredential(scheduleId: string, attemptId: string): boolean {
  return getAttemptCredentialStorage().some(
    (candidate) =>
      candidate.scheduleId === scheduleId && candidate.attemptId === attemptId,
  );
}

export interface IStudentAttemptRepository {
  getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null>;
  getAllAttempts(): Promise<StudentAttempt[]>;
  getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]>;
  saveAttempt(attempt: StudentAttempt): Promise<void>;
  submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt>;
  createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt>;
  savePendingMutations(attemptId: string, mutations: StudentAttemptMutation[]): Promise<void>;
  getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]>;
  clearPendingMutations(attemptId: string): Promise<void>;
  saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void>;
  getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]>;
  deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void>;
  flushHeartbeatEvents(attemptId: string): Promise<boolean>;
}

class LocalStorageStudentAttemptCache implements IStudentAttemptRepository {
  private getItem<T>(key: string): T[] {
    const item = localStorage.getItem(key);
    if (!item) {
      return [];
    }

    try {
      const parsed = JSON.parse(item) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private setItem<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  async getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    const exactMatch =
      attempts.find((attempt) => attempt.scheduleId === scheduleId && attempt.studentKey === studentKey) ??
      null;

    if (exactMatch) {
      return exactMatch;
    }

    const prefix = `student-${scheduleId}-`;
    const candidateId = studentKey.startsWith(prefix)
      ? studentKey.slice(prefix.length)
      : studentKey.split('-').pop() || studentKey;

    return (
      attempts.find(
        (attempt) => attempt.scheduleId === scheduleId && attempt.candidateId === candidateId,
      ) ?? null
    );
  }

  async getAllAttempts(): Promise<StudentAttempt[]> {
    return this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
  }

  async getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    return attempts.filter((attempt) => attempt.scheduleId === scheduleId);
  }

  async saveAttempt(attempt: StudentAttempt): Promise<void> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    const normalizedAttempt = normalizeStudentAttempt({
      ...attempt,
      updatedAt: new Date().toISOString(),
    });
    const index = attempts.findIndex((candidate) => candidate.id === normalizedAttempt.id);

    if (index >= 0) {
      attempts[index] = normalizedAttempt;
    } else {
      attempts.push(normalizedAttempt);
    }

    this.setItem(STORAGE_KEY_ATTEMPTS, attempts);
  }

  async submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    const submittedAttempt = normalizeStudentAttempt({
      ...attempt,
      phase: 'post-exam',
      currentQuestionId: null,
      recovery: {
        ...attempt.recovery,
        lastPersistedAt: new Date().toISOString(),
        pendingMutationCount: 0,
        syncState: 'saved',
      },
    });

    await this.saveAttempt(submittedAttempt);
    await this.clearPendingMutations(attempt.id);
    return submittedAttempt;
  }

  async createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    const now = new Date().toISOString();
    const attempt: StudentAttempt = {
      id: generateId('attempt'),
      scheduleId: seed.scheduleId,
      studentKey: seed.studentKey,
      examId: seed.examId,
      examTitle: seed.examTitle,
      candidateId: seed.candidateId,
      candidateName: seed.candidateName,
      candidateEmail: seed.candidateEmail,
      phase: seed.phase ?? 'pre-check',
      currentModule: seed.currentModule ?? 'listening',
      currentQuestionId: seed.currentQuestionId ?? null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
        clientSessionId: null,
        lastDisconnectAt: null,
        lastReconnectAt: null,
        lastHeartbeatAt: null,
        lastHeartbeatStatus: 'idle',
      },
      recovery: {
        lastRecoveredAt: null,
        lastLocalMutationAt: null,
        lastPersistedAt: null,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'idle',
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.saveAttempt(attempt);
    return attempt;
  }

  async savePendingMutations(attemptId: string, mutations: StudentAttemptMutation[]): Promise<void> {
    const pending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    const index = pending.findIndex((entry) => entry.attemptId === attemptId);
    const nextEntry: PendingAttemptMutationRecord = {
      attemptId,
      mutations,
    };

    if (index >= 0) {
      pending[index] = nextEntry;
    } else {
      pending.push(nextEntry);
    }

    this.setItem(STORAGE_KEY_PENDING_MUTATIONS, pending);
  }

  async getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]> {
    const pending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    return pending.find((entry) => entry.attemptId === attemptId)?.mutations ?? [];
  }

  async clearPendingMutations(attemptId: string): Promise<void> {
    const pending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    this.setItem(
      STORAGE_KEY_PENDING_MUTATIONS,
      pending.filter((entry) => entry.attemptId !== attemptId),
    );
  }

  async saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    events.push(event);
    const attemptEvents = events
      .filter((candidate) => candidate.attemptId === event.attemptId)
      .sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      );
    const pruned =
      attemptEvents.length > MAX_HEARTBEAT_EVENTS_PER_ATTEMPT
        ? attemptEvents.slice(attemptEvents.length - MAX_HEARTBEAT_EVENTS_PER_ATTEMPT)
        : attemptEvents;
    const other = events.filter((candidate) => candidate.attemptId !== event.attemptId);
    this.setItem(STORAGE_KEY_HEARTBEAT_EVENTS, [...other, ...pruned]);
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    return events
      .filter((event) => event.attemptId === attemptId)
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  }

  async deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    this.setItem(
      STORAGE_KEY_HEARTBEAT_EVENTS,
      events.filter((event) => !(event.attemptId === attemptId && event.id === eventId)),
    );
  }

  async flushHeartbeatEvents(_attemptId: string): Promise<boolean> {
    return false;
  }
}

class BackendStudentAttemptRepository implements IStudentAttemptRepository {
  constructor(private readonly cache: LocalStorageStudentAttemptCache) {}

  private async refreshAttemptCredential(attempt: StudentAttempt): Promise<boolean> {
    try {
      return await refreshAttemptCredentialForAttempt(attempt);
    } catch {
      return false;
    }
  }

  private async ensureAttemptCredential(attempt: StudentAttempt): Promise<boolean> {
    if (hasAttemptCredential(attempt.scheduleId, attempt.id)) {
      return true;
    }

    return this.refreshAttemptCredential(attempt);
  }

  private async postWithAttemptAuth<T>(
    attempt: StudentAttempt,
    endpoint: string,
    body: unknown,
    options?: Omit<ApiRequestConfig, 'headers'> & {
      headers?: Record<string, string> | undefined;
    },
  ): Promise<T> {
    const doPost = async (): Promise<T> =>
      backendPost<T>(
        endpoint,
        body,
        {
          ...options,
          headers: {
            ...(options?.headers ?? {}),
            ...buildAttemptAuthorizationHeader(attempt),
          },
        },
      );

    try {
      return await doPost();
    } catch (error) {
      const shouldRetry = isUnauthorizedError(error) || isMissingAttemptCredentialError(error);
      if (!shouldRetry) {
        throw error;
      }

      const refreshed = isUnauthorizedError(error)
        ? await this.refreshAttemptCredential(attempt)
        : await this.ensureAttemptCredential(attempt);
      if (!refreshed) {
        throw error;
      }

      return doPost();
    }
  }

  private async cacheAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    await this.cache.saveAttempt(attempt);
    primeMutationSequenceWatermark(attempt);
    return attempt;
  }

  async getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null> {
    const session = await backendGet<BackendStudentSessionContext>(
      `/v1/student/sessions/${scheduleId}`,
    );
    if (!session.attempt) {
      return null;
    }

    const attempt = mapBackendStudentAttempt(session.attempt);
    storeAttemptCredential(attempt, session.attemptCredential);
    return this.cacheAttempt(attempt);
  }

  async getAllAttempts(): Promise<StudentAttempt[]> {
    return this.cache.getAllAttempts();
  }

  async getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    return this.cache.getAttemptsByScheduleId(scheduleId);
  }

  async saveAttempt(attempt: StudentAttempt): Promise<void> {
    await this.cache.saveAttempt(attempt);
    primeMutationSequenceWatermark(attempt);

    const pendingMutations = await this.cache.getPendingMutations(attempt.id);
    if (pendingMutations.length === 0) {
      return;
    }

    if (!(await this.ensureAttemptCredential(attempt))) {
      return;
    }

    const clientSessionId = ensureClientSessionIdForAttempt(attempt);
    const watermarkKey = mutationWatermarkKey(attempt.id, clientSessionId);
    let nextSeq = mutationSequenceWatermarks.get(watermarkKey) ?? 0;
    let remainingMutations = [...pendingMutations];
    try {
      while (remainingMutations.length > 0) {
        const chunk = remainingMutations.slice(0, MUTATION_BATCH_CHUNK_SIZE);
        const response = await this.postWithAttemptAuth<BackendMutationBatchResponse>(
          attempt,
          `/v1/student/sessions/${attempt.scheduleId}/mutations:batch`,
          {
            attemptId: attempt.id,
            studentKey: attempt.studentKey,
            clientSessionId,
            mutations: chunk.map((mutation, index) => ({
              id: mutation.id,
              seq: nextSeq + index + 1,
              timestamp: mutation.timestamp,
              mutationType: mutation.type,
              payload: mutation.payload,
            })),
          },
          undefined,
        );

        nextSeq = response.serverAcceptedThroughSeq;
        mutationSequenceWatermarks.set(watermarkKey, response.serverAcceptedThroughSeq);
        storeAttemptCredential(attempt, response.refreshedAttemptCredential);

        remainingMutations = remainingMutations.slice(chunk.length);
        await this.cache.savePendingMutations(attempt.id, remainingMutations);

        await this.cache.saveAttempt(
          mergeStudentAttemptRecovery(mapBackendStudentAttempt(response.attempt), {
            lastLocalMutationAt: attempt.recovery.lastLocalMutationAt,
            lastPersistedAt: attempt.recovery.lastPersistedAt,
            pendingMutationCount: remainingMutations.length,
            serverAcceptedThroughSeq: response.serverAcceptedThroughSeq,
            syncState: attempt.recovery.syncState,
          }),
        );
      }
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = error instanceof Error ? error.message : '';
      const isSequenceMismatch =
        statusCode === 409 &&
        message.toLowerCase().includes('mutation sequence must continue');

      if (!isSequenceMismatch) {
        throw error;
      }

      // Treat sequence mismatch as "server already accepted these mutations" and resync.
      await this.cache.clearPendingMutations(attempt.id);
      mutationSequenceWatermarks.delete(watermarkKey);

      const session = await backendGet<BackendStudentSessionContext>(
        `/v1/student/sessions/${attempt.scheduleId}`,
        { retries: 0 },
      );
      if (session.attempt) {
        const refreshedAttempt = mapBackendStudentAttempt(session.attempt);
        storeAttemptCredential(refreshedAttempt, session.attemptCredential);
        primeMutationSequenceWatermark(refreshedAttempt);
        await this.cache.saveAttempt(refreshedAttempt);
      }
    }
  }

  async submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    if (!(await this.ensureAttemptCredential(attempt))) {
      throw new Error('Missing attempt credential for student session.');
    }

    const response = await this.postWithAttemptAuth<BackendSubmitResponse>(
      attempt,
      `/v1/student/sessions/${attempt.scheduleId}/submit`,
      {
        attemptId: attempt.id,
        studentKey: attempt.studentKey,
      },
      {
        headers: {
          'Idempotency-Key': `student-submit-${attempt.id}`,
        },
        timeout: 60_000,
        retries: 0,
      },
    );

    const submittedAttempt = mapBackendStudentAttempt(response.attempt);
    storeAttemptCredential(attempt, response.refreshedAttemptCredential);
    await this.cache.saveAttempt(submittedAttempt);
    await this.cache.clearPendingMutations(attempt.id);
    const clientSessionId = ensureClientSessionIdForAttempt(attempt);
    mutationSequenceWatermarks.set(
      mutationWatermarkKey(attempt.id, clientSessionId),
      Number.MAX_SAFE_INTEGER,
    );
    return submittedAttempt;
  }

  async createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    const session = await backendPost<BackendStudentSessionContext>(
      `/v1/student/sessions/${seed.scheduleId}/bootstrap`,
      {
        studentKey: seed.studentKey,
        candidateId: seed.candidateId,
        candidateName: seed.candidateName,
        candidateEmail: seed.candidateEmail,
        clientSessionId: ensureClientSessionId(seed.scheduleId, seed.studentKey, null),
      },
    );

    if (!session.attempt) {
      throw new Error('Backend bootstrap did not return an attempt');
    }

    const attempt = mapBackendStudentAttempt(session.attempt);
    storeAttemptCredential(attempt, session.attemptCredential);
    return this.cacheAttempt(attempt);
  }

  async savePendingMutations(attemptId: string, mutations: StudentAttemptMutation[]): Promise<void> {
    await this.cache.savePendingMutations(attemptId, mutations);
  }

  async getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]> {
    return this.cache.getPendingMutations(attemptId);
  }

  async clearPendingMutations(attemptId: string): Promise<void> {
    await this.cache.clearPendingMutations(attemptId);
  }

  async saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void> {
    await this.cache.saveHeartbeatEvent(event);

    const attempts = await this.cache.getAllAttempts();
    const attempt = attempts.find((candidate) => candidate.id === event.attemptId);
    if (!attempt) {
      return;
    }

    if (!(await this.ensureAttemptCredential(attempt))) {
      return;
    }

    try {
      const response = await this.postWithAttemptAuth<BackendHeartbeatResponse>(
        attempt,
        `/v1/student/sessions/${event.scheduleId}/heartbeat`,
        {
          attemptId: event.attemptId,
          studentKey: attempt.studentKey,
          clientSessionId: ensureClientSessionIdForAttempt(attempt),
          eventType: event.type,
          payload: event.payload,
          clientTimestamp: event.timestamp,
        },
        undefined,
      );

      storeAttemptCredential(attempt, response.refreshedAttemptCredential);
      await this.cacheAttempt(mapBackendStudentAttempt(response.attempt));
      await this.cache.deleteHeartbeatEvent(event.attemptId, event.id);
    } catch {
      // Keep the event in storage for replay on reconnect.
    }
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    return this.cache.getHeartbeatEvents(attemptId);
  }

  async deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void> {
    await this.cache.deleteHeartbeatEvent(attemptId, eventId);
  }

  async flushHeartbeatEvents(attemptId: string): Promise<boolean> {
    const attempts = await this.cache.getAllAttempts();
    const attempt = attempts.find((candidate) => candidate.id === attemptId);
    if (!attempt) {
      return false;
    }

    if (!(await this.ensureAttemptCredential(attempt))) {
      return false;
    }

    const events = await this.cache.getHeartbeatEvents(attemptId);
    if (events.length === 0) {
      return true;
    }

    const toFlush = events.slice(0, MAX_HEARTBEAT_FLUSH_EVENTS);
    for (const event of toFlush) {
      try {
        const response = await this.postWithAttemptAuth<BackendHeartbeatResponse>(
          attempt,
          `/v1/student/sessions/${event.scheduleId}/heartbeat`,
          {
            attemptId: event.attemptId,
            studentKey: attempt.studentKey,
            clientSessionId: ensureClientSessionIdForAttempt(attempt),
            eventType: event.type,
            payload: event.payload,
            clientTimestamp: event.timestamp,
          },
          undefined,
        );

        storeAttemptCredential(attempt, response.refreshedAttemptCredential);
        await this.cacheAttempt(mapBackendStudentAttempt(response.attempt));
        await this.cache.deleteHeartbeatEvent(event.attemptId, event.id);
      } catch {
        return false;
      }
    }

    return true;
  }
}

const studentAttemptCache = new LocalStorageStudentAttemptCache();
export const studentAttemptRepository: IStudentAttemptRepository = new BackendStudentAttemptRepository(
  studentAttemptCache,
);
