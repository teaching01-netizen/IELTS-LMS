import type { ExamSessionRuntime, ProctorPresence } from "../../../types/domain";

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
