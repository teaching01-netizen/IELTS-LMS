import { describe, expect, it } from 'vitest';
import {
  initialAuthState,
  isIdentityChange,
  parseRetryAfterMs,
  recoveryDelayMs,
  reduceAuthState,
} from '../authSessionState';

const session = {
  user: { id: 'u1', email: 'a@example.com', role: 'admin' as const, state: 'active' as const },
  csrfToken: 'c',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('reduceAuthState', () => {
  it('cold transient failure is unavailable, never unauthenticated', () => {
    expect(reduceAuthState(initialAuthState, { type: 'checkFailed' }).status).toBe('unavailable');
  });

  it('warm transient failure keeps identity and marks it degraded', () => {
    const warm = reduceAuthState(initialAuthState, { type: 'sessionResolved', session });
    const next = reduceAuthState(warm, { type: 'checkFailed' });
    expect(next).toMatchObject({ status: 'authenticated', session, degraded: true });
  });

  it('logout hides identity immediately and stays pending through failures', () => {
    const warm = reduceAuthState(initialAuthState, { type: 'sessionResolved', session });
    const pending = reduceAuthState(warm, { type: 'logoutStarted', scope: 'all' });
    expect(pending).toMatchObject({ status: 'logoutPending', session: null });
    const failed = reduceAuthState(reduceAuthState(pending, { type: 'logoutFailed' }), { type: 'checkFailed' });
    expect(failed).toMatchObject({ status: 'logoutPending', pendingLogout: { scope: 'all', failed: true } });
  });

  it('records an unconfirmed all-device logout until a session is established', () => {
    const out = reduceAuthState(initialAuthState, { type: 'loggedOut', allUnconfirmed: true });
    expect(out).toMatchObject({ status: 'unauthenticated', logoutAllUnconfirmed: true });
    expect(reduceAuthState(out, { type: 'sessionResolved', session }).logoutAllUnconfirmed).toBe(false);
  });
});

describe('isIdentityChange', () => {
  it('fences only when a previous actor is replaced or removed', () => {
    expect(isIdentityChange(null, session)).toBe(false);
    expect(isIdentityChange(session, session)).toBe(false);
    expect(isIdentityChange(session, null)).toBe(true);
    expect(isIdentityChange(session, { ...session, user: { ...session.user, id: 'u2' } })).toBe(true);
  });
});

describe('recovery backoff', () => {
  it('follows 1, 2, 4, 8, 16, then 30 seconds with bounded jitter', () => {
    const none = () => 0;
    expect([0, 1, 2, 3, 4, 5, 9].map((attempt) => recoveryDelayMs(attempt, null, none))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(recoveryDelayMs(0, null, () => 0.999)).toBeLessThan(1200);
  });

  it('treats Retry-After as a lower bound, including values above 30 seconds', () => {
    expect(recoveryDelayMs(0, 90_000, () => 0.5)).toBe(90_000);
    expect(recoveryDelayMs(5, 1_000, () => 0)).toBe(30_000);
  });

  it('parses delta-seconds and HTTP-date; rejects invalid or past values', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
    expect(parseRetryAfterMs(5, now)).toBe(5_000);
    expect(parseRetryAfterMs('Thu, 29 Oct 2026 10:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfterMs('Thu, 29 Oct 2026 09:00:00 GMT', now)).toBeNull();
    expect(parseRetryAfterMs('soon', now)).toBeNull();
    expect(parseRetryAfterMs('0', now)).toBeNull();
  });
});
