// Frontend-only handoff: parent static+live snapshot -> child delivery bootstrap.
// NEVER carries exam content; delivery content still comes ONLY from
// assessmentDeliveryApi.bootstrap (different endpoint/payload family).
import type { ExamSessionRuntime } from "../../../types/domain";
import type { StudentAttempt } from "../../../types/studentAttempt";

export interface SatBootstrapSeed {
  readonly scheduleId: string;
  readonly attemptId: string;
  readonly candidateId: string;
  /** Identity snapshot the parent reconciled (durability owner). Null only when the parent
      mounted the child early while live was still pending — child still bootstraps. */
  readonly attemptSnapshot: StudentAttempt | null;
  readonly runtimeSnapshot: ExamSessionRuntime | null;
  /** Wall-clock ms when the parent applied the live snapshot (staleness display only). */
  readonly liveSnapshotReceivedAt: number | null;
  /** Parent static version id (staticVersionIdRef) — lets the child detect a republish
      without refetching static itself. */
  readonly staticVersionId: string | null;
  /** Attempt/runtime revisions at seed time — lets the child skip a redundant bootstrap
      when nothing moved. The fast path is the client-side equivalent-payload check;
      it is never a conditional HTTP read, because a validator built from the static
      exam version cannot speak for live attempt state. */
  readonly attemptRevision: number | null;
  readonly runtimeRevision: number | null;
  /** Parent load epoch at seed time; child echoes it for observability correlation only. */
  readonly seedGeneration: number;
}

export function seedMatchesIdentity(
  seed: SatBootstrapSeed | null | undefined,
  input: { scheduleId: string; attemptId: string; candidateId: string },
): boolean {
  if (!seed) return false;
  return (
    seed.scheduleId === input.scheduleId &&
    seed.attemptId === input.attemptId &&
    seed.candidateId === input.candidateId
  );
}

export function buildSatBootstrapSeed(input: {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
  attemptSnapshot: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
  liveSnapshotReceivedAt: number | null;
  staticVersionId: string | null;
  seedGeneration: number;
}): SatBootstrapSeed {
  return {
    scheduleId: input.scheduleId,
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    attemptSnapshot: input.attemptSnapshot,
    runtimeSnapshot: input.runtimeSnapshot,
    liveSnapshotReceivedAt: input.liveSnapshotReceivedAt,
    staticVersionId: input.staticVersionId,
    attemptRevision: input.attemptSnapshot?.revision ?? null,
    runtimeRevision: input.runtimeSnapshot?.revision ?? null,
    seedGeneration: input.seedGeneration,
  };
}
