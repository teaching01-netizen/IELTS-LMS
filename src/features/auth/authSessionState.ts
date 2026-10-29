import type { AuthSession } from './api/authGateway';
import type { LogoutScope } from './infrastructure/authBrowserCoordination';

/**
 * - loading: first session check pending, nothing known yet.
 * - authenticated: server-confirmed session (`degraded` when the latest check
 *   failed transiently; identity is retained, never assumed gone).
 * - unauthenticated: the server said there is no session.
 * - unavailable: no known session and the check failed transiently. Never a
 *   login redirect: the session may still be valid.
 * - logoutPending: a logout was requested but not confirmed; private UI hidden.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable' | 'logoutPending';

export interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  degraded: boolean;
  pendingLogout: { scope: LogoutScope; failed: boolean; durable: boolean } | null;
  /** This browser is signed out but sign-out everywhere was not confirmed. */
  logoutAllUnconfirmed: boolean;
}

export type AuthEvent =
  | { type: 'sessionResolved'; session: AuthSession | null }
  | { type: 'checkFailed' }
  | { type: 'logoutStarted'; scope: LogoutScope; durable?: boolean }
  | { type: 'logoutFailed' }
  | { type: 'loggedOut'; allUnconfirmed: boolean }
  | { type: 'noticeDismissed' };

export const initialAuthState: AuthState = {
  status: 'loading',
  session: null,
  degraded: false,
  pendingLogout: null,
  logoutAllUnconfirmed: false,
};

export function reduceAuthState(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case 'sessionResolved':
      return {
        ...state,
        status: event.session ? 'authenticated' : 'unauthenticated',
        session: event.session,
        degraded: false,
        pendingLogout: null,
        logoutAllUnconfirmed: event.session ? false : state.logoutAllUnconfirmed,
      };
    case 'checkFailed':
      if (state.status === 'logoutPending') return state;
      return state.session
        ? { ...state, status: 'authenticated', degraded: true }
        : { ...state, status: 'unavailable', degraded: false };
    case 'logoutStarted':
      return {
        ...state,
        status: 'logoutPending',
        session: null,
        degraded: false,
        pendingLogout: { scope: event.scope, failed: false, durable: event.durable ?? true },
      };
    case 'logoutFailed':
      return state.pendingLogout
        ? { ...state, pendingLogout: { ...state.pendingLogout, failed: true } }
        : state;
    case 'loggedOut':
      return {
        ...state,
        status: 'unauthenticated',
        session: null,
        degraded: false,
        pendingLogout: null,
        logoutAllUnconfirmed: event.allUnconfirmed,
      };
    case 'noticeDismissed':
      return { ...state, logoutAllUnconfirmed: false };
  }
}

/** True when two sessions belong to different actors (private data must not carry over). */
export function isIdentityChange(previous: AuthSession | null, next: AuthSession | null): boolean {
  if (!previous) return false;
  return !next || next.user.id !== previous.user.id || next.user.role !== previous.user.role;
}

const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * Backoff for the session recovery timer: 1, 2, 4, 8, 16, then 30 s, with up to
 * 20% jitter. A valid server Retry-After is a lower bound and is never jittered
 * below.
 */
export function recoveryDelayMs(attempt: number, retryAfterMs: number | null, random = Math.random): number {
  const base = RECOVERY_DELAYS_MS[Math.min(attempt, RECOVERY_DELAYS_MS.length - 1)] ?? 30_000;
  const jittered = base + Math.floor(base * 0.2 * random());
  return retryAfterMs !== null && retryAfterMs > jittered ? retryAfterMs : jittered;
}

/**
 * Parse Retry-After as delta-seconds or an HTTP-date. Invalid or past values
 * return null so the normal backoff applies.
 */
export function parseRetryAfterMs(value: unknown, now = Date.now()): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value * 1000 : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds * 1000 : null;
  }
  const at = Date.parse(trimmed);
  return Number.isFinite(at) && at > now ? at - now : null;
}

/** Retry-After hint from a rejected session check, if the server sent one. */
export function retryAfterFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const details = (record['details'] ?? record['backendDetails']) as Record<string, unknown> | undefined;
  for (const candidate of [details?.['retryAfterSeconds'], details?.['retryAfterSecs'], details?.['retryAfter']]) {
    const parsed = parseRetryAfterMs(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}
