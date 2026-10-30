import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { backendPost } from '../../api/studentAttemptGateway';
import { ApiError } from '../../../../shared/api-client/errors';
import { useIeltsCohortReadiness } from '../useIeltsCohortReadiness';

vi.mock('../../api/studentAttemptGateway', () => ({ backendPost: vi.fn(), tryBuildAttemptAuthorizationHeader: () => ({}) }));

let shell: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  shell = document.createElement('main');
  shell.className = 'student-exam-shell';
  shell.id = 'main-content';
  document.body.appendChild(shell);
});
afterEach(() => { shell.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const base = {
  scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser', sectionKey: 'writing',
  contentAvailable: true, pending: true, audioRequired: false, fastRetry: true,
};
const preparing = { startedAt: null, serverNow: '2026-10-30T09:00:00Z', remainingStudents: 0, status: 'preparing' as const };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test('healthy pending responses retry near 1s without exponential backoff', async () => {
  const post = vi.mocked(backendPost).mockResolvedValue(preparing);
  renderHook(() => useIeltsCohortReadiness({ ...base, storagePrepared: true, refreshRuntime: vi.fn() }));
  await tick(100);
  expect(post).toHaveBeenCalledTimes(1);
  for (let i = 2; i <= 6; i += 1) {
    await tick(1_050);
    expect(post).toHaveBeenCalledTimes(i);
  }
});

test('transport failures back off and a success resets the failure count', async () => {
  const post = vi.mocked(backendPost)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(preparing);
  renderHook(() => useIeltsCohortReadiness({ ...base, storagePrepared: true, refreshRuntime: vi.fn() }));
  await tick(100);
  expect(post).toHaveBeenCalledTimes(1);
  await tick(1_050);
  expect(post).toHaveBeenCalledTimes(2);
  await tick(1_050);
  expect(post).toHaveBeenCalledTimes(2); // second failure waits ~2s
  await tick(1_000);
  expect(post).toHaveBeenCalledTimes(3);
  await tick(1_050);
  expect(post).toHaveBeenCalledTimes(4); // healthy again: ~1s
});

test('sends nothing until the outgoing barrier settles, then starts immediately', async () => {
  const post = vi.mocked(backendPost).mockResolvedValue(preparing);
  const { result, rerender } = renderHook((props: { allowed: boolean }) =>
    useIeltsCohortReadiness({ ...base, activationAllowed: props.allowed, refreshRuntime: vi.fn() }),
  { initialProps: { allowed: false } });
  await tick(5_000);
  expect(post).not.toHaveBeenCalled();
  expect(result.current).toMatch(/Saving your answers/);
  rerender({ allowed: true });
  await tick(100);
  expect(post).toHaveBeenCalledTimes(1);
});

test('event storms keep one request in flight and one queued follow-up', async () => {
  let resolve: (value: typeof preparing) => void = () => {};
  const post = vi.mocked(backendPost).mockImplementation(() => new Promise((r) => { resolve = r; }));
  renderHook(() => useIeltsCohortReadiness({ ...base, storagePrepared: true, refreshRuntime: vi.fn() }));
  await tick(100);
  expect(post).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event('online'));
  await tick(100);
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(preparing); });
  await tick(50);
  expect(post).toHaveBeenCalledTimes(2);
  await act(async () => { resolve(preparing); });
  await tick(200);
  expect(post).toHaveBeenCalledTimes(2);
});

test('a terminal error stops the loop and a started section keeps confirming after a failed refresh', async () => {
  const post = vi.mocked(backendPost).mockRejectedValue(
    new ApiError({ code: 'NOT_FOUND', message: 'gone', status: 404 }),
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() =>
    useIeltsCohortReadiness({ ...base, storagePrepared: true, refreshRuntime: refresh }));
  await tick(100);
  await tick(20_000);
  expect(post).toHaveBeenCalledTimes(1);
  expect(result.current).toMatch(/^Could not start/);
  unmount();

  post.mockReset().mockResolvedValue({ ...preparing, status: 'active', startedAt: '2026-10-30T09:00:03Z' });
  const failingRefresh = vi.fn().mockRejectedValue(new Error('offline'));
  renderHook(() => useIeltsCohortReadiness({ ...base, storagePrepared: true, refreshRuntime: failingRefresh }));
  await tick(100);
  await tick(1_050);
  expect(post).toHaveBeenCalledTimes(2);
  expect(failingRefresh).toHaveBeenCalledTimes(2);
});
