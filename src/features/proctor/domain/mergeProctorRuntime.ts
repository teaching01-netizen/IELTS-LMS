import type { ExamSessionRuntime, ProctorPresence } from "../../../types/domain";

/**
 * Merge one runtime projection at the proctor boundary.
 *
 * Summary and WebSocket projections deliberately omit the authored plan, while
 * detail projections carry it. Runtime revisions decide which live clock wins;
 * the plan and presence are static/enrichment fields and must survive a newer
 * projection that does not carry them.
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
  const current = incomingRevision > existingRevision ? incoming : existing;

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
