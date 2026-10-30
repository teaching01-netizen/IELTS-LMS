import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import type { IeltsOfflineManifest, IeltsOfflinePackage } from '../../infrastructure/ieltsOfflinePackageStore';
import { ieltsOfflinePackageKey } from '../../infrastructure/ieltsOfflinePackageStore';
import { testManifest } from '../../infrastructure/__tests__/ieltsOfflineTestKit';
import { useIeltsOfflineContinuity } from '../useIeltsOfflineContinuity';

const prepare = vi.hoisted(() => vi.fn());
const pinShell = vi.hoisted(() => vi.fn());
const refreshPackage = vi.hoisted(() => vi.fn());
const latestManifest = vi.hoisted(() => vi.fn());
const backendPost = vi.hoisted(() => vi.fn());

// The manifest object is replaced by every poll and only reaches the hook
// through the store subscription, so tests drive it through this bus.
const manifestBus = vi.hoisted(() => {
  const listeners = new Set<(manifest: IeltsOfflineManifest) => void>();
  return {
    listeners,
    subscribe(listener: (manifest: IeltsOfflineManifest) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(manifest: IeltsOfflineManifest) {
      for (const listener of listeners) listener(manifest);
    },
  };
});

vi.mock('../../application/ieltsOfflinePreparation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../application/ieltsOfflinePreparation')>();
  return { ...actual, prepareIeltsOfflinePackage: prepare };
});

vi.mock('../../infrastructure/ieltsOfflineShell', () => ({
  pinIeltsOfflineShell: pinShell,
  ensureIeltsOfflineShell: vi.fn(),
}));

vi.mock('../../infrastructure/ieltsOfflinePackageStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../infrastructure/ieltsOfflinePackageStore')>();
  return {
    ...actual,
    latestIeltsOfflineManifest: latestManifest,
    subscribeIeltsOfflineManifest: manifestBus.subscribe,
    refreshIeltsOfflinePackage: refreshPackage,
  };
});

vi.mock('../../api/studentAttemptGateway', () => ({
  backendPost,
  ensureBrowserClientSessionIdForAttempt: () => 'cs-1',
  tryBuildAttemptAuthorizationHeader: () => null,
}));

const runtimeSnapshot = {
  id: 'rt-1',
  scheduleId: 'sched-1',
  status: 'live',
  timingModel: 'ielts_shared_schedule_v1',
  serverNow: '2026-10-30T02:59:00Z',
  sections: [],
  ieltsSharedSchedule: null,
} as unknown as ExamSessionRuntime;

const attemptSnapshot = {
  id: 'att-1',
  scheduleId: 'sched-1',
  publishedVersionId: 'ver-1',
  submittedAt: null,
} as unknown as StudentAttempt;

const manifestA: IeltsOfflineManifest = testManifest({ contentDigest: 'digest-a' });
const manifestB: IeltsOfflineManifest = testManifest({ contentDigest: 'digest-b', leaseEpoch: 2 });

function packageRecord(manifest: IeltsOfflineManifest): IeltsOfflinePackage {
  const receivedWallMs = Date.parse(manifest.serverNow);
  return {
    schemaVersion: 1,
    key: ieltsOfflinePackageKey('user-1', manifest),
    status: 'ready',
    userId: 'user-1',
    scheduleId: manifest.scheduleId,
    candidateId: 'W001',
    manifest,
    staticPayload: {},
    liveSnapshot: null,
    shellBuildId: 'build-1',
    media: [],
    clock: { serverNowMs: receivedWallMs, receivedWallMs, lastEstimatedServerNowMs: receivedWallMs },
    preparedAt: null,
    blocked: false,
  };
}

