import { get, post } from '../app/api/apiClient';

type BackendEnvelope<T> = {
  success: boolean;
  data?: T | undefined;
  error?: {
    code?: string | undefined;
    message?: string | undefined;
  } | undefined;
};

export type AuthUserRole = 'admin' | 'builder' | 'proctor' | 'grader' | 'student';
export type AuthUserState = 'active' | 'disabled' | 'locked' | 'pending_activation';

export interface AuthSessionUser {
  id: string;
  email: string;
  displayName?: string | null | undefined;
  role: AuthUserRole;
  state: AuthUserState;
}

export interface AuthSession {
  user: AuthSessionUser;
  csrfToken: string;
  expiresAt: string;
  idleTimeoutAt?: string | undefined;
  /** The browser holds a persistent (remembered-device) cookie. */
  remembered?: boolean | undefined;
  /** Last real password verification for this session; null for legacy/non-password sessions. */
  credentialAuthenticatedAt?: string | null | undefined;
}

export interface StudentQueuedAdmission {
  state: 'queued';
  ticketId: string;
  scheduleId: string;
  wcode: string;
  position: number;
  pollAfterMs: number;
  queuedAt: string;
}

export interface StudentEntrySuccess extends AuthSession {
  scheduleId: string;
  studentCode: string;
  /**
   * The student-entry response also grants the bearer used by V2 response
   * durability. Keep these optional for queued/legacy adapters that only
   * return the authentication session fields.
   */
  attemptId?: string | undefined;
  attemptToken?: string | undefined;
  attemptExpiresAt?: string | undefined;
  clientSessionId?: string | undefined;
}

export type StudentEntryResult = StudentEntrySuccess | StudentQueuedAdmission;

interface LoginPayload {
  email: string;
  password: string;
  /** Omitted means not remembered; older backends reject the unknown field. */
  rememberMe?: boolean | undefined;
}

interface PasswordResetRequestPayload {
  email: string;
}

interface PasswordResetCompletePayload {
  token: string;
  password: string;
}

interface AccountActivationPayload {
  token: string;
  password: string;
  displayName?: string | undefined;
}

/** Configurable SAT registration answers, keyed by field ID, plus the form version the student saw. */
export interface StudentRegistrationFormSubmission {
  versionId: string;
  answers: Record<string, string | number>;
}

export interface StudentEntryPayload {
  scheduleId?: string | undefined;
  accessLinkId?: string | undefined;
  wcode: string;
  email: string;
  studentName: string;
  nickname?: string | undefined;
  ieltsCourse?: string | undefined;
  clientSessionId?: string | undefined;
  /** An explicit practice recovery capability, never an identity label. */
  entrySession?: string | undefined;
  /** Omitted for legacy/unconfigured forms. */
  registrationForm?: StudentRegistrationFormSubmission | undefined;
}

function extractEnvelopeData<T>(response: { data?: BackendEnvelope<T> | T | undefined }): T {
  const payload = response?.data;
  if (payload === null || payload === undefined) {
    throw new Error('Authentication request failed: empty response');
  }

  if (typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as BackendEnvelope<T>;
    if (!envelope.success) {
      throw new Error(envelope.error?.message ?? 'Authentication request failed');
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new Error('Authentication request failed: empty response');
    }

    return envelope.data;
  }

  return payload as T;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const user = record['user'] as Record<string, unknown> | null | undefined;
  return (
    typeof record['csrfToken'] === 'string' &&
    typeof record['expiresAt'] === 'string' &&
    !!user &&
    typeof user === 'object' &&
    typeof user['id'] === 'string' &&
    typeof user['role'] === 'string'
  );
}

function abortError(): Error {
  return Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
}

/** Resolve `pending` unless this caller's own signal aborts first. */
function joinWithSignal<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

interface SessionFlight {
  generation: number;
  controller: AbortController;
  promise: Promise<AuthSession | null>;
}

class AuthService {
  private sessionFlight: SessionFlight | null = null;

