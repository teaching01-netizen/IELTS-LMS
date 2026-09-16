import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiClient } from '../../shared/api/apiClient';
import { queryClient } from '../../shared/api/queryClient';
import { logError } from '../../shared/observability/errorLogger';
import {
  authService,
  type AuthSession,
  type AuthUserRole,
  type StudentEntryResult,
  type StudentEntrySuccess,
} from './api/authGateway';
import { storeAttemptCredential } from './infrastructure/attemptCredentialStorage';

export type { StudentQueuedAdmission } from './api/authGateway';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthSessionContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<AuthSession>;
  studentEntry: (payload: {
    scheduleId?: string | undefined;
    accessLinkId?: string | undefined;
    wcode: string;
    email: string;
    studentName: string;
    nickname?: string | undefined;
    ieltsCourse?: string | undefined;
  }) => Promise<StudentEntryResult>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<AuthSession | null>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordReset: (token: string, password: string) => Promise<AuthSession>;
  activateAccount: (
    token: string,
    password: string,
    displayName?: string | undefined,
  ) => Promise<AuthSession>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

function applySessionHeaders(session: AuthSession | null): void {
  if (session) {
    apiClient.setCsrfToken(session.csrfToken);
    return;
  }

  apiClient.clearCsrfToken();
}

function isRateLimitedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record['statusCode'] === 429 || record['status'] === 429;
}

function rateLimitWaitMs(error: unknown): number {
  const record = error as Record<string, unknown>;
  const details =
    (record['details'] as Record<string, unknown> | undefined) ??
    (record['backendDetails'] as Record<string, unknown> | undefined);
  const headers = record['headers'];
  const headerRetryAfter =
    headers && typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function'
      ? (headers.get('Retry-After') ?? headers.get('retry-after'))
      : headers && typeof headers === 'object'
        ? ((headers as Record<string, unknown>)['Retry-After'] ??
          (headers as Record<string, unknown>)['retry-after'])
        : undefined;
  const candidates = [
    record['retryAfterSeconds'],
    record['retryAfterSecs'],
    record['retryAfter'],
    details?.['retryAfterSeconds'],
    details?.['retryAfterSecs'],
    details?.['retryAfter'],
    headerRetryAfter,
  ];
  const retryAfter = candidates.find((value) => {
    const seconds = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(seconds) && seconds > 0;
  });
  const secs = retryAfter === undefined ? 1 : Number(retryAfter);
  return Math.min(secs, 30) * 1000;
}

function setSessionState(
  nextSession: AuthSession | null,
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>,
  setStatus: React.Dispatch<React.SetStateAction<AuthStatus>>,
): AuthSession | null {
  applySessionHeaders(nextSession);
  setSession(nextSession);
  setStatus(nextSession ? 'authenticated' : 'unauthenticated');
  return nextSession;
}

export function resolveRoleLandingPath(role: AuthUserRole): string {
  switch (role) {
    case 'admin':
    case 'builder':
      return '/admin/exams';
    case 'grader':
      return '/admin/grading';
    case 'proctor':
      return '/proctor';
    case 'student':
      return '/login';
  }
}

/**
 * Path prefixes each role is allowed to be sent to via `?next=`.
 * Prevents open redirects and privilege-confused redirects (e.g. a student
 * login landing on `/admin/exams`).
 */
const ROLE_ALLOWED_NEXT_PREFIXES: Record<AuthUserRole, readonly string[]> = {
  admin: ['/admin', '/sat', '/builder', '/proctor', '/student', '/join'],
  builder: ['/admin', '/sat', '/builder'],
  proctor: ['/proctor', '/sat', '/student', '/join'],
  grader: ['/admin', '/sat'],
  student: ['/student', '/join'],
};

