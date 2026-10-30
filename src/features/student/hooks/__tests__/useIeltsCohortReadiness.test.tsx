import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { backendPost } from '../../api/studentAttemptGateway';
import { useIeltsCohortReadiness } from '../useIeltsCohortReadiness';
import { verifyAnswerStorage } from '../../application/ieltsSectionPreparation';

vi.mock('../../api/studentAttemptGateway', () => ({ backendPost: vi.fn(), tryBuildAttemptAuthorizationHeader: () => ({}) }));
vi.mock('../../application/ieltsSectionPreparation', () => ({ verifyAnswerStorage: vi.fn().mockResolvedValue(true) }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(verifyAnswerStorage).mockResolvedValue(true);
});

test('waits for painted content, measures latency, and accepts a shared start with a missing student', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const post = vi.mocked(backendPost);
  const refresh = vi.fn().mockResolvedValue(undefined);
  post.mockResolvedValueOnce({ startedAt: null, remainingStudents: 2 })
    .mockResolvedValueOnce({ startedAt: '2026-10-18T03:00:00Z', remainingStudents: 1 });
  const shell = document.createElement('main');
  shell.className = 'student-exam-shell';
  shell.id = 'main-content';
  document.body.appendChild(shell);
  const { unmount } = renderHook(() => useIeltsCohortReadiness({
    scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser',
    sectionKey: 'writing', contentAvailable: true, pending: true, audioRequired: false, sharedClock: true, refreshRuntime: refresh,
  }));
  expect(post).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]?.[1]).toMatchObject({ attemptId: 'attempt', clientSessionId: 'browser' });
  expect(post.mock.calls[0]?.[1]).toMatchObject({ contentReady: true, localStorageReady: true, audioReady: true });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1]?.[1]).toHaveProperty('roundTripMs');
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(post).toHaveBeenCalledTimes(2);
  unmount();
  shell.remove();
});

test('does not register readiness for an active section', () => {
  renderHook(() => useIeltsCohortReadiness({
    scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser',
    sectionKey: 'reading', contentAvailable: true, pending: false, refreshRuntime: vi.fn(),
  }));
  expect(backendPost).not.toHaveBeenCalled();
});

test.each(['content', 'storage', 'audio', 'connection'] as const)(
  'shared-clock %s failure does not promise the timer has stopped', async (failure) => {
    vi.useFakeTimers();
    const post = vi.mocked(backendPost);
    if (failure === 'connection') post.mockRejectedValue(new Error('offline'));
    else post.mockResolvedValue({ startedAt: null, remainingStudents: 1 });
    vi.mocked(verifyAnswerStorage).mockResolvedValue(failure !== 'storage');
    const shell = document.createElement('main');
    shell.className = 'student-exam-shell';
    shell.id = 'main-content';
    document.body.appendChild(shell);
    const { result, unmount } = renderHook(() => useIeltsCohortReadiness({
      scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser',
      sectionKey: failure === 'audio' ? 'listening' : 'reading',
      contentAvailable: failure !== 'content', pending: true, sharedClock: true,
      refreshRuntime: vi.fn(),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current).toContain('shared room timer may continue');
    expect(result.current).not.toMatch(/time has not started|section will not start/);
    unmount();
    shell.remove();
  },
);
