import { backendGet, backendPost, hasBackendStatusCode, type ApiRequestConfig } from "./backendBridge";
import { studentSessionTransport } from "./studentSessionTransport";
import type { StudentAttempt } from "../types/studentAttempt";

const STORAGE_KEY_ATTEMPT_CREDENTIALS = "ielts_student_attempt_credentials_v1";

export interface BackendAttemptCredential {
  credentialPolicy?: "legacy_v1" | "sitting_v1" | undefined;
  attemptToken: string;
  expiresAt: string;
}

interface BackendStudentSessionContextWithCredential {
  attempt?: unknown;
  attemptCredential?: BackendAttemptCredential | null;
}

interface StoredAttemptCredential extends BackendAttemptCredential {
  attemptId: string;
  scheduleId: string;
  candidateId?: string | undefined;
  attemptToken: string;
  expiresAt: string;
}

const ATTEMPT_CREDENTIAL_REFRESH_RETRIES = 3;

function isTransientCredentialRefreshFailure(error: unknown): boolean {
  return (
    [0, 429, 502, 503, 504].some((status) => hasBackendStatusCode(error, status)) ||
    error instanceof TypeError
  );
}

function waitBeforeCredentialRefreshRetry(retryIndex: number): Promise<void> {
  const maxDelayMs = Math.min(2_000, 250 * 2 ** retryIndex);
  const delayMs = Math.floor(Math.random() * maxDelayMs);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchAttemptCredentialWithRetry(
  endpoint: string
): Promise<BackendStudentSessionContextWithCredential> {
  for (let retryIndex = 0; retryIndex <= ATTEMPT_CREDENTIAL_REFRESH_RETRIES; retryIndex += 1) {
    try {
      return await backendGet<BackendStudentSessionContextWithCredential>(endpoint, { retries: 0 });
    } catch (error) {
      if (
        retryIndex >= ATTEMPT_CREDENTIAL_REFRESH_RETRIES ||
        !isTransientCredentialRefreshFailure(error)
      ) {
        throw error;
      }
      await waitBeforeCredentialRefreshRetry(retryIndex);
    }
  }

  throw new Error("Attempt credential refresh did not settle.");
}

export interface AttemptCredentialRef {
  id: string;
  scheduleId: string;
  candidateId?: string | undefined;
}

export interface AttemptCredentialRefreshRef extends AttemptCredentialRef {
  candidateId: string;
  studentKey?: string;
  candidateName?: string;
  candidateEmail?: string;
}

export interface AttemptCredentialStatus {
  credentialPolicy?: "legacy_v1" | "sitting_v1" | undefined;
  expiresAt: string;
  expiresAtMs: number;
}

function getBrowserStorage(type: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") {
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
      if (!candidate || typeof candidate !== "object") {
        return false;
      }
      const record = candidate as Partial<StoredAttemptCredential>;
      return (
        typeof record.attemptId === "string" &&
        typeof record.scheduleId === "string" &&
        typeof record.attemptToken === "string" &&
        typeof record.expiresAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function mergeAttemptCredentials(
  localCredentials: StoredAttemptCredential[],
  sessionCredentials: StoredAttemptCredential[]
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
  if (typeof window === "undefined") {
    return [];
  }

  const local = getBrowserStorage("localStorage");
  const session = getBrowserStorage("sessionStorage");

  const read = (storage: Storage | null): string | null => {
    try {
      return storage?.getItem(STORAGE_KEY_ATTEMPT_CREDENTIALS) ?? null;
    } catch {
      return null;
    }
  };
  const localCredentials = parseAttemptCredentialStorage(read(local));
  const sessionCredentials = parseAttemptCredentialStorage(read(session));

  return mergeAttemptCredentials(localCredentials, sessionCredentials);
}

function setAttemptCredentialStorage(credentials: StoredAttemptCredential[]): void {
  const local = getBrowserStorage("localStorage");
  const session = getBrowserStorage("sessionStorage");
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
        candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId
    ) ?? null
  );
}

export function clearAttemptCredential(attempt: AttemptCredentialRef): void {
  const credentials = getAttemptCredentialStorage().filter(
    (candidate) =>
      !(candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId)
  );
  setAttemptCredentialStorage(credentials);
}

export function storeAttemptCredential(
  attempt: AttemptCredentialRef,
  credential: BackendAttemptCredential | null | undefined
): void {
  if (!credential) {
    return;
  }

  const credentials = getAttemptCredentialStorage().filter(
    (candidate) =>
      !(candidate.attemptId === attempt.id && candidate.scheduleId === attempt.scheduleId)
  );
  credentials.push({
    attemptId: attempt.id,
    scheduleId: attempt.scheduleId,
    attemptToken: credential.attemptToken,
    expiresAt: credential.expiresAt,
    ...(credential.credentialPolicy ? { credentialPolicy: credential.credentialPolicy } : {}),
    ...(attempt.candidateId ? { candidateId: attempt.candidateId } : {}),
  });
  setAttemptCredentialStorage(credentials);
}

export function hasAttemptCredential(scheduleId: string, attemptId: string): boolean {
  return getAttemptCredentialStorage().some(
    (candidate) => candidate.scheduleId === scheduleId && candidate.attemptId === attemptId
  );
}

export function getAttemptCredentialStatus(
  scheduleId: string,
  attemptId: string
): AttemptCredentialStatus | null {
  const credential = loadAttemptCredential({ scheduleId, id: attemptId });
  if (!credential) return null;
  const expiresAtMs = Date.parse(credential.expiresAt);
  return {
    expiresAt: credential.expiresAt,
    expiresAtMs,
    credentialPolicy: credential.credentialPolicy,
  };
}

export function isAttemptCredentialExpiringWithin(
  scheduleId: string,
  attemptId: string,
  withinMs: number,
  nowMs = Date.now()
): boolean {
  const status = getAttemptCredentialStatus(scheduleId, attemptId);
  if (status?.credentialPolicy === "sitting_v1") return false;
  return !status || !Number.isFinite(status.expiresAtMs) || status.expiresAtMs - nowMs <= withinMs;
}

export function buildAttemptAuthorizationHeader(
  attempt: AttemptCredentialRef
): Record<string, string> {
  const credential = loadAttemptCredential(attempt);
  if (!credential) {
    throw new Error("Missing attempt credential for student session.");
  }
  return { Authorization: `Bearer ${credential.attemptToken}` };
}

export function tryBuildAttemptAuthorizationHeader(
  scheduleId: string,
  attemptId: string
): Record<string, string> | null {
  try {
    return buildAttemptAuthorizationHeader({ scheduleId, id: attemptId });
  } catch {
    return null;
  }
}

// All student transports share renewal: concurrent rotations would invalidate
// the credential another save or submission is about to use.
const credentialRefreshes = new Map<string, Promise<boolean>>();

export function refreshAttemptCredential(
  attempt: AttemptCredentialRefreshRef,
  clientSessionId: string
): Promise<boolean> {
  const key = JSON.stringify([attempt.scheduleId, attempt.id, attempt.candidateId, clientSessionId]);
  const existing = credentialRefreshes.get(key);
  if (existing) return existing;

  const refresh = renewAttemptCredential(attempt, clientSessionId).finally(() => {
    credentialRefreshes.delete(key);
  });
  credentialRefreshes.set(key, refresh);
  return refresh;
}

async function renewAttemptCredential(
  attempt: AttemptCredentialRefreshRef,
  clientSessionId: string
): Promise<boolean> {
  const existing = loadAttemptCredential(attempt);
  if (existing?.credentialPolicy === "sitting_v1") {
    // Resume the existing exam grant using its own proof. Account bootstrap
    // cannot extend or resurrect a sitting grant, even when it has expired.
    const resumed = await backendPost<BackendAttemptCredential & {
      attemptId: string; clientSessionId: string;
    }>(`/v2/student/attempts/${encodeURIComponent(attempt.id)}/access:resume`, {}, {
      headers: { Authorization: `Bearer ${existing.attemptToken}` },
      credentialScope: "attempt",
      retries: 0,
      skipUnauthorizedHandler: true,
    });
    if (resumed.attemptId !== attempt.id || resumed.clientSessionId !== clientSessionId) {
      throw new Error("The resumed exam credential does not match this browser.");
    }
    storeAttemptCredential(attempt, resumed);
    return true;
  }
  try {
    const session = await fetchAttemptCredentialWithRetry(
      studentSessionTransport.paths.credentialRefresh(
        attempt.scheduleId,
        attempt.candidateId,
        clientSessionId
      )
    );

    if (session.attemptCredential) {
      storeAttemptCredential(attempt, session.attemptCredential);
      return true;
    }
    return false;
  } catch (error) {
    // A second tab has no bearer token yet, and the refresh endpoint correctly
    // refuses to silently replace the active writer. Bootstrap is the
    // authenticated, non-takeover path that issues a credential so the tab
    // can present it to the explicit takeover endpoint.
    if (!hasBackendStatusCode(error, 401) && !hasBackendStatusCode(error, 409)) {
      throw error;
    }
  }

  const session = await backendPost<BackendStudentSessionContextWithCredential>(
    studentSessionTransport.paths.bootstrap(attempt.scheduleId),
    {
      wcode: null,
      email: attempt.candidateEmail ?? null,
      studentKey: attempt.studentKey ?? attempt.candidateId,
      candidateId: attempt.candidateId,
      candidateName: attempt.candidateName ?? "",
      candidateEmail: attempt.candidateEmail ?? "",
      clientSessionId,
    },
    { retries: 0 }
  );

  if (!session.attemptCredential) {
    return false;
  }

  storeAttemptCredential(attempt, session.attemptCredential);
  return true;
}

export async function refreshAttemptCredentialForAttempt(
  attempt: StudentAttempt,
  clientSessionId: string
): Promise<boolean> {
  return refreshAttemptCredential(attempt, clientSessionId);
}

/**
 * Select only an unambiguous, unexpired sitting grant. This is a hint: the
 * server re-checks the grant's schedule, attempt, and candidate binding. The
 * route's candidate may be a WCODE or student key while the stored value is
 * the canonical candidate ID, so an exact match is preferred but a single
 * grant for the schedule is still usable. An expired grant is never sent; the
 * account session (if any) then decides, and re-entry issues a new grant.
 */
export function findSittingAttemptCredential(
  scheduleId: string,
  candidateId?: string,
  attemptId?: string,
  nowMs = Date.now(),
): (BackendAttemptCredential & { attemptId: string; candidateId?: string | undefined }) | null {
  const grants = getAttemptCredentialStorage().filter((credential) =>
    credential.scheduleId === scheduleId && credential.credentialPolicy === "sitting_v1" &&
    (!attemptId || credential.attemptId === attemptId) &&
    Date.parse(credential.expiresAt) > nowMs
  );
  if (candidateId) {
    const exact = grants.filter((credential) => credential.candidateId === candidateId);
    if (exact.length === 1) return exact[0]!;
  }
  return grants.length === 1 ? grants[0]! : null;
}

export function sittingAttemptAuthorizationHeaders(scheduleId: string, candidateId?: string, attemptId?: string): Record<string, string> {
  const grant = findSittingAttemptCredential(scheduleId, candidateId, attemptId);
  return grant ? { Authorization: `Bearer ${grant.attemptToken}` } : {};
}

export function sittingAttemptRequestConfig(scheduleId: string, candidateId?: string, attemptId?: string): ApiRequestConfig {
  const headers = sittingAttemptAuthorizationHeaders(scheduleId, candidateId, attemptId);
  return { headers, skipUnauthorizedHandler: true, ...(headers["Authorization"] ? { credentialScope: "attempt" as const } : {}) };
}
