import {
  backendGet,
  backendPost,
  rememberAttemptSchedule,
} from './backendBridge';
import { ApiClientError, type ApiRequestConfig } from '../app/api/apiClient';
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
import type { ModuleType } from '../types';

const STORAGE_KEY_ATTEMPTS = 'ielts_student_attempts_v1';
const STORAGE_KEY_PENDING_MUTATIONS = 'ielts_student_attempt_pending_mutations_v1';
const STORAGE_KEY_HEARTBEAT_EVENTS = 'ielts_student_attempt_heartbeat_events_v1';
const STORAGE_KEY_ATTEMPT_CREDENTIALS = 'ielts_student_attempt_credentials_v1';
const STORAGE_KEY_CLIENT_SESSION_PREFIX = 'ielts-student-client-session:v1:';
const STORAGE_KEY_MUTATION_WATERMARK_PREFIX = 'ielts-student-mutation-watermark:v1:';
const MAX_HEARTBEAT_EVENTS_PER_ATTEMPT = 200;
const MAX_HEARTBEAT_FLUSH_EVENTS = 50;
const MUTATION_BATCH_CHUNK_SIZE = 100;

type FlushQueueResult =
  | { ok: true; nextSeq: number; attempt: StudentAttempt }
  | {
      ok: false;
      error: unknown;
      nextSeq: number;
      remainingMutations: StudentAttemptMutation[];
      attempt: StudentAttempt;
    };

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
  finalSubmission?:
    | {
        submissionId?: string | null | undefined;
        submittedAt?: string | null | undefined;
        answers?: StudentAttempt['answers'] | null | undefined;
        writingAnswers?: StudentAttempt['writingAnswers'] | null | undefined;
        flags?: StudentAttempt['flags'] | null | undefined;
      }
    | null
    | undefined;
  submittedAt?: string | null | undefined;
  integrity?: Partial<StudentAttempt['integrity']> | null | undefined;
  recovery?: Partial<StudentAttempt['recovery']> | null | undefined;
  createdAt: string;
  updatedAt: string;
}

interface BackendStudentSessionContext {
  attempt?: BackendStudentAttempt | null | undefined;
  attemptCredential?: BackendAttemptCredential | null | undefined;
  runtime?:
    | {
        status: string;
        currentSectionKey?: ModuleType | null | undefined;
      }
    | null
    | undefined;
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

function getBrowserStorage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    const owner =
      typeof window !== 'undefined'
        ? (window as any)
        : typeof globalThis !== 'undefined'
          ? (globalThis as any)
          : null;
    const storage = owner?.[type] as Storage | undefined;
    return storage ?? null;
  } catch {
    return null;
  }
}

