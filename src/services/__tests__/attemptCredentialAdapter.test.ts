import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  storeAttemptCredential,
  clearAttemptCredential,
  hasAttemptCredential,
  buildAttemptAuthorizationHeader,
  tryBuildAttemptAuthorizationHeader,
} from '../attemptCredentialAdapter';

const STORAGE_KEY = 'ielts_student_attempt_credentials_v1';

function setStorageRaw(storage: Storage, raw: string | null) {
  if (raw === null) {
    storage.removeItem(STORAGE_KEY);
  } else {
    storage.setItem(STORAGE_KEY, raw);
  }
}

function getStorageRaw(storage: Storage): string | null {
  return storage.getItem(STORAGE_KEY);
}

describe('attemptCredentialAdapter', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('storeAttemptCredential', () => {
    it('stores credential in both localStorage and sessionStorage', () => {
      storeAttemptCredential(
        { id: 'attempt-1', scheduleId: 'schedule-1' },
        { attemptToken: 'token-abc', expiresAt: '2026-12-31T00:00:00Z' },
      );

      const localRaw = getStorageRaw(localStorage);
      const sessionRaw = getStorageRaw(sessionStorage);
      expect(localRaw).toBeTruthy();
      expect(sessionRaw).toBeTruthy();

      const parsed = JSON.parse(localRaw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        attemptId: 'attempt-1',
        scheduleId: 'schedule-1',
        attemptToken: 'token-abc',
        expiresAt: '2026-12-31T00:00:00Z',
      });
    });

    it('does nothing when credential is null', () => {
      storeAttemptCredential({ id: 'a1', scheduleId: 's1' }, null);
      expect(getStorageRaw(localStorage)).toBeNull();
      expect(getStorageRaw(sessionStorage)).toBeNull();
    });

    it('does nothing when credential is undefined', () => {
      storeAttemptCredential({ id: 'a1', scheduleId: 's1' }, undefined);
      expect(getStorageRaw(localStorage)).toBeNull();
    });

    it('replaces existing credential for same attempt+schedule', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 'old-token', expiresAt: '2026-01-01T00:00:00Z' },
      );
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 'new-token', expiresAt: '2026-06-01T00:00:00Z' },
      );

      const parsed = JSON.parse(getStorageRaw(localStorage)!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].attemptToken).toBe('new-token');
    });

    it('preserves other credentials when storing a different attempt', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 'token-1', expiresAt: '2026-01-01T00:00:00Z' },
      );
      storeAttemptCredential(
        { id: 'a2', scheduleId: 's1' },
        { attemptToken: 'token-2', expiresAt: '2026-06-01T00:00:00Z' },
      );

      const parsed = JSON.parse(getStorageRaw(localStorage)!);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('clearAttemptCredential', () => {
    it('removes credential for matching attempt+schedule', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 't1', expiresAt: '2026-01-01T00:00:00Z' },
      );
      storeAttemptCredential(
        { id: 'a2', scheduleId: 's1' },
        { attemptToken: 't2', expiresAt: '2026-06-01T00:00:00Z' },
      );

      clearAttemptCredential({ id: 'a1', scheduleId: 's1' });

      const parsed = JSON.parse(getStorageRaw(localStorage)!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].attemptId).toBe('a2');
    });

    it('does nothing when credential does not exist', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 't1', expiresAt: '2026-01-01T00:00:00Z' },
      );
      clearAttemptCredential({ id: 'nonexistent', scheduleId: 's1' });
      const parsed = JSON.parse(getStorageRaw(localStorage)!);
      expect(parsed).toHaveLength(1);
    });
  });

  describe('hasAttemptCredential', () => {
    it('returns true when credential exists', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 't1', expiresAt: '2026-01-01T00:00:00Z' },
      );
      expect(hasAttemptCredential('s1', 'a1')).toBe(true);
    });

    it('returns false when credential does not exist', () => {
      expect(hasAttemptCredential('s1', 'a1')).toBe(false);
    });

    it('returns false after credential is cleared', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 't1', expiresAt: '2026-01-01T00:00:00Z' },
      );
      clearAttemptCredential({ id: 'a1', scheduleId: 's1' });
      expect(hasAttemptCredential('s1', 'a1')).toBe(false);
    });
  });

  describe('buildAttemptAuthorizationHeader', () => {
    it('returns Bearer header for stored credential', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 'my-secret-token', expiresAt: '2026-12-31T00:00:00Z' },
      );
      const header = buildAttemptAuthorizationHeader({ id: 'a1', scheduleId: 's1' });
      expect(header).toEqual({ Authorization: 'Bearer my-secret-token' });
    });

    it('throws when credential is missing', () => {
      expect(() =>
        buildAttemptAuthorizationHeader({ id: 'a1', scheduleId: 's1' }),
      ).toThrow('Missing attempt credential for student session.');
    });
  });

  describe('tryBuildAttemptAuthorizationHeader', () => {
    it('returns header when credential exists', () => {
      storeAttemptCredential(
        { id: 'a1', scheduleId: 's1' },
        { attemptToken: 'tok', expiresAt: '2026-12-31T00:00:00Z' },
      );
      const header = tryBuildAttemptAuthorizationHeader('s1', 'a1');
      expect(header).toEqual({ Authorization: 'Bearer tok' });
    });

    it('returns null when credential is missing', () => {
      const header = tryBuildAttemptAuthorizationHeader('s1', 'a1');
      expect(header).toBeNull();
    });
  });

  describe('corrupted storage resilience', () => {
    it('handles corrupted JSON in localStorage gracefully', () => {
      setStorageRaw(localStorage, '{invalid json');
      expect(hasAttemptCredential('s1', 'a1')).toBe(false);
      expect(() =>
        buildAttemptAuthorizationHeader({ id: 'a1', scheduleId: 's1' }),
      ).toThrow('Missing attempt credential');
    });

    it('handles non-array JSON in localStorage gracefully', () => {
      setStorageRaw(localStorage, JSON.stringify({ not: 'array' }));
      expect(hasAttemptCredential('s1', 'a1')).toBe(false);
    });

    it('filters out malformed entries in stored array', () => {
      setStorageRaw(
        localStorage,
        JSON.stringify([
          { attemptId: 'a1', scheduleId: 's1', attemptToken: 't1', expiresAt: '2026-01-01T00:00:00Z' },
          { bad: 'entry' },
          null,
          42,
        ]),
      );
      expect(hasAttemptCredential('s1', 'a1')).toBe(true);
      expect(hasAttemptCredential('s1', 'bad')).toBe(false);
    });

    it('merges credentials from localStorage and sessionStorage', () => {
      setStorageRaw(
        localStorage,
        JSON.stringify([
          { attemptId: 'a1', scheduleId: 's1', attemptToken: 'local-token', expiresAt: '2026-01-01T00:00:00Z' },
        ]),
      );
      setStorageRaw(
        sessionStorage,
        JSON.stringify([
          { attemptId: 'a2', scheduleId: 's1', attemptToken: 'session-token', expiresAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      expect(hasAttemptCredential('s1', 'a1')).toBe(true);
      expect(hasAttemptCredential('s1', 'a2')).toBe(true);
    });

    it('sessionStorage credential with later expiry wins over localStorage for same key', () => {
      setStorageRaw(
        localStorage,
        JSON.stringify([
          { attemptId: 'a1', scheduleId: 's1', attemptToken: 'local', expiresAt: '2026-01-01T00:00:00Z' },
        ]),
      );
      setStorageRaw(
        sessionStorage,
        JSON.stringify([
          { attemptId: 'a1', scheduleId: 's1', attemptToken: 'session', expiresAt: '2026-12-31T00:00:00Z' },
        ]),
      );

      const header = buildAttemptAuthorizationHeader({ id: 'a1', scheduleId: 's1' });
      expect(header).toEqual({ Authorization: 'Bearer session' });
    });
  });
});
