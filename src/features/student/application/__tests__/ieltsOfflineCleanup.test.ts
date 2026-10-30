import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupIeltsOfflineArtifacts } from '../ieltsOfflineCleanup';
import {
  beginIeltsOfflinePackage,
  loadIeltsOfflinePackageForRoute,
  markIeltsOfflinePackageReady,
  recordIeltsOfflineAccount,
} from '../../infrastructure/ieltsOfflinePackageStore';
import { createFakeCaches, testManifest } from '../../infrastructure/__tests__/ieltsOfflineTestKit';

describe('IELTS offline cleanup', () => {
  let caches: ReturnType<typeof createFakeCaches>;

  beforeEach(() => {
    localStorage.clear();
    caches = createFakeCaches();
    vi.stubGlobal('caches', caches);
    recordIeltsOfflineAccount('user-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes only the confirmed attempt package and its media cache', async () => {
    const record = await beginIeltsOfflinePackage({
      userId: 'user-1',
      candidateId: 'W001',
      manifest: testManifest(),
      staticPayload: {},
      liveSnapshot: null,
      receivedWallMs: 1,
    });
    await markIeltsOfflinePackageReady(record, [], 'build-1');
    localStorage.setItem('v2_confirmed_answers:att-1', JSON.stringify({ q1: { answer: 'x' } }));
    const mediaCache = await caches.open('ielts-offline-media-v1:att-1');
    await mediaCache.put('https://ielts-offline.invalid/rev/r-audio', new Response('bytes'));
    expect((await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1')).ok).toBe(true);

    await cleanupIeltsOfflineArtifacts('att-1');

    expect(await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1')).toEqual({
      ok: false,
      reason: 'no_package',
    });
    const emptied = await caches.open('ielts-offline-media-v1:att-1');
    expect(await emptied.match('https://ielts-offline.invalid/rev/r-audio')).toBeUndefined();
    expect(localStorage.getItem('v2_confirmed_answers:att-1')).toBeNull();
  });

  it('keeps another attempt package intact', async () => {
    const first = await beginIeltsOfflinePackage({
      userId: 'user-1',
      candidateId: 'W001',
      manifest: testManifest(),
      staticPayload: {},
      liveSnapshot: null,
      receivedWallMs: 1,
    });
    await markIeltsOfflinePackageReady(first, [], 'build-1');
    const second = await beginIeltsOfflinePackage({
      userId: 'user-1',
      candidateId: 'W002',
      manifest: testManifest({ attemptId: 'att-2', clientSessionId: 'cs-2' }),
      staticPayload: {},
      liveSnapshot: null,
      receivedWallMs: 1,
    });
    await markIeltsOfflinePackageReady(second, [], 'build-1');

    await cleanupIeltsOfflineArtifacts('att-1');

    expect((await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1')).ok).toBe(false);
    expect((await loadIeltsOfflinePackageForRoute('sched-1', 'W002', 'user-1')).ok).toBe(true);
  });
});