function isAllowedNextPath(role: AuthUserRole, nextPath: string): boolean {
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return false;
  }
  // Block encoded slashes, backslashes, schemes, and path traversal.
  if (
    nextPath.includes('\\') ||
    nextPath.includes('://') ||
    nextPath.split(/[?#]/)[0]?.split('/').includes('..')
  ) {
    return false;
  }
  const pathname = nextPath.split(/[?#]/)[0] ?? '';
  // Never redirect back to an auth page (redirect loop).
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return false;
  }
  return ROLE_ALLOWED_NEXT_PREFIXES[role].some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`) ||
      nextPath.startsWith(`${prefix}?`) ||
      nextPath.startsWith(`${prefix}#`),
  );
}

export function resolvePostLoginPath(
  role: AuthUserRole,
  nextPath?: string | null | undefined,
): string {
  if (nextPath && isAllowedNextPath(role, nextPath)) {
    return nextPath;
  }

  return resolveRoleLandingPath(role);
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const sessionRef = useRef<AuthSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(({ endpoint }) => {
      // If we are already unauthenticated, do not churn state/cache.
      if (!sessionRef.current) {
        return;
      }

      // Student attempt flows use different credentials and may legitimately return 401
      // while the studentAttemptRepository refreshes attempt tokens and retries.
      if (endpoint.startsWith('/v1/student/')) {
        return;
      }

      queryClient.clear();
      setSessionState(null, setSession, setStatus);
    });

    return () => {
      apiClient.setUnauthorizedHandler(null);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nextSession = await authService.getSession();
      return setSessionState(nextSession, setSession, setStatus);
    } catch (error) {
      // 429 (rate limited) is transient pressure, not a session verdict:
      // retry once after the server's Retry-After, then keep the current
      // session either way. Never sign out or bounce to login on 429.
      if (isRateLimitedError(error)) {
        const waitMs = rateLimitWaitMs(error);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        try {
          const nextSession = await authService.getSession();
          return setSessionState(nextSession, setSession, setStatus);
        } catch (retryError) {
          if (import.meta.env.DEV) {
            console.warn('[authSession] session refresh rate-limited; keeping current session');
          }
          setStatus(sessionRef.current ? 'authenticated' : 'unauthenticated');
          return sessionRef.current;
        }
      }
      // Only clear the session when the refresh proves the session is gone
      // (401/403 or an explicit expiry/unauthorized backend code). Any other
      // failure (network, 5xx, transport) keeps the current session so the UI
      // stays in its retry path instead of bouncing to login.
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? (error as { statusCode?: unknown }).statusCode
          : typeof error === 'object' && error !== null && 'status' in error
            ? (error as { status?: unknown }).status
            : undefined;
      const backendCode =
        typeof error === 'object' && error !== null && 'backendCode' in error
          ? String((error as { backendCode?: unknown }).backendCode ?? '')
          : typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';
      const sessionIsGone =
        statusCode === 401 ||
        statusCode === 403 ||
        /expired|unauthori[sz]ed|session/i.test(backendCode);
      if (sessionIsGone) {
        logError(error instanceof Error ? error : new Error('Session expired'), {
          scope: 'authSession.refresh',
        });
        return setSessionState(null, setSession, setStatus);
      }
      logError(error instanceof Error ? error : new Error('Failed to refresh session'), {
        scope: 'authSession.refresh',
      });
      // Keep existing session; caller sees the previous state.
      setStatus(sessionRef.current ? 'authenticated' : 'unauthenticated');
      return sessionRef.current;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const nextSession = await authService.login({ email, password });
    return setSessionState(nextSession, setSession, setStatus) as AuthSession;
  }, []);

  const studentEntry = useCallback(async (payload: {
    scheduleId?: string | undefined;
    accessLinkId?: string | undefined;
    wcode: string;
    email: string;
    studentName: string;
    nickname?: string | undefined;
    ieltsCourse?: string | undefined;
  }) => {
    const result = await authService.studentEntry(payload);
    if (!('user' in result)) {
      return result;
    }
    if (result.attemptId && result.attemptToken && result.attemptExpiresAt) {
      storeAttemptCredential(
        { id: result.attemptId, scheduleId: result.scheduleId },
        { attemptToken: result.attemptToken, expiresAt: result.attemptExpiresAt },
      );
    }
    setSessionState(result, setSession, setStatus);
    return result as StudentEntrySuccess;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setSessionState(null, setSession, setStatus);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authService.logoutAll();
    } finally {
      setSessionState(null, setSession, setStatus);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authService.requestPasswordReset({ email });
  }, []);

  const completePasswordReset = useCallback(async (token: string, password: string) => {
    const nextSession = await authService.completePasswordReset({ token, password });
    return setSessionState(nextSession, setSession, setStatus) as AuthSession;
  }, []);

  const activateAccount = useCallback(
    async (token: string, password: string, displayName?: string | undefined) => {
      const nextSession = await authService.activateAccount({
        token,
        password,
        displayName,
      });
      return setSessionState(nextSession, setSession, setStatus) as AuthSession;
    },
    [],
  );

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      session,
      status,
      login,
      studentEntry,
      logout,
      logoutAll,
      refresh,
      requestPasswordReset,
      completePasswordReset,
      activateAccount,
    }),
    [
      activateAccount,
      completePasswordReset,
      login,
      studentEntry,
      logout,
      logoutAll,
      refresh,
      requestPasswordReset,
      session,
      status,
    ],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error('useAuthSession must be used within AuthSessionProvider');
  }
  return context;
}

/**
 * Like `useAuthSession`, but returns `null` instead of throwing when the
 * component renders outside an `AuthSessionProvider` (e.g. in isolation or
 * tests). Consumers must handle the `null` case themselves.
 */
export function useOptionalAuthSession(): AuthSessionContextValue | null {
  return useContext(AuthSessionContext);
}
