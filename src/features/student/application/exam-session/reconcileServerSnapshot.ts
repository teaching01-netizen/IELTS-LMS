import {
  compareFreshnessDimension,
  mergeLiveSnapshotFreshness,
  type LiveSnapshotFreshness,
} from '../../liveSnapshotFreshness';

export interface StudentServerSnapshot<TAttempt, TRuntime> {
  readonly attempt: TAttempt | null;
  readonly runtime: TRuntime | null;
  readonly freshness: LiveSnapshotFreshness;
}

export interface ServerSnapshotReconciliationResult<TAttempt, TRuntime> {
  readonly applied: boolean;
  readonly applyAttempt: boolean;
  readonly applyRuntime: boolean;
  readonly snapshot: StudentServerSnapshot<TAttempt, TRuntime>;
}

export function reconcileServerSnapshot<TAttempt, TRuntime>(input: {
  readonly previous: StudentServerSnapshot<TAttempt, TRuntime> | null;
  readonly incoming: StudentServerSnapshot<TAttempt, TRuntime>;
}): ServerSnapshotReconciliationResult<TAttempt, TRuntime> {
  if (!input.previous) {
    return {
      applied: true,
      applyAttempt: true,
      applyRuntime: true,
      snapshot: input.incoming,
    };
  }

  const attemptOrder = compareFreshnessDimension(
    input.incoming.freshness.attempt,
    input.previous.freshness.attempt,
  );
  const runtimeOrder = compareFreshnessDimension(
    input.incoming.freshness.runtime,
    input.previous.freshness.runtime,
  );
  const applyAttempt = attemptOrder >= 0;
  const applyRuntime = runtimeOrder >= 0;

  if (!applyAttempt && !applyRuntime) {
    return {
      applied: false,
      applyAttempt: false,
      applyRuntime: false,
      snapshot: input.previous,
    };
  }

  return {
    applied: true,
    applyAttempt,
    applyRuntime,
    snapshot: {
      attempt: applyAttempt ? input.incoming.attempt : input.previous.attempt,
      runtime: applyRuntime ? input.incoming.runtime : input.previous.runtime,
      freshness: mergeLiveSnapshotFreshness(input.previous.freshness, input.incoming.freshness, {
        applyAttempt,
        applyRuntime,
      }),
    },
  };
}
