import { useEffect, useMemo, type MutableRefObject } from "react";
import type { QuestionRevision } from "../contracts/assessment";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import {
  deriveDraftLifecycle,
  resolveDraftSeams,
  type DraftLifecycle,
} from "./authoringDraftLifecycle";

/**
 * The open draft's lifecycle: the conditions it is derived from, and the
 * imperative seams it projects into.
 *
 * WHY THIS EXISTS
 * ---------------
 * `authoringDraftLifecycle.ts` owns the state and its precedence. What was left
 * in the render body was the derivation's inputs (six values, read from four
 * owners) and the effect that keeps the seam refs current — and that effect is
 * the one place where the "impossible combinations" claim can be broken by a
 * caller, because a second writer of any of those refs would let an imperative
 * seam observe a state the model says cannot exist. Keeping the projection next
 * to the model makes the state and its only writer one thing.
 *
 * The seam refs themselves are injected: they belong to the owners whose state
 * they describe (three are persistence's — the save router and the autosave
 * queue read them after awaits; `draftProtectedRef` belongs to the draft, whose
 * adoption rule reads it). Grouping them states that they are one projection,
 * rather than four loose booleans every reader re-derived.
 */
export interface AuthoringDraftLifecycleConditions {
  /** The local document, exactly as the draft owner holds it. */
  draft: QuestionRevision | null;
  /** The save truth the persistence owner reports. */
  saveStatus: QuestionSaveStatus;
  hasPendingChanges: boolean;
  /** The author's content differs from the revision it was authored against. */
  divergedFromBase: boolean;
  /** The exam draft was published elsewhere: no longer a write target. */
  publishedReadOnly: boolean;
  /** The question was deleted elsewhere: it can only answer 404. */
  deletedRemotely: boolean;
}

/** The refs the imperative seams read. One projection, one writer. */
export interface AuthoringDraftSeamRefs {
  /** The write target is invalid (published elsewhere). */
  mutationFrozenRef: MutableRefObject<boolean>;
  /** The write target is gone (deleted elsewhere). */
  deletedRemotelyRef: MutableRefObject<boolean>;
  /** A refetch may not adopt the server document over held local work. */
  draftProtectedRef: MutableRefObject<boolean>;
  /** HTTP writes are held back: a newer revision exists and the local copy is durable. */
  networkSavePausedRef: MutableRefObject<boolean>;
}

export function useAuthoringDraftLifecycle({
  conditions,
  seams,
}: {
  conditions: AuthoringDraftLifecycleConditions;
  seams: AuthoringDraftSeamRefs;
}): DraftLifecycle {
  const {
    draft,
    saveStatus,
    hasPendingChanges,
    divergedFromBase,
    publishedReadOnly,
    deletedRemotely,
  } = conditions;
  const { mutationFrozenRef, deletedRemotelyRef, draftProtectedRef, networkSavePausedRef } = seams;

  const lifecycle = useMemo(
    () =>
      deriveDraftLifecycle({
        draft,
        saveStatus,
        hasPendingChanges,
        divergedFromBase,
        publishedReadOnly,
        deletedRemotely,
      }),
    [deletedRemotely, divergedFromBase, draft, hasPendingChanges, publishedReadOnly, saveStatus]
  );

  useEffect(() => {
    // The imperative seams (save router, autosave queue, refetch guard) run
    // after awaits, outside React, so they read refs. This is the ONLY writer of
    // those four refs: one projection of one state, so no seam can observe a
    // combination the state says is impossible.
    const projected = resolveDraftSeams(lifecycle);
    mutationFrozenRef.current = projected.mutationFrozen;
    deletedRemotelyRef.current = projected.deletedRemotely;
    draftProtectedRef.current = projected.protectLocalCopy;
    networkSavePausedRef.current = projected.networkSavePaused;
  }, [deletedRemotelyRef, draftProtectedRef, lifecycle, mutationFrozenRef, networkSavePausedRef]);

  return lifecycle;
}