  /**
   * Authoritative session check. Concurrent callers of the same auth
   * generation share one request (StrictMode double-mount, several guards);
   * a newer generation never joins an older actor's flight. A caller's
   * `signal` cancels only that caller's wait, never the shared request.
   *
   * Resolves null only for a definitive "no session" (401).
   * Transport failures and malformed payloads reject: they are not logout.
   */
  async getSession(generation = 0, signal?: AbortSignal): Promise<AuthSession | null> {
    const current = this.sessionFlight;
    if (current && current.generation === generation) {
      return joinWithSignal(current.promise, signal);
    }
    if (current) current.controller.abort();
    const controller = new AbortController();
    const flight: SessionFlight = {
      generation,
      controller,
      promise: this.fetchSession(controller.signal).finally(() => {
        // Clear only our own flight; a newer one may already have replaced it.
        if (this.sessionFlight === flight) this.sessionFlight = null;
      }),
    };
    this.sessionFlight = flight;
    return joinWithSignal(flight.promise, signal);
  }

  /** Abort any in-flight session check (identity changed). */
  invalidateSessionRequest(): void {
    this.sessionFlight?.controller.abort();
    this.sessionFlight = null;
  }

  private async fetchSession(signal: AbortSignal): Promise<AuthSession | null> {
    try {
      const response = await get<BackendEnvelope<AuthSession> | AuthSession>('/v1/auth/session', {
        retries: 0,
        signal,
        // The session check owns the cookie verdict; it must not re-enter the
        // global 401 handler that itself calls the session check.
        skipUnauthorizedHandler: true,
      });
      const session = response?.data == null ? null : extractEnvelopeData<AuthSession>(response);
      if (!isAuthSession(session)) {
        throw Object.assign(new Error('Session response was malformed'), {
          code: 'SESSION_PROTOCOL_ERROR',
        });
      }
      return session;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        (error as { statusCode?: unknown }).statusCode === 401
      ) {
        return null;
      }

      throw error;
    }
  }

  async login(payload: LoginPayload): Promise<AuthSession> {
    const response = await post<BackendEnvelope<AuthSession>>('/v1/auth/login', payload, {
      retries: 0,
      skipUnauthorizedHandler: true,
    });
    return extractEnvelopeData<AuthSession>(response);
  }

  async logout(): Promise<void> {
    await post<BackendEnvelope<void>>('/v1/auth/logout', undefined, {
      retries: 0,
      skipUnauthorizedHandler: true,
    });
  }

  async logoutAll(): Promise<void> {
    await post<BackendEnvelope<void>>('/v1/auth/logout-all', undefined, {
      retries: 0,
      skipUnauthorizedHandler: true,
    });
  }

  async requestPasswordReset(payload: PasswordResetRequestPayload): Promise<void> {
    await post<BackendEnvelope<void>>('/v1/auth/password/reset-request', payload, {
      retries: 0,
    });
  }

  async completePasswordReset(payload: PasswordResetCompletePayload): Promise<AuthSession> {
    const response = await post<BackendEnvelope<AuthSession>>(
      '/v1/auth/password/reset-complete',
      payload,
      { retries: 0, skipUnauthorizedHandler: true },
    );
    return extractEnvelopeData<AuthSession>(response);
  }

  async activateAccount(payload: AccountActivationPayload): Promise<AuthSession> {
    const response = await post<BackendEnvelope<AuthSession>>('/v1/auth/activate', payload, {
      retries: 0,
      skipUnauthorizedHandler: true,
    });
    return extractEnvelopeData<AuthSession>(response);
  }

  async studentEntry(payload: StudentEntryPayload): Promise<StudentEntryResult> {
    const scope = JSON.stringify([payload.scheduleId ?? payload.accessLinkId, payload.wcode.trim(), payload.email.trim().toLowerCase()]);
    const key = `practice-entry:v1:${scope}`;
    let entrySession = payload.entrySession ?? window.localStorage.getItem(key);
    if (!entrySession) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
      entrySession = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      // Persist before making the request: a lost response must not mint
      // another principal. Storage failure stops entry rather than hiding it.
      window.localStorage.setItem(key, entrySession);
    }
    const response = await post<BackendEnvelope<StudentEntryResult>>('/v1/auth/student/entry', { ...payload, entrySession }, {
      retries: 0,
    });
    return extractEnvelopeData<StudentEntryResult>(response);
  }
}

export const authService = new AuthService();
