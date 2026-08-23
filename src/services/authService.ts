import { apiClient, get, post } from '../app/api/apiClient';

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

export type StudentEntryResult = AuthSession | StudentQueuedAdmission;

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
  scheduleId: string;
  wcode: string;
  email: string;
  studentName: string;
  nickname: string;
  ieltsCourse: string;
}

function extractEnvelopeData<T>(response: { data?: BackendEnvelope<T> | T | undefined }): T {
  const payload = response.data;

  if (payload && typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as BackendEnvelope<T>;
    if (!envelope.success) {
      throw new Error(envelope.error?.message ?? 'Authentication request failed');
    }

    return envelope.data as T;
  }

  return payload as T;
}

class AuthService {
  async getSession(): Promise<AuthSession | null> {
    try {
      const response = await get<BackendEnvelope<AuthSession>>('/v1/auth/session', {
        retries: 0,
      });
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

/**
 * Sync session credentials onto the shared transport (CSRF header).
 * Session state stays owned by the auth feature; only the services layer
 * is allowed to touch the raw API client.
 */
export function applyAuthTransportSession(session: AuthSession | null): void {
  if (session) {
    apiClient.setCsrfToken(session.csrfToken);
    return;
  }

  apiClient.clearCsrfToken();
}

/**
 * Register the global 401 handler on the shared transport.
 * Accepts the subset of the handler context the auth feature relies on.
 */
export function registerAuthUnauthorizedHandler(
  handler: ((context: { endpoint: string }) => void) | null,
): void {
  apiClient.setUnauthorizedHandler(handler);
}
