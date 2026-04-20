import {
  backendGet,
  backendPost,
  isBackendDeliveryEnabled,
  rememberAttemptSchedule,
} from './backendBridge';
import type {
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptSeed,
  StudentHeartbeatEvent,
} from '../types/studentAttempt';

const STORAGE_KEY_ATTEMPTS = 'ielts_student_attempts_v1';
const STORAGE_KEY_PENDING_MUTATIONS = 'ielts_student_attempt_pending_mutations_v1';
const STORAGE_KEY_HEARTBEAT_EVENTS = 'ielts_student_attempt_heartbeat_events_v1';
const STORAGE_KEY_ATTEMPT_CREDENTIALS = 'ielts_student_attempt_credentials_v1';

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

const WARNING_VIOLATION_TYPES = new Set(['PROCTOR_WARNING', 'AUTO_WARNING']);
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

function getClientSessionStorageKey(scheduleId: string, studentKey: string): string {
  return `ielts-student-client-session:${scheduleId}:${studentKey}`;
}

function getClientSessionId(scheduleId: string, studentKey: string): string {
  if (typeof window === 'undefined') {
    return generateUuid();
  }

  const storageKey = getClientSessionStorageKey(scheduleId, studentKey);
  const stored = window.sessionStorage.getItem(storageKey);
  if (stored) {
    return stored;
  }

  const nextId = generateUuid();
  window.sessionStorage.setItem(storageKey, nextId);
  return nextId;
}

function deriveCandidateId(
  attempt: Pick<StudentAttempt, 'candidateId' | 'scheduleId' | 'studentKey' | 'id'>,
): string {
  if (attempt.candidateId) {
    return attempt.candidateId;
  }

  const prefix = `student-${attempt.scheduleId}-`;
  if (attempt.studentKey.startsWith(prefix)) {
    return attempt.studentKey.slice(prefix.length) || attempt.id;
  }

  return attempt.studentKey.split('-').pop() || attempt.id;
}

function deriveProctorStatus(attempt: StudentAttempt): StudentAttempt['proctorStatus'] {
  if (attempt.proctorStatus) {
    return attempt.proctorStatus;
  }

  if (attempt.phase === 'post-exam') {
    return 'terminated';
  }

  const latestWarningId =
    attempt.lastWarningId ??
    [...(attempt.violations ?? [])]
      .reverse()
      .find((violation) => WARNING_VIOLATION_TYPES.has(violation.type))?.id ??
    null;

  if (latestWarningId && latestWarningId !== attempt.lastAcknowledgedWarningId) {
    return 'warned';
  }

  return 'active';
}

function normalizeAttempt(attempt: StudentAttempt): StudentAttempt {
  const candidateId = deriveCandidateId(attempt);
  const lastWarningId =
    attempt.lastWarningId ??
    [...(attempt.violations ?? [])]
      .reverse()
      .find((violation) => WARNING_VIOLATION_TYPES.has(violation.type))?.id ??
    null;

  return {
    ...attempt,
    candidateId,
    candidateName: attempt.candidateName ?? `Candidate ${candidateId}`,
    candidateEmail: attempt.candidateEmail ?? `${candidateId}@example.com`,
    answers: attempt.answers ?? {},
    writingAnswers: attempt.writingAnswers ?? {},
    flags: attempt.flags ?? {},
    violations: attempt.violations ?? [],
    proctorStatus: deriveProctorStatus(attempt),
    proctorNote: attempt.proctorNote ?? null,
    proctorUpdatedAt: attempt.proctorUpdatedAt ?? null,
    proctorUpdatedBy: attempt.proctorUpdatedBy ?? null,
    lastWarningId,
    lastAcknowledgedWarningId: attempt.lastAcknowledgedWarningId ?? null,
    integrity: {
      preCheck: attempt.integrity?.preCheck ?? null,
      deviceFingerprintHash: attempt.integrity?.deviceFingerprintHash ?? null,
      lastDisconnectAt: attempt.integrity?.lastDisconnectAt ?? null,
      lastReconnectAt: attempt.integrity?.lastReconnectAt ?? null,
      lastHeartbeatAt: attempt.integrity?.lastHeartbeatAt ?? null,
      lastHeartbeatStatus: attempt.integrity?.lastHeartbeatStatus ?? 'idle',
    },
    recovery: {
      lastRecoveredAt: attempt.recovery?.lastRecoveredAt ?? null,
      lastLocalMutationAt: attempt.recovery?.lastLocalMutationAt ?? null,
      lastPersistedAt: attempt.recovery?.lastPersistedAt ?? null,
      pendingMutationCount: attempt.recovery?.pendingMutationCount ?? 0,
      syncState: attempt.recovery?.syncState ?? 'idle',
    },
  };
}

function mergeRecovery(
  attempt: StudentAttempt,
  recovery: Partial<StudentAttempt['recovery']>,
): StudentAttempt {
  return normalizeAttempt({
    ...attempt,
    recovery: {
      ...attempt.recovery,
      ...recovery,
    },
  });
}

