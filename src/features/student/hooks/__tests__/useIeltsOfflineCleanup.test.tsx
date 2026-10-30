import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIeltsOfflineCleanup } from '../useIeltsOfflineCleanup';
import type { StudentAttempt } from '../../../../types/studentAttempt';

const cleanup = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../application/ieltsOfflineCleanup', () => ({
  cleanupIeltsOfflineArtifacts: cleanup,
}));

function attempt(overrides: Partial<StudentAttempt> = {}): StudentAttempt {
  return {
    id: 'att-1',
    submittedAt: '2026-10-30T04:00:00Z',
    ...overrides,
  } as StudentAttempt;
}

describe('useIeltsOfflineCleanup', () => {
  beforeEach(() => cleanup.mockClear());

  it('waits for a server receipt, drained pending writes and acknowledged evidence', () => {
    const { rerender } = renderHook(
      (props: { attempt: StudentAttempt; pending: number; evidence: number }) =>
        useIeltsOfflineCleanup({
          enabled: true,
          attempt: props.attempt,
          pendingMutationCount: props.pending,
          unacknowledgedEvidenceCount: props.evidence,
        }),
      { initialProps: { attempt: attempt({ submittedAt: undefined }), pending: 0, evidence: 0 } },
    );
    expect(cleanup).not.toHaveBeenCalled();

    rerender({ attempt: attempt(), pending: 1, evidence: 0 });
    expect(cleanup).not.toHaveBeenCalled();
    rerender({ attempt: attempt(), pending: 0, evidence: 2 });
    expect(cleanup).not.toHaveBeenCalled();

    rerender({ attempt: attempt(), pending: 0, evidence: 0 });
    expect(cleanup).toHaveBeenCalledWith('att-1');
    expect(cleanup).toHaveBeenCalledTimes(1);

    rerender({ attempt: attempt(), pending: 0, evidence: 0 });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside shared-timetable rooms', () => {
    renderHook(() =>
      useIeltsOfflineCleanup({
        enabled: false,
        attempt: attempt(),
        pendingMutationCount: 0,
        unacknowledgedEvidenceCount: 0,
      }),
    );
    expect(cleanup).not.toHaveBeenCalled();
  });
});
