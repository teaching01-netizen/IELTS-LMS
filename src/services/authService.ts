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

interface StudentEntryPayload {
  scheduleId?: string | undefined;
  accessLinkId?: string | undefined;
  wcode: string;
  email: string;
  studentName: string;
  nickname?: string | undefined;
  ieltsCourse?: string | undefined;
  clientSessionId?: string | undefined;
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

class AuthService {
  private inflightSession: Promise<AuthSession | null> | null = null;

  async getSession(): Promise<AuthSession | null> {
    // Single-flight: concurrent refresh() callers (StrictMode double-mount,
    // multiple guards) share one in-flight request instead of stamping the
    // auth-critical tier once per caller.
    if (this.inflightSession) {
      return this.inflightSession;
    }
    const pending = this.fetchSession();
    this.inflightSession = pending;
    try {
      return await pending;
    } finally {
      this.inflightSession = null;
    }
  }

  private async fetchSession(): Promise<AuthSession | null> {
    try {
      const response = await get<BackendEnvelope<AuthSession> | AuthSession>('/v1/auth/session', {
        retries: 0,
      });
      // A 204/empty body means "no session" rather than an error.
      if (response?.data === null || response?.data === undefined) {
        return null;
      }
      return extractEnvelopeData<AuthSession>(response);
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
    });
    return extractEnvelopeData<AuthSession>(response);
  }

  async logout(): Promise<void> {
    await post<BackendEnvelope<void>>('/v1/auth/logout', undefined, {
      retries: 0,
    });
  }

  async logoutAll(): Promise<void> {
    await post<BackendEnvelope<void>>('/v1/auth/logout-all', undefined, {
      retries: 0,
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
      { retries: 0 },
    );
    return extractEnvelopeData<AuthSession>(response);
  }

  async activateAccount(payload: AccountActivationPayload): Promise<AuthSession> {
    const response = await post<BackendEnvelope<AuthSession>>('/v1/auth/activate', payload, {
      retries: 0,
    });
    return extractEnvelopeData<AuthSession>(response);
  }

  async studentEntry(payload: StudentEntryPayload): Promise<StudentEntryResult> {
    const response = await post<BackendEnvelope<StudentEntryResult>>('/v1/auth/student/entry', payload, {
      retries: 0,
    });
    return extractEnvelopeData<StudentEntryResult>(response);
  }
}

export const authService = new AuthService();