function parseAttemptCredentialStorage(raw: string | null): StoredAttemptCredential[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((candidate): candidate is StoredAttemptCredential => {
      if (!candidate || typeof candidate !== 'object') {
        return false;
      }
      const record = candidate as Partial<StoredAttemptCredential>;
      return (
        typeof record.attemptId === 'string' &&
        typeof record.scheduleId === 'string' &&
        typeof record.attemptToken === 'string' &&
        typeof record.expiresAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

function mergeAttemptCredentials(
  localCredentials: StoredAttemptCredential[],
  sessionCredentials: StoredAttemptCredential[],
): StoredAttemptCredential[] {
  const merged = new Map<string, StoredAttemptCredential>();

  const upsert = (credential: StoredAttemptCredential) => {
    const key = `${credential.scheduleId}:${credential.attemptId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, credential);
      return;
    }

    const existingExpires = Date.parse(existing.expiresAt);
    const candidateExpires = Date.parse(credential.expiresAt);
    if (!Number.isFinite(existingExpires) || candidateExpires > existingExpires) {
      merged.set(key, credential);
      return;
    }

    // If expiry timestamps are equal/unparseable, prefer the newer token payload.
    if (existing.expiresAt === credential.expiresAt) {
      merged.set(key, credential);
    }
  };

  for (const credential of localCredentials) {
    upsert(credential);
  }
  for (const credential of sessionCredentials) {
    upsert(credential);
  }

  return [...merged.values()];
}

function getAttemptCredentialStorage(): StoredAttemptCredential[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const local = getBrowserStorage('localStorage');
  const session = getBrowserStorage('sessionStorage');

  const localCredentials = parseAttemptCredentialStorage(
    local?.getItem(STORAGE_KEY_ATTEMPT_CREDENTIALS) ?? null,
  );
  const sessionCredentials = parseAttemptCredentialStorage(
    session?.getItem(STORAGE_KEY_ATTEMPT_CREDENTIALS) ?? null,
  );

  const merged = mergeAttemptCredentials(localCredentials, sessionCredentials);
  return merged;
}

function setAttemptCredentialStorage(credentials: StoredAttemptCredential[]): void {
  const local = getBrowserStorage('localStorage');
  const session = getBrowserStorage('sessionStorage');
  const payload = JSON.stringify(credentials);

  try {
    local?.setItem(STORAGE_KEY_ATTEMPT_CREDENTIALS, payload);
  } catch {
    // ignore
  }

  try {
    session?.setItem(STORAGE_KEY_ATTEMPT_CREDENTIALS, payload);
  } catch {
    // ignore
  }
}

function clearAttemptCredential(attempt: Pick<StudentAttempt, 'id' | 'scheduleId'>): void {
  const credentials = getAttemptCredentialStorage().filter(
    (candidate) =>
      !(candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId),
  );
  setAttemptCredentialStorage(credentials);
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
  const credential =
    getAttemptCredentialStorage().find(
      (candidate) =>
        candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId,
    ) ?? null;

  return credential;
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

function isObjectiveMutation(mutation: StudentAttemptMutation): boolean {
  return mutation.type === 'answer' || mutation.type === 'flag' || mutation.type === 'writing_answer';
}

function mutationModuleKey(mutation: StudentAttemptMutation): ModuleType | null {
  const value = mutation.payload['module'];
  return typeof value === 'string' && value.trim() ? (value as ModuleType) : null;
}

function backendConflictReason(error: unknown): string | null {
  if (error instanceof ApiClientError) {
    const reason = error.backendDetails?.['reason'];
    return typeof reason === 'string' && reason.trim() ? reason : null;
  }

  if (typeof error === 'object' && error !== null && 'backendDetails' in error) {
    const details = (error as { backendDetails?: unknown }).backendDetails;
    if (details && typeof details === 'object' && 'reason' in (details as Record<string, unknown>)) {
      const reason = (details as Record<string, unknown>)['reason'];
      return typeof reason === 'string' && reason.trim() ? reason : null;
    }
  }

  return null;
}

function getClientSessionStorageKey(scheduleId: string, studentKey: string): string {
  return `${STORAGE_KEY_CLIENT_SESSION_PREFIX}${scheduleId}:${studentKey}`;
}

function getMutationWatermarkStorageKey(attemptId: string, clientSessionId: string): string {
  return `${STORAGE_KEY_MUTATION_WATERMARK_PREFIX}${attemptId}:${clientSessionId}`;
}

function readStoredMutationSequenceWatermark(
  attemptId: string,
  clientSessionId: string,
): number | null {
  const session = getBrowserStorage('sessionStorage');
  if (!session) {
    return null;
  }

  const raw = session.getItem(getMutationWatermarkStorageKey(attemptId, clientSessionId));
  if (raw == null) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function storeMutationSequenceWatermark(
  attemptId: string,
  clientSessionId: string,
  watermark: number,
): void {
  mutationSequenceWatermarks.set(mutationWatermarkKey(attemptId, clientSessionId), watermark);

  const session = getBrowserStorage('sessionStorage');
  if (!session) {
    return;
  }

  try {
    session.setItem(getMutationWatermarkStorageKey(attemptId, clientSessionId), String(watermark));
  } catch {
    // ignore
  }
}

function readOrPrimeMutationSequenceWatermark(attemptId: string, clientSessionId: string): number {
  const key = mutationWatermarkKey(attemptId, clientSessionId);
  const cached = mutationSequenceWatermarks.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const stored = readStoredMutationSequenceWatermark(attemptId, clientSessionId);
  if (stored !== null) {
    mutationSequenceWatermarks.set(key, stored);
    return stored;
  }

  return 0;
}

function ensureClientSessionId(
  scheduleId: string,
  studentKey: string,
): string {
  const session = getBrowserStorage('sessionStorage');
  if (!session) {
    return generateUuid();
  }

  const storageKey = getClientSessionStorageKey(scheduleId, studentKey);
  const stored = session.getItem(storageKey);
  if (stored) {
    return stored;
  }

  const generated = generateUuid();
  try {
    session.setItem(storageKey, generated);
  } catch {
    // ignore
  }
  return generated;
}

export function ensureClientSessionIdForAttempt(attempt: StudentAttempt): string {
  return ensureClientSessionId(attempt.scheduleId, attempt.studentKey);
}

export async function refreshAttemptCredentialForAttempt(attempt: StudentAttempt): Promise<boolean> {
  const clientSessionId = ensureClientSessionIdForAttempt(attempt);
  const query = new URLSearchParams({
    candidateId: attempt.candidateId,
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

  // Backend may omit `answers`/`writingAnswers`/`flags` after submission and only return them
  // nested under `finalSubmission`. The UI still needs these values for completion summary.
  const answers = payload.answers ?? payload.finalSubmission?.answers ?? {};
  const writingAnswers = payload.writingAnswers ?? payload.finalSubmission?.writingAnswers ?? {};
  const flags = payload.flags ?? payload.finalSubmission?.flags ?? {};

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
    answers,
    writingAnswers,
    flags,
    violations: payload.violationsSnapshot ?? [],
    submittedAt: payload.submittedAt ?? null,
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
      lastDroppedMutations: null,
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
  const clientSessionId = ensureClientSessionIdForAttempt(attempt);
  if (!clientSessionId) {
    return;
  }

  const current = readOrPrimeMutationSequenceWatermark(attempt.id, clientSessionId);
  if (backendSeq > current) {
    storeMutationSequenceWatermark(attempt.id, clientSessionId, backendSeq);
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
        lastDroppedMutations: null,
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

  private async recordDroppedMutationsAudit(attempt: StudentAttempt, payload: Record<string, unknown>): Promise<void> {
    try {
      await backendPost(
        `/v1/student/sessions/${attempt.scheduleId}/audit`,
        {
          actionType: 'AUTO_ACTION',
          clientTimestamp: new Date().toISOString(),
          payload: {
            event: 'MUTATION_DROPPED_STALE_SECTION',
            ...payload,
          },
        },
        {
          headers: buildAttemptAuthorizationHeader(attempt),
          retries: 0,
          timeout: 5_000,
        },
      );
    } catch {
      // Best-effort only: never block saving/flush.
    }
  }

  private async flushMutationQueue(args: {
    attempt: StudentAttempt;
    clientSessionId: string;
    watermarkKey: string;
    startSeq: number;
    mutations: StudentAttemptMutation[];
  }): Promise<FlushQueueResult> {
    let currentAttempt = args.attempt;
    let nextSeq = args.startSeq;
    let remainingMutations = [...args.mutations];

    while (remainingMutations.length > 0) {
      const chunk = remainingMutations.slice(0, MUTATION_BATCH_CHUNK_SIZE);
      try {
        const response = await this.postWithAttemptAuth<BackendMutationBatchResponse>(
          currentAttempt,
          `/v1/student/sessions/${currentAttempt.scheduleId}/mutations:batch`,
          {
            attemptId: currentAttempt.id,
            studentKey: currentAttempt.studentKey,
            clientSessionId: args.clientSessionId,
            mutations: chunk.map((mutation, index) => ({
              id: mutation.id,
              seq: nextSeq + index + 1,
              timestamp: mutation.timestamp,
              mutationType: mutation.type,
              payload: mutation.payload,
            })),
          },
          { retries: 0 },
        );

        nextSeq = response.serverAcceptedThroughSeq;
        storeMutationSequenceWatermark(
          currentAttempt.id,
          args.clientSessionId,
          response.serverAcceptedThroughSeq,
        );
        storeAttemptCredential(currentAttempt, response.refreshedAttemptCredential);

        remainingMutations = remainingMutations.slice(chunk.length);
        await this.cache.savePendingMutations(currentAttempt.id, remainingMutations);

        currentAttempt = mergeStudentAttemptRecovery(mapBackendStudentAttempt(response.attempt), {
          lastDroppedMutations: currentAttempt.recovery.lastDroppedMutations,
          lastLocalMutationAt: currentAttempt.recovery.lastLocalMutationAt,
          lastPersistedAt: currentAttempt.recovery.lastPersistedAt,
          pendingMutationCount: remainingMutations.length,
          serverAcceptedThroughSeq: response.serverAcceptedThroughSeq,
          syncState: currentAttempt.recovery.syncState,
        });
        await this.cache.saveAttempt(currentAttempt);
      } catch (error) {
        return {
          ok: false,
          error,
          nextSeq,
          remainingMutations,
          attempt: currentAttempt,
        };
      }
    }

    return { ok: true, nextSeq, attempt: currentAttempt };
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
    let currentAttempt = attempt;
    await this.cache.saveAttempt(currentAttempt);
    primeMutationSequenceWatermark(currentAttempt);

    const pendingMutations = await this.cache.getPendingMutations(currentAttempt.id);
    if (pendingMutations.length === 0) {
      return;
    }

    if (!(await this.ensureAttemptCredential(currentAttempt))) {
      return;
    }

    const clientSessionId = ensureClientSessionIdForAttempt(currentAttempt);
    const watermarkKey = mutationWatermarkKey(currentAttempt.id, clientSessionId);
    const startSeq = readOrPrimeMutationSequenceWatermark(currentAttempt.id, clientSessionId);

    const first = await this.flushMutationQueue({
      attempt: currentAttempt,
      clientSessionId,
      watermarkKey,
      startSeq,
      mutations: pendingMutations,
    });
    if (first.ok) {
      return;
    }

    currentAttempt = first.attempt;
    const statusCode = (first.error as { statusCode?: number }).statusCode;
    const message = first.error instanceof Error ? first.error.message : '';
    const reason = statusCode === 409 ? backendConflictReason(first.error) : null;
    const isSequenceMismatch =
      statusCode === 409 && message.toLowerCase().includes('mutation sequence must continue');

    if (isSequenceMismatch) {
      // Treat sequence mismatch as "server already accepted these mutations" and resync.
      await this.cache.clearPendingMutations(currentAttempt.id);
      mutationSequenceWatermarks.delete(watermarkKey);
      try {
        getBrowserStorage('sessionStorage')?.removeItem(
          getMutationWatermarkStorageKey(currentAttempt.id, clientSessionId),
        );
      } catch {
        // ignore
      }

      const session = await backendGet<BackendStudentSessionContext>(
        `/v1/student/sessions/${currentAttempt.scheduleId}`,
        { retries: 0 },
      );
      if (session.attempt) {
        const refreshedAttempt = mapBackendStudentAttempt(session.attempt);
        storeAttemptCredential(refreshedAttempt, session.attemptCredential);
        primeMutationSequenceWatermark(refreshedAttempt);
        await this.cache.saveAttempt(refreshedAttempt);
      }
      return;
    }

    const shouldAttemptPrune =
      statusCode === 409 && (reason === 'SECTION_MISMATCH' || reason === 'OBJECTIVE_LOCKED');
    if (!shouldAttemptPrune) {
      throw first.error;
    }

    const session = await backendGet<BackendStudentSessionContext>(
      `/v1/student/sessions/${currentAttempt.scheduleId}`,
      { retries: 0 },
    );
    const runtimeStatus = session.runtime?.status ?? null;
    const runtimeSectionKey = session.runtime?.currentSectionKey ?? null;
    const runtimeTerminal = runtimeStatus === 'completed' || runtimeStatus === 'cancelled';

    const dropped = first.remainingMutations.filter((mutation) => {
      if (!isObjectiveMutation(mutation)) {
        return false;
      }
      if (runtimeTerminal) {
        return true;
      }
      const moduleKey = mutationModuleKey(mutation);
      return !runtimeSectionKey || !moduleKey || moduleKey !== runtimeSectionKey;
    });
    const prunedMutations = first.remainingMutations.filter((mutation) => !dropped.includes(mutation));

    if (dropped.length > 0) {
      const droppedModuleKeys = new Set(
        dropped
          .map(mutationModuleKey)
          .filter((value): value is ModuleType => typeof value === 'string' && value.length > 0),
      );
      const fromModule =
        droppedModuleKeys.size === 0
          ? null
          : droppedModuleKeys.size === 1
            ? ([...droppedModuleKeys][0] ?? null)
            : 'multiple';
      const summary = {
        at: new Date().toISOString(),
        count: dropped.length,
        fromModule,
        toModule: runtimeSectionKey,
        reason: reason ?? 'UNKNOWN',
      } satisfies StudentAttempt['recovery']['lastDroppedMutations'];

      currentAttempt = mergeStudentAttemptRecovery(currentAttempt, {
        lastDroppedMutations: summary,
        pendingMutationCount: prunedMutations.length,
      });
      await this.cache.saveAttempt(currentAttempt);
      void this.recordDroppedMutationsAudit(currentAttempt, {
        at: summary.at,
        count: summary.count,
        fromModule: summary.fromModule,
        toModule: summary.toModule,
        reason: summary.reason,
        runtimeStatus,
      });
    } else {
      currentAttempt = mergeStudentAttemptRecovery(currentAttempt, {
        pendingMutationCount: prunedMutations.length,
      });
      await this.cache.saveAttempt(currentAttempt);
    }

    await this.cache.savePendingMutations(currentAttempt.id, prunedMutations);

    const second = await this.flushMutationQueue({
      attempt: currentAttempt,
      clientSessionId,
      watermarkKey,
      startSeq: first.nextSeq,
      mutations: prunedMutations,
    });
    if (second.ok) {
      return;
    }

    throw second.error;
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
    clearAttemptCredential(attempt);
    await this.cache.saveAttempt(submittedAttempt);
    await this.cache.clearPendingMutations(attempt.id);
    const clientSessionId = ensureClientSessionIdForAttempt(attempt);
    storeMutationSequenceWatermark(attempt.id, clientSessionId, Number.MAX_SAFE_INTEGER);
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
        clientSessionId: ensureClientSessionId(seed.scheduleId, seed.studentKey),
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