export function mapBackendStudentAttempt(payload: BackendStudentAttempt): StudentAttempt {
  rememberAttemptSchedule(payload.id, payload.scheduleId);

  return normalizeAttempt({
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
      syncState: payload.recovery?.syncState ?? 'idle',
    },
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
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
}

export class LocalStorageStudentAttemptRepository implements IStudentAttemptRepository {
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
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeAttempt);
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
    return this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeAttempt);
  }

  async getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeAttempt);
    return attempts.filter((attempt) => attempt.scheduleId === scheduleId);
  }

  async saveAttempt(attempt: StudentAttempt): Promise<void> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeAttempt);
    const normalizedAttempt = normalizeAttempt({
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
    const submittedAttempt = normalizeAttempt({
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
    this.setItem(STORAGE_KEY_HEARTBEAT_EVENTS, events);
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    return events
      .filter((event) => event.attemptId === attemptId)
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  }
}

class BackendStudentAttemptRepository implements IStudentAttemptRepository {
  constructor(private readonly cache: LocalStorageStudentAttemptRepository) {}

  private async cacheAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    await this.cache.saveAttempt(attempt);
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

    const pendingMutations = await this.cache.getPendingMutations(attempt.id);
    if (pendingMutations.length === 0) {
      return;
    }

    if (!hasAttemptCredential(attempt.scheduleId, attempt.id)) {
      return;
    }

    const startingSeq = mutationSequenceWatermarks.get(attempt.id) ?? 0;
    const response = await backendPost<BackendMutationBatchResponse>(
      `/v1/student/sessions/${attempt.scheduleId}/mutations:batch`,
      {
        attemptId: attempt.id,
        studentKey: attempt.studentKey,
        clientSessionId: getClientSessionId(attempt.scheduleId, attempt.studentKey),
        mutations: pendingMutations.map((mutation, index) => ({
          id: mutation.id,
          seq: startingSeq + index + 1,
          timestamp: mutation.timestamp,
          mutationType: mutation.type,
          payload: mutation.payload,
        })),
      },
      {
        headers: buildAttemptAuthorizationHeader(attempt),
      },
    );

    mutationSequenceWatermarks.set(attempt.id, response.serverAcceptedThroughSeq);
    storeAttemptCredential(attempt, response.refreshedAttemptCredential);
    await this.cache.saveAttempt(
      mergeRecovery(mapBackendStudentAttempt(response.attempt), {
        lastLocalMutationAt: attempt.recovery.lastLocalMutationAt,
        lastPersistedAt: attempt.recovery.lastPersistedAt,
        pendingMutationCount: pendingMutations.length,
        syncState: attempt.recovery.syncState,
      }),
    );
  }

  async submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    const response = await backendPost<BackendSubmitResponse>(
      `/v1/student/sessions/${attempt.scheduleId}/submit`,
      {
        attemptId: attempt.id,
        studentKey: attempt.studentKey,
      },
      {
        headers: {
          ...buildAttemptAuthorizationHeader(attempt),
          'Idempotency-Key': `student-submit-${attempt.id}`,
        },
      },
    );

    const submittedAttempt = mapBackendStudentAttempt(response.attempt);
    storeAttemptCredential(attempt, response.refreshedAttemptCredential);
    await this.cache.saveAttempt(submittedAttempt);
    await this.cache.clearPendingMutations(attempt.id);
    mutationSequenceWatermarks.set(attempt.id, Number.MAX_SAFE_INTEGER);
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
        clientSessionId: getClientSessionId(seed.scheduleId, seed.studentKey),
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

    const response = await backendPost<BackendHeartbeatResponse>(
      `/v1/student/sessions/${event.scheduleId}/heartbeat`,
      {
        attemptId: event.attemptId,
        studentKey: attempt.studentKey,
        clientSessionId: getClientSessionId(event.scheduleId, attempt.studentKey),
        eventType: event.type,
        payload: event.payload,
        clientTimestamp: event.timestamp,
      },
      {
        headers: buildAttemptAuthorizationHeader(attempt),
      },
    );

    storeAttemptCredential(attempt, response.refreshedAttemptCredential);
    await this.cache.saveAttempt(mapBackendStudentAttempt(response.attempt));
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    return this.cache.getHeartbeatEvents(attemptId);
  }
}

class HybridStudentAttemptRepository implements IStudentAttemptRepository {
  constructor(
    private readonly localRepository: LocalStorageStudentAttemptRepository,
    private readonly backendRepository: BackendStudentAttemptRepository,
  ) {}

  private get activeRepository(): IStudentAttemptRepository {
    return isBackendDeliveryEnabled() ? this.backendRepository : this.localRepository;
  }

  getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null> {
    return this.activeRepository.getAttemptByScheduleId(scheduleId, studentKey);
  }

  getAllAttempts(): Promise<StudentAttempt[]> {
    return this.activeRepository.getAllAttempts();
  }

  getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    return this.activeRepository.getAttemptsByScheduleId(scheduleId);
  }

  saveAttempt(attempt: StudentAttempt): Promise<void> {
    return this.activeRepository.saveAttempt(attempt);
  }

  submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    return this.activeRepository.submitAttempt(attempt);
  }

  createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    return this.activeRepository.createAttempt(seed);
  }

  savePendingMutations(attemptId: string, mutations: StudentAttemptMutation[]): Promise<void> {
    return this.activeRepository.savePendingMutations(attemptId, mutations);
  }

  getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]> {
    return this.activeRepository.getPendingMutations(attemptId);
  }

  clearPendingMutations(attemptId: string): Promise<void> {
    return this.activeRepository.clearPendingMutations(attemptId);
  }

  saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void> {
    return this.activeRepository.saveHeartbeatEvent(event);
  }

  getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    return this.activeRepository.getHeartbeatEvents(attemptId);
  }
}

const localStorageStudentAttemptRepository = new LocalStorageStudentAttemptRepository();

export const studentAttemptRepository = new HybridStudentAttemptRepository(
  localStorageStudentAttemptRepository,
  new BackendStudentAttemptRepository(localStorageStudentAttemptRepository),
);
