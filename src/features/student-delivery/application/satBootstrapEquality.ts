import type { AssessmentDeliveryBootstrap } from "../contracts/assessmentDelivery";

/**
 * Phase 04 (runner convergence) — pure poll-equality predicate.
 *
 * Decides whether an incoming bootstrap carries no new information versus
 * the committed one. Clock-only movement must not defeat the skip:
 * serverNow advances every poll, so sub-tolerance drift is ignored.
 *
 * Pure: no clock reads, no Date.now(), no store access. Sections / modules /
 * questions are version-immutable per versionId and excluded (besides
 * versionId) to keep the check O(attempts + responses).
 *
 * Order-sensitive comparison is intentional: the backend preserves
 * attempt/response order, so a reorder is treated as a change (safe
 * direction). Response bodies are compared by revision only — bodies hydrate
 * via revision-guarded hydrateResponse, so a body-only change with a bumped
 * revision is correctly treated as changed.
 */
export const SERVER_NOW_SKIP_TOLERANCE_MS = 1000;

export function isEquivalentBootstrap(
  prev: AssessmentDeliveryBootstrap | null,
  next: AssessmentDeliveryBootstrap,
): boolean {
  if (!prev) return false;
  if (prev.timing.runtimeRevision !== next.timing.runtimeRevision) return false;
  if (prev.versionId !== next.versionId) return false;
  const prevNow = Date.parse(prev.serverNow);
  const nextNow = Date.parse(next.serverNow);
  if (Number.isFinite(prevNow) && Number.isFinite(nextNow)) {
    if (Math.abs(nextNow - prevNow) > SERVER_NOW_SKIP_TOLERANCE_MS) return false;
  } else if (prev.serverNow !== next.serverNow) {
    return false;
  }
  if (
    prev.proctorStatus !== next.proctorStatus ||
    prev.proctorNote !== next.proctorNote ||
    prev.scheduleRuntimeStatus !== next.scheduleRuntimeStatus ||
    prev.deviceFingerprintHash !== next.deviceFingerprintHash ||
    (prev.result == null ? null : prev.result.id) !==
      (next.result == null ? null : next.result.id)
  ) {
    return false;
  }
  if (prev.attempt.id !== next.attempt.id) return false;
  if (!sameAttempts(prev, next) || !sameBreaks(prev, next) || !sameResponseRevisions(prev, next)) return false;
  return true;
}

/**
 * The terminal-lifecycle states a module attempt or break may never leave.
 * Both are server-written and monotonic; a payload that shows one of them
 * moving backwards is stale, whatever its runtime revision says.
 */
function isFinalAttemptState(state: string): boolean {
  return state === "submitted" || state === "locked";
}

/**
 * Stale-payload guard for attempt-scoped state.
 *
 * `timing.runtimeRevision` is a SCHEDULE-wide revision: it moves when the
 * cohort clock advances, not when one candidate's module attempt changes. In
 * personal timing the Module 1 -> Module 2 handoff changes module-attempt and
 * break rows without touching it, so two payloads can carry the SAME runtime
 * revision and be applied in either order — an older one wins last, and the
 * runner shows a module the candidate already left.
 *
 * Per-row `revision` is monotonic (every statement that mutates
 * assessment_module_attempts / assessment_attempt_breaks bumps it) and rows are
 * never deleted, so ordering by row revision resolves what the schedule-wide
 * revision cannot. This is a pure predicate: no clock reads, no store access.
 *
 * Returns true when `next` is OLDER than `prev` and must be dropped.
 */
export function regressesAttemptState(
  prev: AssessmentDeliveryBootstrap,
  next: AssessmentDeliveryBootstrap,
): boolean {
  // A different attempt is not a regression; the identity guard owns that.
  if (prev.attempt.id !== next.attempt.id) return false;
  const nextModules = new Map(
    next.attempt.moduleAttempts.map((module) => [module.id, module]),
  );
  for (const previous of prev.attempt.moduleAttempts) {
    const incoming = nextModules.get(previous.id);
    // A dropped row is older state (rows are never deleted server-side).
    if (!incoming) return true;
    if (incoming.revision < previous.revision) return true;
    // A finalized module never reopens: a payload that shows one active again
    // is a stale read from before the finalization.
    if (isFinalAttemptState(previous.state) && !isFinalAttemptState(incoming.state)) {
      return true;
    }
  }
  const nextBreaks = new Map(
    (next.attempt.personalBreaks ?? []).map((personalBreak) => [personalBreak.id, personalBreak]),
  );
  for (const previous of prev.attempt.personalBreaks ?? []) {
    const incoming = nextBreaks.get(previous.id);
    if (!incoming) return true;
    if (incoming.revision < previous.revision) return true;
  }
  // A persisted result never disappears once the payload carried one.
  return prev.result != null && next.result == null;
}

function sameAttempts(
  prev: AssessmentDeliveryBootstrap,
  next: AssessmentDeliveryBootstrap,
): boolean {
  const a = prev.attempt.moduleAttempts;
  const b = next.attempt.moduleAttempts;
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i];
    if (n === undefined) return false;
    return (
      m.id === n.id &&
      m.moduleId === n.moduleId &&
      m.state === n.state &&
      m.revision === n.revision &&
      m.startedAt === n.startedAt &&
      m.pausedAt === n.pausedAt &&
      m.remainingSeconds === n.remainingSeconds &&
      m.deadlineAt === n.deadlineAt &&
      m.availableAt === n.availableAt &&
      m.completionReason === n.completionReason
    );
  });
}

function sameBreaks(
  prev: AssessmentDeliveryBootstrap,
  next: AssessmentDeliveryBootstrap,
): boolean {
  const a = prev.attempt.personalBreaks ?? [];
  const b = next.attempt.personalBreaks ?? [];
  return a.length === b.length && a.every((item, i) =>
    item.id === b[i]?.id && item.state === b[i]?.state && item.revision === b[i]?.revision
  );
}

function sameResponseRevisions(
  prev: AssessmentDeliveryBootstrap,
  next: AssessmentDeliveryBootstrap,
): boolean {
  const a = prev.attempt.responses;
  const b = next.attempt.responses;
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const other = b[i];
    if (other === undefined) return false;
    return r.examQuestionId === other.examQuestionId && r.revision === other.revision;
  });
}
