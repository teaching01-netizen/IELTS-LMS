import { backendGet } from './backendBridge';
import { studentSessionTransport } from './studentSessionTransport';
import type { StudentAttempt } from '../types/studentAttempt';

const STORAGE_KEY_ATTEMPT_CREDENTIALS = 'ielts_student_attempt_credentials_v1';

export interface BackendAttemptCredential {
  attemptToken: string;
  expiresAt: string;
}

interface BackendStudentSessionContextWithCredential {
  attemptCredential?: BackendAttemptCredential | null;
}

interface StoredAttemptCredential {
  attemptId: string;
  scheduleId: string;
  attemptToken: string;
  expiresAt: string;
}

export interface AttemptCredentialRef {
  id: string;
  scheduleId: string;
}

export interface AttemptCredentialRefreshRef extends AttemptCredentialRef {
  candidateId: string;
}

export interface AttemptCredentialStatus {
  expiresAt: string;
  expiresAtMs: number;
}

function getBrowserStorage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window[type];
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

  return mergeAttemptCredentials(localCredentials, sessionCredentials);
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

function loadAttemptCredential(attempt: AttemptCredentialRef): StoredAttemptCredential | null {
  return (
    getAttemptCredentialStorage().find(
      (candidate) =>
        candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId,
    ) ?? null
  );
}

export function clearAttemptCredential(attempt: AttemptCredentialRef): void {
  const credentials = getAttemptCredentialStorage().filter(
    (candidate) =>
      !(candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId),
  );
  setAttemptCredentialStorage(credentials);
}

export function storeAttemptCredential(
  attempt: AttemptCredentialRef,
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

export function hasAttemptCredential(scheduleId: string, attemptId: string): boolean {
  return getAttemptCredentialStorage().some(
    (candidate) => candidate.scheduleId === scheduleId && candidate.attemptId === attemptId,
  );
}

export function getAttemptCredentialStatus(
  scheduleId: string,
  attemptId: string,
): AttemptCredentialStatus | null {
  const credential = loadAttemptCredential({ scheduleId, id: attemptId });
  if (!credential) return null;
  const expiresAtMs = Date.parse(credential.expiresAt);
  return {
    expiresAt: credential.expiresAt,
    expiresAtMs,
  };
}

export function isAttemptCredentialExpiringWithin(
  scheduleId: string,
  attemptId: string,
  withinMs: number,
  nowMs = Date.now(),
): boolean {
  const status = getAttemptCredentialStatus(scheduleId, attemptId);
  return !status || !Number.isFinite(status.expiresAtMs) || status.expiresAtMs - nowMs <= withinMs;
}

export function buildAttemptAuthorizationHeader(attempt: AttemptCredentialRef): Record<string, string> {
  const credential = loadAttemptCredential(attempt);
  if (!credential) {
    throw new Error('Missing attempt credential for student session.');
  }
  return { Authorization: `Bearer ${credential.attemptToken}` };
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

export async function refreshAttemptCredential(
  attempt: AttemptCredentialRefreshRef,
  clientSessionId: string,
): Promise<boolean> {
  const session = await backendGet<BackendStudentSessionContextWithCredential>(
    studentSessionTransport.paths.credentialRefresh(
      attempt.scheduleId,
      attempt.candidateId,
      clientSessionId,
    ),
    { retries: 0 },
  );

  if (!session.attemptCredential) {
    return false;
  }

  storeAttemptCredential(attempt, session.attemptCredential);
  return true;
}

export async function refreshAttemptCredentialForAttempt(
  attempt: StudentAttempt,
  clientSessionId: string,
): Promise<boolean> {
  return refreshAttemptCredential(attempt, clientSessionId);
}
