import { describe, expect, it } from 'vitest';
import { reconcileServerSnapshot, type StudentServerSnapshot } from '../reconcileServerSnapshot';

function snapshot(attemptRevision: number, runtimeRevision: number): StudentServerSnapshot<string, string> {
  return {
    attempt: `attempt-${attemptRevision}`,
    runtime: `runtime-${runtimeRevision}`,
    freshness: {
      attempt: { revision: attemptRevision, updatedAtMs: null },
      runtime: { revision: runtimeRevision, updatedAtMs: null },
    },
  };
}

describe('server snapshot reconciliation', () => {
  it('keeps the local attempt when only the incoming runtime is stale', () => {
    const previous = snapshot(12, 42);
    const incoming = snapshot(13, 41);

    const result = reconcileServerSnapshot({ previous, incoming });

    expect(result.applied).toBe(true);
    expect(result.applyAttempt).toBe(true);
    expect(result.applyRuntime).toBe(false);
    expect(result.snapshot).toEqual({
      attempt: 'attempt-13',
      runtime: 'runtime-42',
      freshness: {
        attempt: { revision: 13, updatedAtMs: null },
        runtime: { revision: 42, updatedAtMs: null },
      },
    });
  });

  it('discards a snapshot older in both dimensions', () => {
    const previous = snapshot(12, 42);
    const incoming = snapshot(11, 41);

    const result = reconcileServerSnapshot({ previous, incoming });

    expect(result.applied).toBe(false);
    expect(result.snapshot).toBe(previous);
  });
});
