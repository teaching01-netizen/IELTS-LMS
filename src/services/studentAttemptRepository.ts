import type {
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptSeed,
  StudentHeartbeatEvent,
} from '../types/studentAttempt';

const STORAGE_KEY_ATTEMPTS = 'ielts_student_attempts_v1';
const STORAGE_KEY_PENDING_MUTATIONS = 'ielts_student_attempt_pending_mutations_v1';
const STORAGE_KEY_HEARTBEAT_EVENTS = 'ielts_student_attempt_heartbeat_events_v1';

interface PendingAttemptMutationRecord {
  attemptId: string;
  mutations: StudentAttemptMutation[];
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAttempt(attempt: StudentAttempt): StudentAttempt {
  return {
    ...attempt,
    answers: attempt.answers ?? {},
    writingAnswers: attempt.writingAnswers ?? {},
    flags: attempt.flags ?? {},
    violations: attempt.violations ?? [],
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

export interface IStudentAttemptRepository {
  getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null>;
  saveAttempt(attempt: StudentAttempt): Promise<void>;
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
    return item ? (JSON.parse(item) as T[]) : [];
  }

  private setItem<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  async getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null> {
    const attempts = this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeAttempt);
    return attempts.find((attempt) => attempt.scheduleId === scheduleId && attempt.studentKey === studentKey) ?? null;
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

  async createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    const now = new Date().toISOString();
    const attempt: StudentAttempt = {
      id: generateId('attempt'),
      scheduleId: seed.scheduleId,
      studentKey: seed.studentKey,
      examId: seed.examId,
      examTitle: seed.examTitle,
      phase: seed.phase ?? 'pre-check',
      currentModule: seed.currentModule ?? 'listening',
      currentQuestionId: seed.currentQuestionId ?? null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
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

export const studentAttemptRepository = new LocalStorageStudentAttemptRepository();
