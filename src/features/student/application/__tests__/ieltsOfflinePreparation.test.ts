import { beforeEach, describe, expect, it } from 'vitest';
import { prepareIeltsOfflinePackage } from '../ieltsOfflinePreparation';
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
