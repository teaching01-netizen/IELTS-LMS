import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSatResumeLocator,
  loadSatResumeLocator,
  matchesSatResumeLocator,
  saveSatResumeLocator,
} from '../satResumeLocator';

const KEY = 'sat-resume-locator:v1';

describe('satResumeLocator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('writes and reads a versioned non-secret locator', () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W100001', attemptId: 'attempt-1' });

    expect(loadSatResumeLocator()).toMatchObject({
      version: 1,
      providerKey: 'sat',
      scheduleId: 'schedule-1',
      candidateId: 'W100001',
      attemptId: 'attempt-1',
    });
    expect(window.localStorage.getItem(KEY)).not.toContain('attemptToken');
  });

  it('ignores corrupted, unsupported, wrong-provider, and incomplete records', () => {
    window.localStorage.setItem(KEY, '{');
    expect(loadSatResumeLocator()).toBeNull();

    for (const value of [
      { version: 2, providerKey: 'sat', scheduleId: 's', candidateId: 'c', updatedAt: new Date().toISOString() },
      { version: 1, providerKey: 'ielts', scheduleId: 's', candidateId: 'c', updatedAt: new Date().toISOString() },
      { version: 1, providerKey: 'sat', scheduleId: 's', updatedAt: new Date().toISOString() },
    ]) {
      window.localStorage.setItem(KEY, JSON.stringify(value));
      expect(loadSatResumeLocator()).toBeNull();
    }
  });

  it('ignores locators older than 30 days and future-dated records', () => {
    for (const updatedAt of [
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
    ]) {
      window.localStorage.setItem(KEY, JSON.stringify({
        version: 1,
        providerKey: 'sat',
        scheduleId: 'schedule-1',
        candidateId: 'W100001',
        updatedAt,
      }));
      expect(loadSatResumeLocator()).toBeNull();
    }
  });

  it('does not throw when local storage reads or writes are denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadSatResumeLocator()).toBeNull();
    expect(() => saveSatResumeLocator({ scheduleId: 's', candidateId: 'c' })).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveSatResumeLocator({ scheduleId: 's', candidateId: 'c' })).not.toThrow();
  });

  it('clears best-effort and matches only the trusted schedule/link scope', () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W100001', accessLinkId: 'link-1' });
    const locator = loadSatResumeLocator();
    expect(matchesSatResumeLocator(locator, { scheduleId: 'schedule-1', accessLinkId: 'link-1' })).toBe(true);
    expect(matchesSatResumeLocator(locator, { scheduleId: 'schedule-2', accessLinkId: 'link-1' })).toBe(false);
    expect(matchesSatResumeLocator(locator, { scheduleId: 'schedule-1', accessLinkId: 'link-2' })).toBe(false);
    clearSatResumeLocator();
    expect(loadSatResumeLocator()).toBeNull();
  });

  it('does not throw when local storage removal is denied', () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W100001' });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

    expect(() => clearSatResumeLocator()).not.toThrow();
  });

  it('keeps a tampered attempt id advisory', () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W100001', attemptId: 'attempt-real' });
    const locator = loadSatResumeLocator();
    window.localStorage.setItem(KEY, JSON.stringify({ ...locator, attemptId: 'attempt-tampered' }));

    const tampered = loadSatResumeLocator();
    expect(tampered?.attemptId).toBe('attempt-tampered');
    expect(matchesSatResumeLocator(tampered, { scheduleId: 'schedule-1' })).toBe(true);
  });
});
