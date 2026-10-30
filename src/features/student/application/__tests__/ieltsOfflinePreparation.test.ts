import { beforeEach, describe, expect, it } from 'vitest';
import {
  IELTS_OFFLINE_MAX_ATTEMPTS,
  isRetryableIeltsOfflineFailure,
  nextIeltsOfflineRetryDelayMs,
  prepareIeltsOfflinePackage,
  type IeltsOfflinePreparationFailure,
} from '../ieltsOfflinePreparation';
import { loadIeltsOfflinePackageForRoute, recordIeltsOfflineAccount } from '../../infrastructure/ieltsOfflinePackageStore';
import { createFakeCaches, okFetch, testManifest } from '../../infrastructure/__tests__/ieltsOfflineTestKit';

const identity = {
  userId: 'user-1',
  candidateId: 'W001',
  scheduleId: 'sched-1',
  attemptId: 'att-1',
  publishedVersionId: 'ver-1',
  clientSessionId: 'cs-1',
};
const bodies = { '/media/a.mp3': 'audio-bytes', 'https://cdn.example/i.png': 'image-bytes' };
const deps = (over: Record<string, unknown> = {}) => ({
  caches: createFakeCaches(),
  fetchImpl: okFetch(bodies),
  probeAudio: async () => true,
  ensureShell: async () => ({ ok: true as const, buildId: 'build-1' }),
  verifyStorage: async () => true,
  estimateStorage: async () => undefined,
  ...over,
});
const run = (over: Record<string, unknown> = {}, manifest = testManifest()) =>
  prepareIeltsOfflinePackage({ manifest, identity, staticPayload: { schedule: {}, version: {} }, liveSnapshot: null }, deps(over));

describe('prepareIeltsOfflinePackage', () => {
  beforeEach(() => {
    localStorage.clear();
    recordIeltsOfflineAccount('user-1');
  });

  it('reports prepared only after shell, media, read-back and storage pass', async () => {
    const result = await run();
    expect(result.status).toBe('prepared');
    const restored = await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1');
    expect(restored.ok && restored.record.media.length).toBe(2);
  });

  it.each([
    ['shell_unavailable', { ensureShell: async () => ({ ok: false, reason: 'shell_unavailable' }) }],
    ['media_failed', { fetchImpl: okFetch({}) }],
    ['audio_unavailable', { probeAudio: async () => false }],
    ['storage_failed', { verifyStorage: async () => false }],
    ['quota', { estimateStorage: async () => ({ quota: 10, usage: 9 }) }],
  ])('fails locally with %s and never writes the ready marker', async (reason, over) => {
    const manifest = reason === 'quota' ? testManifest({ media: testManifest().media.map((m) => ({ ...m, bytes: 11 })) }) : testManifest();
    const result = await run(over, manifest);
    expect(result).toMatchObject({ status: 'failed', reason });
    expect((await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1')).ok).toBe(false);
  });

  it('refuses a manifest for another attempt or browser session', async () => {
    expect(await run({}, testManifest({ attemptId: 'other' }))).toMatchObject({ reason: 'identity_mismatch' });
    expect(await run({}, testManifest({ clientSessionId: 'other' }))).toMatchObject({ reason: 'identity_mismatch' });
  });
});

describe('IELTS offline retry policy', () => {
  it('retries only failures that can clear on their own', () => {
    const expected: Array<[IeltsOfflinePreparationFailure, boolean]> = [
      ['shell_unavailable', true],
      ['media_failed', true],
      ['storage_failed', true],
      ['quota', false],
      ['audio_unavailable', false],
      ['identity_mismatch', false],
      ['manifest_invalid', false],
      ['cancelled', false],
    ];
    for (const [reason, retryable] of expected) {
      expect(isRetryableIeltsOfflineFailure(reason), reason).toBe(retryable);
    }
  });

  it('caps the budget at one initial attempt plus three retries', () => {
    expect(IELTS_OFFLINE_MAX_ATTEMPTS).toBe(4);
    expect(nextIeltsOfflineRetryDelayMs(1)).not.toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(2)).not.toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(3)).not.toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(4)).toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(IELTS_OFFLINE_MAX_ATTEMPTS)).toBeNull();
  });

  it('backs off 5s, 20s and 60s with ±20% jitter', () => {
    const bases = [5_000, 20_000, 60_000];
    for (const [index, base] of bases.entries()) {
      const failedAttempt = index + 1;
      expect(nextIeltsOfflineRetryDelayMs(failedAttempt, () => 0.5)).toBe(base);
      expect(nextIeltsOfflineRetryDelayMs(failedAttempt, () => 0)).toBe(Math.round(base * 0.8));
      expect(nextIeltsOfflineRetryDelayMs(failedAttempt, () => 1)).toBe(Math.round(base * 1.2));
    }
  });

  it('never leaves the jitter band for degenerate input', () => {
    expect(nextIeltsOfflineRetryDelayMs(1, () => Number.NaN)).toBe(5_000);
    expect(nextIeltsOfflineRetryDelayMs(1, () => -5)).toBe(4_000);
    expect(nextIeltsOfflineRetryDelayMs(1, () => 5)).toBe(6_000);
    expect(nextIeltsOfflineRetryDelayMs(0)).toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(-1)).toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(Number.NaN)).toBeNull();
    expect(nextIeltsOfflineRetryDelayMs(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
