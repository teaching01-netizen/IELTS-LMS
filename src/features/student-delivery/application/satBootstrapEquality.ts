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
  if (!sameAttempts(prev, next) || !sameResponseRevisions(prev, next)) return false;
  return true;
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
