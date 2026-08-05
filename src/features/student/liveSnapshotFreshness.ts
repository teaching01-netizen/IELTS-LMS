export type FreshnessDimension = {
  revision: number | null;
  updatedAtMs: number | null;
};

export type LiveSnapshotFreshness = {
  attempt: FreshnessDimension;
  runtime: FreshnessDimension;
};

export type LiveSnapshotFreshnessMergeMode = {
  applyAttempt: boolean;
  applyRuntime: boolean;
};

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}

function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// Returns -1 if incoming is older, 0 if equal/unknown, 1 if newer.
// Rule: revisioned snapshots always outrank revisionless snapshots.
export function compareFreshnessDimension(incoming: FreshnessDimension, applied: FreshnessDimension): number {
  const incomingRevision = incoming.revision;
  const appliedRevision = applied.revision;

  const incomingHasRevision = typeof incomingRevision === 'number' && Number.isFinite(incomingRevision);
  const appliedHasRevision = typeof appliedRevision === 'number' && Number.isFinite(appliedRevision);

  if (incomingHasRevision && appliedHasRevision) {
    if (incomingRevision > appliedRevision) return 1;
    if (incomingRevision < appliedRevision) return -1;
    return 0;
  }

  if (incomingHasRevision && !appliedHasRevision) return 1;
  if (!incomingHasRevision && appliedHasRevision) return -1;

  const incomingTs = incoming.updatedAtMs;
  const appliedTs = applied.updatedAtMs;
  const incomingHasTs = typeof incomingTs === 'number' && Number.isFinite(incomingTs);
  const appliedHasTs = typeof appliedTs === 'number' && Number.isFinite(appliedTs);

  if (incomingHasTs && appliedHasTs) {
    if (incomingTs > appliedTs) return 1;
    if (incomingTs < appliedTs) return -1;
  }

  return 0;
}

export function mergeLiveSnapshotFreshness(
  previous: LiveSnapshotFreshness | null,
  incoming: LiveSnapshotFreshness,
  mode: LiveSnapshotFreshnessMergeMode,
): LiveSnapshotFreshness {
  if (!previous) {
    return {
      attempt: mode.applyAttempt ? incoming.attempt : { revision: null, updatedAtMs: null },
      runtime: mode.applyRuntime ? incoming.runtime : { revision: null, updatedAtMs: null },
    };
  }

  return {
    attempt: mode.applyAttempt ? incoming.attempt : previous.attempt,
    runtime: mode.applyRuntime ? incoming.runtime : previous.runtime,
  };
}

export function extractLiveSnapshotFreshness(live: unknown): LiveSnapshotFreshness {
  const record = asRecord(live) ?? {};
  const attempt = asRecord(record['attempt']);
  const runtime = asRecord(record['runtime']);

  return {
    attempt: {
      revision: parseFiniteNumber(attempt?.['revision']),
      updatedAtMs: parseIsoTimestampMs(attempt?.['updatedAt']),
    },
    runtime: {
      revision: parseFiniteNumber(runtime?.['revision']),
      updatedAtMs: parseIsoTimestampMs(runtime?.['updatedAt']),
    },
  };
}

// Authoritative timer fields of an ExamSessionRuntime snapshot. Any change to one
// of these fields makes the runtime "newer" even when the revision is unchanged
// (e.g. equal-revision duplicate frames with drifted timer values). Sampling
// metadata (serverNow, updatedAt) is deliberately excluded: those values change
// on every poll response, so including them would make the equal-revision
// dedupe (isRuntimeValueUnchanged) inert for real poll responses and would
// churn state downstream with every refresh. Non-timer metadata (labels, plan
// durations, totalPausedSeconds, ...) is intentionally excluded: equal-revision
// churn on those fields must not restart the timer.
const RUNTIME_FINGERPRINT_FIELDS = [
  'revision',
  'status',
  'currentSectionKey',
  'currentSectionRemainingSeconds',
  'currentSectionDeadlineAt',
  'waitingForNextSection',
] as const;

const RUNTIME_FINGERPRINT_SECTION_FIELDS = [
  'sectionKey',
  'status',
  'pausedAt',
  'actualEndAt',
  'extensionMinutes',
  'accumulatedPausedSeconds',
  'actualStartAt',
  'availableAt',
] as const;

/**
 * Deterministic, value-level fingerprint of the authoritative timer fields of a
 * runtime snapshot. Object identity is ignored; only field values matter.
 * Non-record input (null, undefined, primitives) produces `''` so that two
 * non-record values are treated as unchanged while any record differs from a
 * non-record value.
 */
export function buildRuntimeFingerprint(runtime: unknown): string {
  const runtimeRecord = asRecord(runtime);
  if (!runtimeRecord) {
    return '';
  }

  const payload: Record<string, unknown> = {};
  for (const key of RUNTIME_FINGERPRINT_FIELDS) {
    payload[key] = runtimeRecord[key];
  }

  const sections = runtimeRecord['sections'];
  const sectionsPayload: unknown[] = Array.isArray(sections)
    ? sections.map((section) => {
        const sectionRecord = asRecord(section);
        if (!sectionRecord) {
          return null;
        }
        const sectionPayload: Record<string, unknown> = {};
        for (const key of RUNTIME_FINGERPRINT_SECTION_FIELDS) {
          sectionPayload[key] = sectionRecord[key];
        }
        return sectionPayload;
      })
    : [];

  // Sorted keys keep the serialization stable regardless of field insertion order.
  return JSON.stringify({
    runtime: Object.fromEntries(Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    sections: sectionsPayload,
  });
}

/**
 * Value-level equality check for runtime snapshots. Returns true only when both
 * inputs are non-null (and non-undefined) and their authoritative timer
 * fingerprints match. Two null/undefined snapshots are NOT considered
 * unchanged: a null incoming snapshot must never be treated as a no-op
 * duplicate of an applied snapshot.
 */
export function isRuntimeValueUnchanged(previous: unknown, incoming: unknown): boolean {
  if (previous === null || previous === undefined || incoming === null || incoming === undefined) {
    return false;
  }
  return buildRuntimeFingerprint(previous) === buildRuntimeFingerprint(incoming);
}

