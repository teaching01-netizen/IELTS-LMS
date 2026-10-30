import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginIeltsOfflinePackage,
  blockIeltsOfflinePackages,
  hasIeltsOfflineRoute,
  ieltsOfflinePackageKey,
  latestIeltsOfflineManifest,
  loadIeltsOfflinePackageForRoute,
  markIeltsOfflinePackageReady,
  parseIeltsOfflineManifest,
  recordIeltsOfflineAccount,
  rememberIeltsOfflineManifest,
} from '../ieltsOfflinePackageStore';
import { testManifest } from './ieltsOfflineTestKit';

async function readyPackage(userId = 'user-1', manifest = testManifest()) {
  const record = await beginIeltsOfflinePackage({
    userId,
    candidateId: 'W001',
    manifest,
    staticPayload: { schedule: {}, version: {}, attemptCredential: { attemptToken: 'secret' } },
    liveSnapshot: null,
    receivedWallMs: 1,
  });
  return { record, ready: () => markIeltsOfflinePackageReady(record, [], 'build-1') };
}

describe('IELTS offline package store', () => {
  beforeEach(() => localStorage.clear());

  it('validates server manifests as untrusted input', () => {
    expect(parseIeltsOfflineManifest(testManifest())).not.toBeNull();
    expect(parseIeltsOfflineManifest({ ...testManifest(), schemaVersion: 2 })).toBeNull();
    expect(parseIeltsOfflineManifest({ ...testManifest(), leaseEpoch: -1 })).toBeNull();
    expect(parseIeltsOfflineManifest({ ...testManifest(), media: [{ ...testManifest().media[0], kind: 'video' }] })).toBeNull();
    expect(parseIeltsOfflineManifest({ ...testManifest(), schedule: { schemaVersion: 1 } })).toBeNull();
  });

  it('keeps only the newest manifest per attempt', () => {
    rememberIeltsOfflineManifest(testManifest({ serverNow: '2026-10-30T03:00:00Z', controlEpoch: 4 }));
    rememberIeltsOfflineManifest(testManifest({ serverNow: '2026-10-30T02:00:00Z', controlEpoch: 2 }));
    expect(latestIeltsOfflineManifest('att-1')?.controlEpoch).toBe(4);
  });

  it('binds the package identity to user, version, browser session, lease and run', () => {
    const base = ieltsOfflinePackageKey('u', testManifest());
    expect(ieltsOfflinePackageKey('u', testManifest({ leaseEpoch: 2 }))).not.toBe(base);
    expect(ieltsOfflinePackageKey('u', testManifest({ recoveryRunGeneration: 1 }))).not.toBe(base);
    expect(ieltsOfflinePackageKey('v', testManifest())).not.toBe(base);
  });

  it('opens nothing before the ready marker and strips credentials', async () => {
    recordIeltsOfflineAccount('user-1');
    const { ready } = await readyPackage();
    expect(hasIeltsOfflineRoute('sched-1', 'W001')).toBe(false);
    expect(await loadIeltsOfflinePackageForRoute('sched-1', 'W001', null)).toEqual({ ok: false, reason: 'no_package' });
    await ready();
    const restored = await loadIeltsOfflinePackageForRoute('sched-1', 'W001', null);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.record.staticPayload['attemptCredential']).toBeUndefined();
  });

  it("fails closed for another account's package and after logout", async () => {
    recordIeltsOfflineAccount('user-1');
    await (await readyPackage()).ready();
    expect(await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-2')).toEqual({ ok: false, reason: 'identity_mismatch' });
    recordIeltsOfflineAccount('user-2');
    expect(await loadIeltsOfflinePackageForRoute('sched-1', 'W001', null)).toEqual({ ok: false, reason: 'identity_mismatch' });
    recordIeltsOfflineAccount('user-1');
    await blockIeltsOfflinePackages();
    expect((await loadIeltsOfflinePackageForRoute('sched-1', 'W001', 'user-1')).ok).toBe(false);
  });
});
