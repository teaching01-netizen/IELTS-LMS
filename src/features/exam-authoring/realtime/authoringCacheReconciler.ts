import type {
  AuthoringEventV1,
  AuthoringRemoteStructuralKind,
  ReconcilerContext,
} from "./contracts";

/**
 * The ONLY place that maps an authoring event kind onto cache work.
 *
 * Rule of thumb: React Query stays authoritative. Small events trigger a
 * targeted invalidation; structural / bulk / lifecycle events invalidate the
 * shell (+ readiness/release) and refetch over HTTP. The frozen envelope
 * carries no preview/content fields, so there is deliberately no "patch the
 * summary row" path: content always arrives via an HTTP refetch.
 */

export type ReconcileOutcome =
  | { outcome: "invalidated"; refetch: "active" | "none" }
  /** Nothing at all was written (dirty question.changed). */
  | { outcome: "deferred-dirty"; examQuestionId: string }
  /**
   * A remote STRUCTURAL op (delete / move / bulk change) touched a locally
   * dirty question. The structural shell is refetched (order and membership
   * are server-owned) but the question's clean cache and the local draft are
   * both preserved, and divergence is recorded for Phase 05.
   */
  | {
      outcome: "deferred-dirty-structural";
      examQuestionId: string;
      kind: AuthoringRemoteStructuralKind;
    }
  | { outcome: "lifecycle"; signal: "draft-replaced" | "published" | "exam-changed" }
  | { outcome: "ignored"; reason: string };

/** The exam-question id an event targets, when it targets exactly one. */
export function questionTargetOf(event: AuthoringEventV1): string | null {
  if (event.entity.kind === "question" && event.entity.examQuestionId.trim()) {
    return event.entity.examQuestionId;
  }
  return null;
}

/**
 * Every question this event may have touched, de-duplicated: the single
 * entity target (when it is a question) plus the coarse affected-id list.
 */
