import type { ExamSessionRuntime, ProctorPresence } from "../../../types/domain";
import type { StudentSession } from "../../../types";

/**
 * Merge one runtime projection at the proctor boundary.
 *
 * Summary and WebSocket projections deliberately omit the authored plan, while
 * detail projections carry it. Runtime revisions decide which live clock wins;
 * the plan and presence are static/enrichment fields and must survive a newer
 * projection that does not carry them.
 *
 * Revision alone cannot decide a same-revision read: a live section sits on one
 * revision for as long as it runs, so "revision did not change" means "this is
 * another read of the same state", not "this read is stale". Gating the whole
 * object on a strictly greater revision froze the room's clock — `serverNow`,
 * `currentSectionDeadlineAt` and the section rows — at the first payload of the
 * revision, while the per-student rows (rebuilt on every poll) kept advancing,
 * so the header and the roster showed different times for the same clock. Equal
 * revisions are therefore resolved by the read's own stamp (`serverNow`, then
 * `updatedAt`): a newer read wins, an older one still loses, and a tie keeps
 * what is already held.
 */
export function mergeProctorRuntime(
  existing: ExamSessionRuntime | undefined,
  incoming: ExamSessionRuntime,
  additionalPresence: ProctorPresence[] = [],
): ExamSessionRuntime {
  if (!existing) {
    return {
      ...incoming,
      proctorPresence: mergePresence(incoming.proctorPresence, additionalPresence),
    };
  }

  const existingRevision = existing.revision ?? -1;
  const incomingRevision = incoming.revision ?? -1;
  const incomingIsNewer = incomingRevision > existingRevision;
  const current = runtimeProjectionSupersedes(existing, incoming) ? incoming : existing;

  return {
    ...current,
    // The authored plan is detail-only. A summary/WS projection must not erase
    // the plan that was already loaded for the same schedule.
    examPlan: firstNonEmptyPlan(current.examPlan, incoming.examPlan, existing.examPlan),
    // A partial summary/WS projection may omit the optional boundary. Omission
    // means "no new information"; an explicit null is the authoritative
    // clear once the incoming projection is newer. Same-revision detail reads
    // may enrich an omitted value without regressing the live clock.
    nextSectionStartAt: mergeOptionalBoundary(
      existing.nextSectionStartAt,
      incoming.nextSectionStartAt,
      incomingIsNewer,
    ),
    proctorPresence: mergePresence(
      existing.proctorPresence,
      incoming.proctorPresence,
      additionalPresence,
    ),
  };
}

/**
 * Whether an incoming projection owns the live clock: the newer revision, or —
 * at the same revision — the newer read. `serverNow` is the instant the read was
 * stamped, so it orders two reads of one revision; `updatedAt` is the fallback
 * for a projection that omits it. A tie, or an incoming read with no stamp at
 * all, keeps the projection already held rather than trading one unknown for
 * another.
 *
 * Exported because every ingest path needs the same answer: a WebSocket frame is
 * a read of the same revision too, and gating it on the revision alone dropped
 * the fresher clock while letting the frozen one stand.
 */
export function runtimeProjectionSupersedes(
  existing: ExamSessionRuntime,
  incoming: ExamSessionRuntime,
): boolean {
  const existingRevision = existing.revision ?? -1;
  const incomingRevision = incoming.revision ?? -1;
  if (incomingRevision > existingRevision) return true;
  if (incomingRevision < existingRevision) return false;

  const incomingStamp = readProjectionStamp(incoming);
  if (incomingStamp === null) return false;
  const existingStamp = readProjectionStamp(existing);
  if (existingStamp === null) return true;
  return incomingStamp > existingStamp;
}

/**
 * Which of two roster projections of one candidate owns the adaptive exam state.
 *
 * `lastActivity` is the student's presence heartbeat: it answers "when did we
 * last hear from this candidate?" and must never answer "which SAT adaptive
 * module is authoritative?". Both facts ride the same roster row, and two
 * responses stamped with the same heartbeat can describe different modules
 * (Module 1 vs Module 2 Higher), so ordering by heartbeat let an older
 * projection replace a newer routing decision. Order instead:
 *
 *   1. attempt revision (`attemptRevision`) — the server's monotonic attempt
 *      revision: newer wins, older can never overwrite;
 *   2. the active module attempt (`runtimeModuleAttemptRevision`): the module a
 *      candidate is sitting has its own revision, and a higher one is a later
 *      module in the same attempt;
 *   3. a different module attempt id: a genuinely different module, ordered by
 *      the server's read stamp (`runtimeServerNow`);
 *   4. same identity: the newer read wins by that stamp;
 *   5. everything tied: keep what is already held.
 *
 * A missing revision never regresses a known one: unknown is not newer.
 */
