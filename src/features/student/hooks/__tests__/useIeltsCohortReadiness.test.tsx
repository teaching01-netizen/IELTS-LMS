import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { backendPost } from '../../api/studentAttemptGateway';
import { useIeltsCohortReadiness } from '../useIeltsCohortReadiness';

vi.mock('../../api/studentAttemptGateway', () => ({ backendPost: vi.fn(), tryBuildAttemptAuthorizationHeader: () => ({}) }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

test('waits for painted content, measures latency, and waits for the whole cohort', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const post = vi.mocked(backendPost);
  const refresh = vi.fn().mockResolvedValue(undefined);
  post.mockResolvedValueOnce({ startedAt: null, remainingStudents: 2 })
    .mockResolvedValueOnce({ startedAt: null, remainingStudents: 1 })
    .mockResolvedValueOnce({ startedAt: '2026-10-18T03:00:00Z', remainingStudents: 0 });
  const shell = document.createElement('main');
  shell.className = 'student-exam-shell';
  shell.id = 'main-content';
  document.body.appendChild(shell);
  const { unmount } = renderHook(() => useIeltsCohortReadiness({
    scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser',
    sectionKey: 'writing', contentAvailable: true, pending: true, audioRequired: false, refreshRuntime: refresh,
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
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
  expect(refresh).toHaveBeenCalledTimes(1);
  unmount();
  shell.remove();
});

test('does not register readiness for an active section', () => {
  renderHook(() => useIeltsCohortReadiness({
    scheduleId: 'schedule', attemptId: 'attempt', clientSessionId: 'browser',
    sectionKey: 'reading', pending: false, refreshRuntime: vi.fn(),
  }));
  expect(backendPost).not.toHaveBeenCalled();
});
