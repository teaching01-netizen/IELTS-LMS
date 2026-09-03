import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiClient } from "../../shared/api/apiClient";
import { queryClient } from "../../shared/api/queryClient";
import { logError } from "../../shared/observability/errorLogger";
import {
  authService,
  type AuthSession,
  type AuthUserRole,
  type StudentEntryResult,
} from "./api/authGateway";

export type { StudentQueuedAdmission } from "./api/authGateway";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

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
    displayName?: string | undefined
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

function setSessionState(
  nextSession: AuthSession | null,
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>,
  setStatus: React.Dispatch<React.SetStateAction<AuthStatus>>
): AuthSession | null {
  applySessionHeaders(nextSession);
  setSession(nextSession);
  setStatus(nextSession ? "authenticated" : "unauthenticated");
  return nextSession;
}

export function resolveRoleLandingPath(role: AuthUserRole): string {
  switch (role) {
    case "admin":
    case "builder":
      return "/admin/exams";
    case "grader":
      return "/admin/grading";
    case "proctor":
      return "/proctor";
    case "student":
      return "/login";
  }
}

export function resolvePostLoginPath(
  role: AuthUserRole,
  nextPath?: string | null | undefined
): string {
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return resolveRoleLandingPath(role);
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const sessionRef = useRef<AuthSession | null>(null);
  const sessionRequestGenerationRef = useRef(0);

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
      if (endpoint.startsWith("/v1/student/")) {
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
    const requestGeneration = sessionRequestGenerationRef.current;
    try {
      const nextSession = await authService.getSession();
      if (requestGeneration !== sessionRequestGenerationRef.current) {
        return sessionRef.current;
      }
      return setSessionState(nextSession, setSession, setStatus);
    } catch (error) {
      if (requestGeneration !== sessionRequestGenerationRef.current) {
        return sessionRef.current;
      }
      logError(error instanceof Error ? error : new Error("Failed to refresh session"), {
        scope: "authSession.refresh",
      });
      return setSessionState(null, setSession, setStatus);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    sessionRequestGenerationRef.current += 1;
    const nextSession = await authService.login({ email, password });
    return setSessionState(nextSession, setSession, setStatus) as AuthSession;
  }, []);

  const studentEntry = useCallback(
    async (payload: {
      scheduleId: string;
      wcode: string;
      email: string;
      studentName: string;
      nickname: string;
      ieltsCourse: string;
    }) => {
      sessionRequestGenerationRef.current += 1;
      const result = await authService.studentEntry(payload);
      if (!("user" in result)) {
        return result;
      }
      return setSessionState(result, setSession, setStatus) as AuthSession;
    },
    []
  );

  const logout = useCallback(async () => {
    sessionRequestGenerationRef.current += 1;
    try {
      await authService.logout();
    } finally {
      setSessionState(null, setSession, setStatus);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    sessionRequestGenerationRef.current += 1;
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
    sessionRequestGenerationRef.current += 1;
    const nextSession = await authService.completePasswordReset({ token, password });
    return setSessionState(nextSession, setSession, setStatus) as AuthSession;
  }, []);

  const activateAccount = useCallback(
    async (token: string, password: string, displayName?: string | undefined) => {
      sessionRequestGenerationRef.current += 1;
      const nextSession = await authService.activateAccount({
        token,
        password,
        displayName,
      });
      return setSessionState(nextSession, setSession, setStatus) as AuthSession;
    },
    []
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
    ]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
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
