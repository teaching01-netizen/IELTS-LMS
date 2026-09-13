import { questionTargetOf } from "./authoringCacheReconciler";
import type { AuthoringEventV1 } from "./contracts";

/**
 * The remote-update decision table, isolated so it can be reasoned about (and
 * tested) without a socket, a store, or React.
 *
 * Only single-question CONTENT events reach a decision here; every structural,
 * bulk, or lifecycle kind is the reconciler's business and resolves to
 * `background-reconcile` (which is the Phase 04 path, unchanged).
 */
export type RemoteUpdateDecision =
  | { kind: "background-reconcile" }
  /** Open + clean: safe to refetch and replace in place. */
  | { kind: "refetch-replace"; examQuestionId: string }
  /** Open + dirty: keep the local draft BYTE-IDENTICAL, record the remote. */
  | {
      kind: "preserve-diverge";
      examQuestionId: string;
      remoteRevision: number;
    };

/** Content kinds that can be replaced field-for-field in an open editor. */
const SINGLE_QUESTION_CONTENT_KINDS: ReadonlySet<string> = new Set([
  "question.changed",
  "question.duplicated",
]);

export function decideRemoteUpdate(args: {
  event: AuthoringEventV1;
  selectedExamQuestionId: string | null;
  isDirty: boolean;
}): RemoteUpdateDecision {
  const { event, selectedExamQuestionId, isDirty } = args;

  // 1. Structural / bulk / lifecycle kinds: never a replace decision. The
  //    reconciler owns them (invalidate + refetch authoritative state).
  if (!SINGLE_QUESTION_CONTENT_KINDS.has(event.kind)) {
    return { kind: "background-reconcile" };
  }

  const examQuestionId = questionTargetOf(event);
  if (!examQuestionId) {
    return { kind: "background-reconcile" };
  }

  // 2. Another question: background reconcile only. An event for a question
  //    nobody has open is never a reason to fetch its content.
  if (examQuestionId !== selectedExamQuestionId) {
    return { kind: "background-reconcile" };
  }

  // 3. The open question. Clean editors converge in place; dirty editors keep
  //    their work and are told, never overwritten and never auto-switched.
  if (!isDirty) {
    return { kind: "refetch-replace", examQuestionId };
  }
  return {
    kind: "preserve-diverge",
    examQuestionId,
    remoteRevision: event.revision,
  };
}