export function sessionProjectionSupersedes(
  existing: StudentSession,
  incoming: StudentSession,
): boolean {
  // Equal revisions fall THROUGH to the next fence: "same attempt revision"
  // usually means the same attempt mid-advance (Module 1 -> Module 2), not a
  // dead heat — the module attempt decides that step.
  const attemptOrder = compareOptionalRevision(
    existing.attemptRevision,
    incoming.attemptRevision,
  );
  if (attemptOrder !== null && attemptOrder !== 0) return attemptOrder > 0;

  const moduleAttemptOrder = compareOptionalRevision(
    existing.runtimeModuleAttemptRevision,
    incoming.runtimeModuleAttemptRevision,
  );
  if (moduleAttemptOrder !== null && moduleAttemptOrder !== 0) return moduleAttemptOrder > 0;

  const stampOrder = compareProjectionStamp(existing, incoming);
  const existingModuleAttempt = existing.runtimeModuleAttemptId ?? null;
  const incomingModuleAttempt = incoming.runtimeModuleAttemptId ?? null;
  if (existingModuleAttempt !== incomingModuleAttempt) {
    // A different module attempt is a different module even at equal
    // revisions; the read stamp decides which description is newer. With no
    // stamp at all the incoming row is the only new information, so it is
    // still the projection that describes the module the server opened.
    return stampOrder === 0 ? incomingModuleAttempt !== null : stampOrder > 0;
  }
  return stampOrder > 0;
}

/**
 * Merge one roster projection into the held one. The runtime identity fields
 * follow `sessionProjectionSupersedes`; presence (`lastActivity`) is monotonic
 * and independent of exam state, so the newest heartbeat seen is kept either
 * way — an older exam-state projection must not roll "last seen" backwards.
 */
export function mergeSessionProjection(
  existing: StudentSession,
  incoming: StudentSession,
): StudentSession {
  const winner = sessionProjectionSupersedes(existing, incoming) ? incoming : existing;
  const loser = winner === incoming ? existing : incoming;
  const lastActivity = newestInstant(loser.lastActivity, winner.lastActivity) ?? winner.lastActivity;
  return lastActivity === winner.lastActivity ? winner : { ...winner, lastActivity };
}

function compareOptionalRevision(
  existing: number | null | undefined,
  incoming: number | null | undefined,
): number | null {
  const a = typeof existing === "number" && Number.isFinite(existing) ? existing : null;
  const b = typeof incoming === "number" && Number.isFinite(incoming) ? incoming : null;
  if (a === null && b === null) return null;
  if (a === null) return 1; // incoming is the first revision we know: it wins
  if (b === null) return -1; // unknown incoming must not overwrite a known revision
  return a === b ? 0 : b > a ? 1 : -1;
}

/** The server's read stamp for a roster projection (`runtimeServerNow`). */
function projectionStamp(session: StudentSession): number | null {
  const parsed = session.runtimeServerNow ? Date.parse(session.runtimeServerNow) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function compareProjectionStamp(existing: StudentSession, incoming: StudentSession): number {
  const a = projectionStamp(existing);
  const b = projectionStamp(incoming);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a === b ? 0 : b > a ? 1 : -1;
}

function newestInstant(...candidates: string[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed) || parsed <= bestMs) continue;
    best = candidate;
    bestMs = parsed;
  }
  return best;
}

function readProjectionStamp(runtime: ExamSessionRuntime): number | null {
  const serverNowMs = runtime.serverNow ? Date.parse(runtime.serverNow) : Number.NaN;
  if (Number.isFinite(serverNowMs)) return serverNowMs;
  const updatedAtMs = runtime.updatedAt ? Date.parse(runtime.updatedAt) : Number.NaN;
  return Number.isFinite(updatedAtMs) ? updatedAtMs : null;
}

function mergeOptionalBoundary(
  existing: ExamSessionRuntime["nextSectionStartAt"],
  incoming: ExamSessionRuntime["nextSectionStartAt"],
  incomingIsNewer: boolean,
): ExamSessionRuntime["nextSectionStartAt"] {
  if (incomingIsNewer) return incoming === undefined ? existing : incoming;
  return existing === undefined ? incoming : existing;
}

function firstNonEmptyPlan(
  ...plans: Array<ExamSessionRuntime["examPlan"]>
): ExamSessionRuntime["examPlan"] {
  return plans.find((plan) => Array.isArray(plan) && plan.length > 0) ?? null;
}

function mergePresence(
  ...lists: Array<ProctorPresence[] | undefined>
): ProctorPresence[] {
  const byProctor = new Map<string, ProctorPresence>();
  for (const entry of lists.flatMap((list) => list ?? [])) {
    byProctor.set(entry.proctorId, entry);
  }
  return [...byProctor.values()];
}
