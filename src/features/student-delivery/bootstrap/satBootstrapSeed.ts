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
      when nothing moved (dedupe fast-path is ETag/304, NOT byte reuse). */
  readonly attemptRevision: number | null;
  readonly runtimeRevision: number | null;
  /** Cached delivery ETag for If-None-Match, when the session cache already holds one.
      Null = first fetch (full bytes). */
  readonly deliveryEtag: string | null;
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
  deliveryEtag: string | null;
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
    deliveryEtag: input.deliveryEtag,
    seedGeneration: input.seedGeneration,
  };
}

/** Read the cached delivery ETag for If-None-Match without importing gateway
 * internals into the student feature. Returns null on first fetch, missing or
 * corrupt storage (fail-open to a full fetch — never a bad exam).
 * Key must match bootstrapEtag.ts storageKey: sat-bootstrap-etag:scheduleId:attemptId. */
export function getCachedDeliveryEtag(
  scheduleId: string,
  attemptId: string,
): string | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(
      `sat-bootstrap-etag:${scheduleId}:${attemptId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { etag?: unknown } | null;
    return typeof parsed?.etag === "string" ? parsed.etag : null;
  } catch {
    return null;
  }
}
