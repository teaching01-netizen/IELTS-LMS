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
  type StudentEntryPayload,
  type StudentEntryResult,
  type StudentEntrySuccess,
} from './api/authGateway';
import { storeAttemptCredential } from './infrastructure/attemptCredentialStorage';
import {
  clearLogoutIntent,
  publishAuthEvent,
  readLogoutAllUnconfirmed,
  readLogoutIntent,
  setLogoutAllUnconfirmed,
  subscribeAuthEvents,
  supportsAuthMutationLock,
  withAuthMutationLock,
  writeLogoutIntent,
  newOperationId,
  type LogoutIntent,
  type LogoutScope,
} from './infrastructure/authBrowserCoordination';
import {
  initialAuthState,
  isIdentityChange,
  recoveryDelayMs,
  reduceAuthState,
  retryAfterFromError,
  type AuthEvent,
  type AuthState,
  type AuthStatus,
} from './authSessionState';

export type { StudentQueuedAdmission } from './api/authGateway';
export type { AuthStatus } from './authSessionState';

interface AuthSessionContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  /** Authenticated, but the latest server check failed transiently. */
  degraded: boolean;
  /** Set while a logout is requested but not yet confirmed by the server. */
  pendingLogout: AuthState['pendingLogout'];
  /** This browser is signed out; sign-out on other devices was not confirmed. */
  logoutAllUnconfirmed: boolean;
  /** Remembered sign-in is offered only where tabs can serialize credential changes. */
  rememberMeAvailable: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthSession>;
  studentEntry: (payload: Omit<StudentEntryPayload, "entrySession">) => Promise<StudentEntryResult>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<AuthSession | null>;
  dismissLogoutNotice: () => void;
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

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const value = record['status'] ?? record['statusCode'];
  return typeof value === 'number' ? value : undefined;
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
  const [state, setState] = useState<AuthState>(() => ({
    ...initialAuthState,
    logoutAllUnconfirmed: readLogoutAllUnconfirmed(),
  }));
  // Refs are updated at transition time, not in an effect, so async work that
  // resumes before React re-renders sees the state it must check against.
  const stateRef = useRef(state);
  // Identity fence: bumps whenever the signed-in actor changes. Requests and
  // session checks dispatched under an older generation are discarded.
  const generationRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptRef = useRef(0);
  const recoveryDeferredRef = useRef(false);
  const recoveryNotBeforeRef = useRef(0);
  // In-memory copy of this tab's logout intent for browsers without storage.
  const memoryIntentRef = useRef<{ intent: LogoutIntent; persisted: boolean } | null>(null);
  const refreshRef = useRef<() => Promise<AuthSession | null>>(async () => null);

  const transition = useCallback((event: AuthEvent): AuthState => {
    const next = reduceAuthState(stateRef.current, event);
    stateRef.current = next;
    applySessionHeaders(next.session);
    setState(next);
    return next;
  }, []);

  const cancelRecovery = useCallback(() => {
    if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
    recoveryDeferredRef.current = false;
    recoveryNotBeforeRef.current = 0;
  }, []);

  /** Previous actor's work and private cache must not survive an identity change. */
  const fenceIdentity = useCallback(() => {
    generationRef.current += 1;
    authService.invalidateSessionRequest();
    cancelRecovery();
    recoveryAttemptRef.current = 0;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [cancelRecovery]);

  const acceptSession = useCallback(
    (next: AuthSession | null): AuthSession | null => {
      if (isIdentityChange(stateRef.current.session, next)) fenceIdentity();
      cancelRecovery();
      recoveryAttemptRef.current = 0;
      transition({ type: 'sessionResolved', session: next });
      return next;
    },
    [cancelRecovery, fenceIdentity, transition],
  );

  const scheduleRecovery = useCallback(
    (error: unknown) => {
      cancelRecovery();
      const delay = recoveryDelayMs(recoveryAttemptRef.current, retryAfterFromError(error));
      recoveryNotBeforeRef.current = Date.now() + delay;
      recoveryAttemptRef.current += 1;
      if (
        (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        // Paused while hidden/offline; visibility/online resumes it.
        recoveryDeferredRef.current = true;
        return;
      }
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        void refreshRef.current();
      }, delay);
    },
    [cancelRecovery],
  );

  const currentIntent = useCallback((): LogoutIntent | null => {
    const memory = memoryIntentRef.current;
    if (memory && !memory.persisted) return memory.intent;
    return readLogoutIntent(memory?.intent ?? null);
  }, []);

  const intentIsCurrent = useCallback(
    (intent: LogoutIntent) => currentIntent()?.id === intent.id,
    [currentIntent],
  );

  const finishLogout = useCallback(
    (intent: LogoutIntent, allUnconfirmed: boolean) => {
      clearLogoutIntent(intent.id);
      if (memoryIntentRef.current?.intent.id === intent.id) memoryIntentRef.current = null;
      setLogoutAllUnconfirmed(allUnconfirmed);
      cancelRecovery();
      recoveryAttemptRef.current = 0;
      queryClient.clear();
      transition({ type: 'loggedOut', allUnconfirmed });
      publishAuthEvent({ type: 'credential-changed', id: intent.id });
    },
    [cancelRecovery, transition],
  );

  /** Send the logout the intent asks for. No transport retry; recovery owns retries. */
  const completeLogout = useCallback(
    (intent: LogoutIntent) =>
      withAuthMutationLock(async () => {
        // A deliberate new login (or another tab's completion) supersedes us:
        // never revoke whatever cookie replaced the one we meant to end.
        if (!intentIsCurrent(intent)) return;
        try {
          if (intent.scope === 'all') await authService.logoutAll();
          else await authService.logout();
          if (intentIsCurrent(intent)) finishLogout(intent, false);
        } catch (requestError) {
          let error = requestError;
          if (intent.scope === 'all' && statusOf(error) === 401) {
            // No live session to sign out everywhere from. Absence does not
            // prove the all-device request committed: clear this browser and
            // say so, rather than downgrading to current-device success.
            try {
              await authService.logout();
              if (intentIsCurrent(intent)) finishLogout(intent, true);
              return;
            } catch (clearError) {
              error = clearError;
            }
          }
          if (!intentIsCurrent(intent)) return;
          logError(error instanceof Error ? error : new Error('Logout failed'), {
            scope: 'authSession.logout',
          });
          transition({ type: 'logoutFailed' });
          scheduleRecovery(error);
        }
      }),
    [finishLogout, intentIsCurrent, scheduleRecovery, transition],
  );

  const beginLogout = useCallback(
    async (scope: LogoutScope) => {
      const { intent, persisted } = writeLogoutIntent(scope);
      memoryIntentRef.current = { intent, persisted };
      // Hide private UI before any network round trip.
      fenceIdentity();
      transition({ type: 'logoutStarted', scope, durable: persisted });
      publishAuthEvent({ type: 'logout', id: intent.id });
      await completeLogout(intent);
    },
    [completeLogout, fenceIdentity, transition],
  );

  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    const intent = currentIntent();
    if (intent) {
      // A pending logout finishes before any automatic restoration.
      if (stateRef.current.status !== 'logoutPending') {
        fenceIdentity();
        transition({ type: 'logoutStarted', scope: intent.scope });
      }
      await completeLogout(intent);
      return stateRef.current.session;
    }
    const generation = generationRef.current;
    try {
      const next = await authService.getSession(generation);
      if (generation !== generationRef.current) return stateRef.current.session;
      if (currentIntent()) return refreshRef.current();
      return acceptSession(next);
    } catch (error) {
      if (generation !== generationRef.current || isCancellation(error)) {
        return stateRef.current.session;
      }
      logError(error instanceof Error ? error : new Error('Failed to refresh session'), {
        scope: 'authSession.refresh',
      });
      // Transient: keep a warm identity, or show the cold retry surface.
      transition({ type: 'checkFailed' });
      scheduleRecovery(error);
      return stateRef.current.session;
    }
  }, [acceptSession, completeLogout, currentIntent, fenceIdentity, scheduleRecovery, transition]);
  refreshRef.current = refresh;

  useEffect(() => {
    apiClient.setAuthGenerationReader(() => generationRef.current);
    apiClient.setUnauthorizedHandler(async ({ endpoint, generation, bearer }) => {
      // Attempt bearers have their own owner (studentAttemptRepository).
      if (bearer || endpoint.startsWith('/v1/student/')) return;
      if (!stateRef.current.session) return;
      if (generation !== undefined && generation !== generationRef.current) return;
      // One deduped session check decides; a single 401 is not a logout.
      await refreshRef.current();
    });
    return () => {
      apiClient.setUnauthorizedHandler(null);
      apiClient.setAuthGenerationReader(null);
    };
  }, []);

  useEffect(() => {
    void refresh();
    return cancelRecovery;
  }, [cancelRecovery, refresh]);

  useEffect(() => {
    const resume = () => {
      const { status, degraded } = stateRef.current;
      const needsCheck =
        recoveryDeferredRef.current ||
        recoveryTimerRef.current !== null ||
        degraded ||
        status === 'unavailable' ||
        status === 'logoutPending';
      if (!needsCheck) return;
      if (document.visibilityState === 'hidden' || !navigator.onLine) {
        const notBefore = recoveryNotBeforeRef.current;
        cancelRecovery();
        recoveryNotBeforeRef.current = notBefore;
        recoveryDeferredRef.current = true;
        return;
      }
      // Visibility and reconnect never bypass the server's Retry-After.
      if (recoveryTimerRef.current !== null) return;
      const delay = recoveryNotBeforeRef.current - Date.now();
      cancelRecovery();
      if (delay > 0) {
        recoveryNotBeforeRef.current = Date.now() + delay;
        recoveryTimerRef.current = setTimeout(() => {
          recoveryTimerRef.current = null;
          void refreshRef.current();
        }, delay);
      } else {
        void refreshRef.current();
      }
    };
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeAuthEvents((event) => {
      if (event.type === 'logout') {
        // Another tab is signing out: hide identity now; that tab completes it.
        const intent = readLogoutIntent();
        if (intent && stateRef.current.status !== 'logoutPending') {
          fenceIdentity();
          transition({ type: 'logoutStarted', scope: intent.scope });
        }
        return;
      }
      // The cookie may now belong to another actor. Fence responses before
      // reconciling it, so an old request cannot repopulate private data.
      if (!readLogoutIntent(memoryIntentRef.current?.intent ?? null) && memoryIntentRef.current?.persisted) {
        memoryIntentRef.current = null;
      }
      fenceIdentity();
      void refreshRef.current();
    });
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
      unsubscribe();
    };
  }, [cancelRecovery, fenceIdentity, transition]);

  /**
   * Accept a credential-establishing response only after the server confirms
   * the cookie it set (another tab or navigation may have replaced it).
   */
  const reconcileEstablished = useCallback(
    async (created: AuthSession): Promise<AuthSession> => {
      if (isIdentityChange(stateRef.current.session, created)) {
        fenceIdentity();
        transition({ type: 'sessionResolved', session: null });
      }
      authService.invalidateSessionRequest();
      const generation = generationRef.current;
      let confirmed: AuthSession | null = created;
      try {
        confirmed = await authService.getSession(generationRef.current);
      } catch (error) {
        if (generation === generationRef.current && !isCancellation(error)) {
          // Until the actual cookie is confirmed, an account switch cannot
          // unlock private rendering from the mutation's JSON alone.
          transition({ type: 'checkFailed' });
          scheduleRecovery(error);
        }
        throw error;
      }
      if (generation !== generationRef.current || currentIntent()) {
        throw new DOMException('Sign-in was superseded.', 'AbortError');
      }
      if (!confirmed) {
        acceptSession(null);
        throw new Error(
          'Your browser did not keep the sign-in. Allow cookies for this site and try again.',
        );
      }
      acceptSession(confirmed);
      publishAuthEvent({ type: 'credential-changed', id: newOperationId() });
      return confirmed;
    },
    [acceptSession, currentIntent, fenceIdentity, scheduleRecovery, transition],
  );

  // JSON response fencing cannot undo Set-Cookie. Keep the mutation lock
  // through reconciliation, and leave any newer logout intent to revoke the
  // resulting cookie before private UI can return.
  const establishCredentials = useCallback(
    async (operation: () => Promise<AuthSession>): Promise<AuthSession> => {
      generationRef.current += 1;
      const generation = generationRef.current;
      authService.invalidateSessionRequest();
      cancelRecovery();
      let acknowledged = false;
      try {
        const created = await operation();
        acknowledged = true;
        if (generation !== generationRef.current) {
          throw new DOMException('Sign-in was superseded.', 'AbortError');
        }
        const intent = currentIntent();
        if (intent) clearLogoutIntent(intent.id);
        memoryIntentRef.current = null;
        return await reconcileEstablished(created);
      } catch (error) {
        if (!acknowledged && generation === generationRef.current && !isCancellation(error) && statusOf(error) !== 401) {
          // A lost acknowledgement may have changed the cookie. Do not replay
          // a password/token mutation; ask the server which identity survived.
          void refreshRef.current();
        }
        throw error;
      }
    },
    [cancelRecovery, currentIntent, reconcileEstablished],
  );

  const rememberMeAvailable = supportsAuthMutationLock();

  const login = useCallback(
    (email: string, password: string, rememberMe?: boolean) =>
      withAuthMutationLock(async () => {
        const created = await establishCredentials(() => authService.login({
          email,
          password,
          ...(rememberMe !== undefined && rememberMeAvailable ? { rememberMe } : {}),
        }));
        setLogoutAllUnconfirmed(false);
        return created;
      }),
    [establishCredentials, rememberMeAvailable],
  );

  const studentEntry = useCallback(async (payload: Omit<StudentEntryPayload, "entrySession">) => {
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
    acceptSession(result);
    return result as StudentEntrySuccess;
  }, [acceptSession]);

  const logout = useCallback(() => beginLogout('current'), [beginLogout]);
  const logoutAll = useCallback(() => beginLogout('all'), [beginLogout]);

  const dismissLogoutNotice = useCallback(() => {
    setLogoutAllUnconfirmed(false);
    transition({ type: 'noticeDismissed' });
  }, [transition]);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authService.requestPasswordReset({ email });
  }, []);

  const completePasswordReset = useCallback(
    (token: string, password: string) =>
      withAuthMutationLock(async () => {
        return establishCredentials(() => authService.completePasswordReset({ token, password }));
      }),
    [establishCredentials],
  );

  const activateAccount = useCallback(
    (token: string, password: string, displayName?: string | undefined) =>
      withAuthMutationLock(async () => {
        return establishCredentials(() => authService.activateAccount({ token, password, displayName }));
      }),
    [establishCredentials],
  );

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      session: state.session,
      status: state.status,
      degraded: state.degraded,
      pendingLogout: state.pendingLogout,
      logoutAllUnconfirmed: state.logoutAllUnconfirmed,
      rememberMeAvailable,
      login,
      studentEntry,
      logout,
      logoutAll,
      refresh,
      dismissLogoutNotice,
      requestPasswordReset,
      completePasswordReset,
      activateAccount,
    }),
    [
      activateAccount,
      completePasswordReset,
      dismissLogoutNotice,
      login,
      logout,
      logoutAll,
      refresh,
      rememberMeAvailable,
      requestPasswordReset,
      state,
      studentEntry,
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
