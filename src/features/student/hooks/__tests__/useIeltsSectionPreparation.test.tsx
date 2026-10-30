import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import * as preparation from '../../application/ieltsSectionPreparation';
import { backendPost } from '../../api/studentAttemptGateway';
import { useIeltsSectionPreparation } from '../useIeltsSectionPreparation';

vi.mock('../../api/studentAttemptGateway', () => ({ backendPost: vi.fn(), tryBuildAttemptAuthorizationHeader: () => ({}) }));
afterEach(() => { vi.restoreAllMocks(); });

test('prepares once per context without requesting activation', async () => {
  const probe = vi.spyOn(preparation, 'verifyAnswerStorage').mockResolvedValue(true);
  const { result, rerender } = renderHook((props: { contextKey: string }) => useIeltsSectionPreparation({
    enabled: true, contextKey: props.contextKey, attemptId: 'attempt', contentAvailable: true,
  }), { initialProps: { contextKey: 'attempt:v1:writing:1' } });
  await waitFor(() => expect(result.current).toBe('ready'));
  rerender({ contextKey: 'attempt:v1:writing:1' });
  expect(probe).toHaveBeenCalledTimes(1);
  rerender({ contextKey: 'attempt:v1:writing:2' });
  expect(result.current).toBe('pending');
  await waitFor(() => expect(result.current).toBe('ready'));
  expect(probe).toHaveBeenCalledTimes(2);
  expect(backendPost).not.toHaveBeenCalled();
});

test('missing content or failed storage reports failure; disabled stays idle', async () => {
  vi.spyOn(preparation, 'verifyAnswerStorage').mockResolvedValue(false);
  const missing = renderHook(() => useIeltsSectionPreparation({
    enabled: true, contextKey: 'a', attemptId: 'attempt', contentAvailable: false,
  }));
  await waitFor(() => expect(missing.result.current).toBe('failed'));
  const storage = renderHook(() => useIeltsSectionPreparation({
    enabled: true, contextKey: 'b', attemptId: 'attempt', contentAvailable: true,
  }));
  await waitFor(() => expect(storage.result.current).toBe('failed'));
  const idle = renderHook(() => useIeltsSectionPreparation({
    enabled: false, contextKey: 'c', attemptId: 'attempt', contentAvailable: true,
  }));
  expect(idle.result.current).toBe('idle');
});