export function affectedQuestionIdsOf(event: AuthoringEventV1): string[] {
  const ids = new Set<string>();
  const single = questionTargetOf(event);
  if (single) {
    ids.add(single);
  }
  for (const id of event.affectedExamQuestionIds ?? []) {
    if (id.trim()) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Record divergence for every affected question that has an unsaved local
 * draft. Never writes a cache entry: the caller owns the structural refetch.
 */
function noteDirtyDivergence(
  ctx: ReconcilerContext,
  event: AuthoringEventV1,
  kind: AuthoringRemoteStructuralKind,
): string[] {
  const dirty: string[] = [];
  for (const id of affectedQuestionIdsOf(event)) {
    if (ctx.isQuestionDirty(id)) {
      // `actor.id` only — the envelope never carries a display name.
      ctx.noteRemoteStructuralChange(id, kind, event.actor?.id);
      dirty.push(id);
    }
  }
  return dirty;
}

/**
 * `question.changed` on a single question. Extracted as a NAMED reconciler
 * rather than left as an anonymous branch: the phase's regression check asserts
 * these three names exist, and a name is what a future reader can go to.
 */
export function reconcileQuestionChanged(
  ctx: ReconcilerContext,
  event: AuthoringEventV1,
): ReconcileOutcome {
  const examQuestionId = questionTargetOf(event);
  if (!examQuestionId) {
    return { outcome: "ignored", reason: "missing-target" };
  }
  // Dirty editors WIN locally: never write over an unsaved draft. Record the
  // remote revision for Phase 05 divergence UI and do nothing else.
  if (ctx.isQuestionDirty(examQuestionId)) {
    ctx.noteRemoteRevision(examQuestionId, event.revision, event.actor?.id);
    return { outcome: "deferred-dirty", examQuestionId };
  }
  ctx.invalidateQuestion(examQuestionId, "active");
  // Passive shell touch: the summary row may have changed, but refetching
  // the whole shell on every keystroke-adjacent event causes list flicker.
  ctx.invalidateShell("none");
  return { outcome: "invalidated", refetch: "active" };
}

/**
 * `question.deleted`. See the structural notes inline: the deletion is recorded
 * whatever the local state, and a dirty draft is never destroyed.
 */
export function reconcileQuestionDeleted(
  ctx: ReconcilerContext,
  event: AuthoringEventV1,
): ReconcileOutcome {
  const examQuestionId = questionTargetOf(event);
  // The deletion is recorded WHATEVER the local state. It is the reason the
  // row is about to vanish, and a clean author deserves to be told that a
  // collaborator removed the question they were reading instead of being
  // dropped into a generic load error for someone else's action. Nobody
  // gets teleported: the selection is not moved, and `Go to next` (if the
  // author wants it) is an explicit choice.
  if (examQuestionId) {
    ctx.noteRemoteStructuralChange(examQuestionId, "deleted", event.actor?.id);
  }
  if (examQuestionId && ctx.isQuestionDirty(examQuestionId)) {
    // Structural truth moves (the shell drops the row) but the unsaved
    // draft is never destroyed: the user keeps editing, Phase 05 raises
    // the conflict. Dropping the query cache here would silently discard
    // the only clean baseline the draft can be diffed against.
    ctx.invalidateShell("active");
    ctx.invalidateReadinessAndRelease();
    return { outcome: "deferred-dirty-structural", examQuestionId, kind: "deleted" };
  }
  if (examQuestionId) {
    ctx.removeQuestionCache(examQuestionId);
  }
  ctx.invalidateShell("active");
  ctx.invalidateReadinessAndRelease();
  return { outcome: "invalidated", refetch: "active" };
}

/**
 * `draft.replaced` / `exam.published`: the working draft this socket is bound
 * to has ended. No content is touched — the caller refetches the shell and
 * decides whether a new draft exists or the author stays read-only.
 */
export function handleDraftPublished(
  ctx: ReconcilerContext,
  event: AuthoringEventV1,
): ReconcileOutcome {
  ctx.invalidateShell("none");
  return {
    outcome: "lifecycle",
    signal: event.kind === "draft.replaced" ? "draft-replaced" : "published",
  };
}

export function reconcileAuthoringEvent(
  ctx: ReconcilerContext,
  event: AuthoringEventV1,
): ReconcileOutcome {
  switch (event.kind) {
    case "question.changed":
      return reconcileQuestionChanged(ctx, event);

    case "question.created":
    case "question.duplicated":
      // A new id is unknown to the cache: never synthesize a summary row from
      // the event; refetch the authoritative shell + readiness/release.
      ctx.invalidateShell("active");
      ctx.invalidateReadinessAndRelease();
      return { outcome: "invalidated", refetch: "active" };

    case "question.deleted":
      return reconcileQuestionDeleted(ctx, event);

    case "question.moved": {
      // Authoritative order always comes from the HTTP refetch, never from
      // client-side reorder math against an event. A dirty question's draft is
      // untouched (no question cache is written) but the divergence is noted.
      ctx.invalidateShell("active");
      const dirty = noteDirtyDivergence(ctx, event, "moved");
      if (dirty.length === 1) {
        return { outcome: "deferred-dirty-structural", examQuestionId: dirty[0]!, kind: "moved" };
      }
      return { outcome: "invalidated", refetch: "active" };
    }

    case "question.bulk_changed": {
      // Covers import-100 / bulk actions / batch create / reorder-many /
      // workbook commit + undo. ALWAYS invalidate + refetch: bounded work
      // regardless of N, never a per-id patch fan-out. Dirty affected
      // questions keep their draft and record divergence.
      ctx.invalidateShell("active");
      ctx.invalidateReadinessAndRelease();
      noteDirtyDivergence(ctx, event, "bulk_changed");
      return { outcome: "invalidated", refetch: "active" };
    }

    case "exam.changed":
      ctx.invalidateShell("none");
      ctx.invalidateReadinessAndRelease();
      return { outcome: "lifecycle", signal: "exam-changed" };

    case "draft.opened":
      return { outcome: "ignored", reason: "informational" };

    case "draft.replaced":
    case "exam.published":
      return handleDraftPublished(ctx, event);

    default:
      // Unknown-kind tolerance: a future server kind must never throw here.
      return { outcome: "ignored", reason: "unknown-kind" };
  }
}
