/**
 * One finalization per authoritative revision.
 *
 * Two independent drivers ask for finalization: the module-submit commit path
 * (the student's own last submit) and the data-driven recovery effect (a poll
 * discovering the server already finalized the last module). Both must resolve
 * to exactly one completion call per revision — two calls burned two
 * idempotent-but-wasteful requests and reported whichever error landed last —
 * while a *failure* must stay re-attemptable.
 *
 * Those three rules live here so no driver has to re-implement them:
 *   claim   — a revision finalizes once; later drivers are suppressed
 *   release — the failing driver releases its claim so a retry (or a later
 *             revision) can finalize
 *   begin   — single-flight: concurrent callers share the in-flight operation
 *   reset   — identity rotation (new attempt) starts from a clean slate
 *
 * The revision key includes the attempt id, so a rotated identity can never
 * inherit the previous one's claim.
 */

import type { AssessmentDeliveryBootstrap } from "../contracts/assessmentDelivery";

export interface SatFinalizationGate<TResult> {
  /** Identity of the projection being finalized (attempt + version + modules). */
  revisionKey(attemptId: string, payload: AssessmentDeliveryBootstrap): string;
  /** True when this caller owns the revision and may finalize it. */
  claim(key: string): boolean;
  /** Releases the claim after a failure so retries are not suppressed. */
  release(key: string): void;
  /** Joins the in-flight finalization, or starts one when idle. */
  begin(run: () => Promise<TResult>): Promise<TResult>;
  /** Drops claim + in-flight state (identity rotation). */
  reset(): void;
}

export function createSatFinalizationGate<TResult>(): SatFinalizationGate<TResult> {
  let claimedKey: string | null = null;
  let inFlight: Promise<TResult> | null = null;

  return {
    revisionKey(attemptId, payload) {
      return `${attemptId}:${payload.versionId}:${payload.attempt.moduleAttempts
        .map(
          (moduleAttempt) =>
            `${moduleAttempt.id}:${moduleAttempt.state}:${moduleAttempt.revision}`,
        )
        .join(",")}`;
    },
    claim(key) {
      if (claimedKey === key) return false;
      claimedKey = key;
      return true;
    },
    release(key) {
      if (claimedKey === key) claimedKey = null;
    },
    begin(run) {
      if (inFlight) return inFlight;
      const operation = run();
      inFlight = operation;
      const clear = () => {
        if (inFlight === operation) inFlight = null;
      };
      void operation.then(clear, clear);
      return operation;
    },
    reset() {
      claimedKey = null;
      inFlight = null;
    },
  };
}
