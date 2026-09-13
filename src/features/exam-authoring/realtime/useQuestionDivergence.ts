import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuestionRevision } from "../contracts/assessment";
import {
  applyDivergenceEvent,
  createDivergenceState,
  divergenceFor,
  isDiverged as isDivergedEntry,
  isQuestionDirty,
  type DivergenceState,
} from "./divergenceStore";
import type { DivergenceEvent, QuestionDivergence } from "./divergenceTypes";

export interface UseQuestionDivergenceOptions {
  /** The revision the open editor agreed with the server on. */
  base: QuestionRevision | null;
  /** The open editor's current content. */
  draft: QuestionRevision | null;
  /** Autosave truth. Part of the sanctioned dirty rule. */
  hasPendingChanges: boolean;
  /** Injectable clock so tests need no fake timers. */
  now?: (() => string) | undefined;
}

export interface UseQuestionDivergenceResult {
  state: DivergenceState;
  divergence: QuestionDivergence | undefined;
  isDirty: boolean;
  isDiverged: boolean;
  dispatch: (event: DivergenceEvent) => void;
  /** Clears tracking for a question that has been resolved or closed. */
  forget: (examQuestionId: string) => void;
}

/**
 * Owns divergence for the SELECTED question (plus whatever the store still
 * tracks for rail dots). Deliberately small: no transport, no presence, no UI.
 *
 * Baseline seeding is keyed on (question, base revision) rather than on the
 * draft, so typing can never re-seed the baseline and silently un-diverge a
 * live conflict.
 */
export function useQuestionDivergence(
  selectedExamQuestionId: string | null,
  options: UseQuestionDivergenceOptions,
): UseQuestionDivergenceResult {
  const [state, setState] = useState<DivergenceState>(createDivergenceState);
  const { base, draft, hasPendingChanges } = options;

  const nowRef = useRef(options.now);
  useEffect(() => {
    nowRef.current = options.now;
  }, [options.now]);
  const at = useCallback((): string => {
    const clock = nowRef.current;
    return clock ? clock() : new Date().toISOString();
  }, []);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const dispatch = useCallback(
    (event: DivergenceEvent) => {
      setState((previous) => applyDivergenceEvent(previous, event, at()));
    },
    [at],
  );

  // Seed the baseline exactly once per (question, base revision).
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedExamQuestionId || !base) {
      seededRef.current = null;
      return;
    }
    const key = `${selectedExamQuestionId}:${base.revision}`;
    if (seededRef.current === key) return;
    seededRef.current = key;
    dispatch({
      type: "INIT_BASELINE",
      examQuestionId: selectedExamQuestionId,
      base,
      // A draft that differs from the freshly fetched revision (a recovered
      // durable draft) correctly starts DIRTY instead of clean.
      local: draftRef.current ?? base,
    });
  }, [selectedExamQuestionId, base, dispatch]);

  // Every editor change is a LOCAL_EDIT. Content — not keystrokes — decides
  // dirtiness, so typing then deleting returns to clean.
  useEffect(() => {
    if (!selectedExamQuestionId || !draft) return;
    dispatch({
      type: "LOCAL_EDIT",
      examQuestionId: selectedExamQuestionId,
      local: draft,
    });
  }, [selectedExamQuestionId, draft, dispatch]);

  const divergence = divergenceFor(state, selectedExamQuestionId);

  return useMemo(
    () => ({
      state,
      divergence,
      isDirty: isQuestionDirty(divergence, hasPendingChanges),
      isDiverged: isDivergedEntry(divergence),
      dispatch,
      forget: (examQuestionId: string) =>
        dispatch({ type: "CLOSE_QUESTION", examQuestionId }),
    }),
    [state, divergence, hasPendingChanges, dispatch],
  );
}