let online = true;
function setOnline(value: boolean) {
  online = value;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

let metrics: Array<Record<string, unknown>> = [];
function onMetric(event: Event) {
  metrics.push((event as CustomEvent).detail as Record<string, unknown>);
}

function renderContinuity(
  manifest: IeltsOfflineManifest,
  overrides: { runtime?: ExamSessionRuntime; attempt?: StudentAttempt; staticPayload?: Record<string, unknown> | null } = {},
) {
  latestManifest.mockReturnValue(manifest);
  return renderHook(() =>
    useIeltsOfflineContinuity({
      runtimeSnapshot: overrides.runtime ?? runtimeSnapshot,
      attemptSnapshot: overrides.attempt ?? attemptSnapshot,
      staticPayload: overrides.staticPayload ?? { schedule: {}, version: {} },
      offlinePackage: null,
      userId: 'user-1',
      candidateId: 'W001',
    }),
  );
}

describe('useIeltsOfflineContinuity — silent download failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    prepare.mockReset();
    pinShell.mockReset().mockResolvedValue(undefined);
    refreshPackage.mockReset().mockResolvedValue(undefined);
    backendPost.mockReset().mockResolvedValue(undefined);
    latestManifest.mockReset();
    manifestBus.listeners.clear();
    metrics = [];
    window.addEventListener('student-observability-metric', onMetric);
    setOnline(true);
  });

  afterEach(() => {
    window.removeEventListener('student-observability-metric', onMetric);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a transient failure once and then prepares, with no visible change', async () => {
    prepare.mockResolvedValueOnce({ status: 'failed', reason: 'media_failed' });
    prepare.mockResolvedValueOnce({ status: 'prepared', record: packageRecord(manifestA) });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current.packageStatus).toMatchObject({
      state: 'deferred',
      reason: 'media_failed',
      attempts: 1,
    });
    expect(result.current.packageStatus).toMatchObject({ retryAt: expect.any(Number) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(result.current.packageStatus).toMatchObject({ state: 'prepared' });
    expect(pinShell).toHaveBeenCalledWith('build-1', 'att-1');
    const prepared = metrics.filter((metric) => metric['name'] === 'ielts_offline_preparation');
    expect(prepared.map((metric) => metric['attempt'])).toEqual([1, 2]);
    expect(prepared.at(-1)?.['reason']).toBe('prepared');
  });

  it('stops after four attempts and records one exhausted metric', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'media_failed' });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    for (const delay of [5_000, 20_000, 60_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(prepare).toHaveBeenCalledTimes(4);
    expect(result.current.packageStatus).toMatchObject({ state: 'deferred', attempts: 4, retryAt: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(4);
    expect(metrics.filter((metric) => metric['name'] === 'ielts_offline_preparation_exhausted')).toHaveLength(1);

    // FR-3: connectivity flapping must not reopen a spent budget.
    setOnline(false);
    await act(async () => {});
    setOnline(true);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(4);
  });

  it('never retries a deterministic failure', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'quota' });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current.packageStatus).toEqual({ state: 'deferred', reason: 'quota', attempts: 1, retryAt: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(metrics.filter((metric) => metric['name'] === 'ielts_offline_preparation_exhausted')).toHaveLength(0);

    // FR-3: a reconnect must not reopen a terminal verdict.
    setOnline(false);
    await act(async () => {});
    setOnline(true);
    await act(async () => {});
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('treats an unexpected exception as a silent terminal deferral', async () => {
    prepare.mockRejectedValue(new Error('boom'));
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current.packageStatus).toEqual({ state: 'deferred', reason: 'unexpected', attempts: 1, retryAt: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(metrics.some((metric) => metric['reason'] === 'unexpected')).toBe(true);
  });

  it('waits for connectivity instead of attempting while offline', async () => {
    setOnline(false);
    prepare.mockResolvedValue({ status: 'prepared', record: packageRecord(manifestA) });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).not.toHaveBeenCalled();
    expect(result.current.packageStatus).toEqual({ state: 'unavailable' });

    setOnline(true);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current.packageStatus).toMatchObject({ state: 'prepared' });
  });

  it('cancels a scheduled retry on unmount', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'media_failed' });
    const { unmount } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('resets the budget and cancels the old retry when the package identity changes', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'media_failed' });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0].manifest.contentDigest).toBe('digest-a');

    act(() => manifestBus.emit(manifestB));
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[0].manifest.contentDigest).toBe('digest-b');
    expect(result.current.packageStatus).toMatchObject({ state: 'deferred', attempts: 1 });

    // A fresh identity owns a fresh 5s backoff, not the old 20s/60s budget.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(metrics.filter((metric) => metric['name'] === 'ielts_offline_preparation').map((metric) => metric['attempt'])).toEqual([
      1, 1, 2,
    ]);
  });

  it('reopens a terminal verdict only when the package identity changes', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'audio_unavailable' });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current.packageStatus).toMatchObject({
      state: 'deferred',
      reason: 'audio_unavailable',
      attempts: 1,
      retryAt: null,
    });

    act(() => manifestBus.emit(manifestB));
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[0].manifest.contentDigest).toBe('digest-b');
    expect(result.current.packageStatus).toMatchObject({ state: 'deferred', attempts: 1 });
  });

  it.each([
    ['a submitted attempt', { attempt: { ...attemptSnapshot, submittedAt: '2026-10-30T04:00:00Z' } as unknown as StudentAttempt }],
    ['a completed room', { runtime: { ...runtimeSnapshot, status: 'completed' } as unknown as ExamSessionRuntime }],
    ['a cancelled room', { runtime: { ...runtimeSnapshot, status: 'cancelled' } as unknown as ExamSessionRuntime }],
  ])('never prepares after %s', async (_label, overrides) => {
    prepare.mockResolvedValue({ status: 'prepared', record: packageRecord(manifestA) });
    renderContinuity(manifestA, overrides);
    await act(async () => {});

    expect(prepare).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('does not spend the budget on an attempt aborted by going offline', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    prepare.mockResolvedValueOnce({ status: 'prepared', record: packageRecord(manifestA) });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});
    expect(prepare).toHaveBeenCalledTimes(1);

    setOnline(false);
    await act(async () => {});
    await act(async () => {
      resolveFirst?.({ status: 'failed', reason: 'media_failed' });
    });

    // The aborted attempt never reaches the student-visible state machine.
    expect(result.current.packageStatus).toEqual({ state: 'unavailable' });

    setOnline(true);
    await act(async () => {});

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(result.current.packageStatus).toMatchObject({ state: 'prepared' });
    const attempts = metrics
      .filter((metric) => metric['name'] === 'ielts_offline_preparation')
      .map((metric) => metric['attempt']);
    expect(attempts).toEqual([1]);
  });

  it('keeps the runtime projection independent of the download outcome', async () => {
    prepare.mockResolvedValue({ status: 'failed', reason: 'storage_failed' });
    const { result } = renderContinuity(manifestA);
    await act(async () => {});

    expect(result.current.runtimeSnapshot).toBe(runtimeSnapshot);
    expect(result.current.projection).toBeNull();
    expect(result.current.restoredOffline).toBe(false);
  });
});
