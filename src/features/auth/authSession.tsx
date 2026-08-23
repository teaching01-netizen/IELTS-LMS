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
import { queryClient } from '../../app/data/queryClient';
import { logError } from '../../app/error/errorLogger';
import {
  applyAuthTransportSession,
  authService,
  registerAuthUnauthorizedHandler,
  type AuthSession,
  type AuthUserRole,
  type StudentEntryResult,
} from '../../services/authService';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthSessionContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<AuthSession>;
  studentEntry: (payload: {
    scheduleId: string;
    wcode: string;
    email: string;
    studentName: string;
    nickname: string;
    ieltsCourse: string;
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

function setSessionState(
  nextSession: AuthSession | null,
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>,
  setStatus: React.Dispatch<React.SetStateAction<AuthStatus>>,
): AuthSession | null {
  applyAuthTransportSession(nextSession);
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

export function resolvePostLoginPath(
  role: AuthUserRole,
  nextPath?: string | null | undefined,
): string {
  if (nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//')) {
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
    registerAuthUnauthorizedHandler(({ endpoint }) => {
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
      registerAuthUnauthorizedHandler(null);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nextSession = await authService.getSession();
      return setSessionState(nextSession, setSession, setStatus);
    } catch (error) {
      logError(error instanceof Error ? error : new Error('Failed to refresh session'), {
        scope: 'authSession.refresh',
      });
      return setSessionState(null, setSession, setStatus);
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
    scheduleId: string;
    wcode: string;
    email: string;
    studentName: string;
    nickname: string;
    ieltsCourse: string;
  }) => {
    const result = await authService.studentEntry(payload);
    if ('state' in result && result.state === 'queued') {
      return result;
    }
    return setSessionState(result, setSession, setStatus) as AuthSession;
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
