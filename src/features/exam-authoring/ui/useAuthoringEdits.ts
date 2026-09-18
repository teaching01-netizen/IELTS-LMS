import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { QuestionRevision } from "../contracts/assessment";
import type { SatAuthoringCollaborationValue } from "../realtime/coedit";
import { isPromptOnlyChange } from "../realtime/coedit";
import { SAVE_CONFLICT_COPY } from "../realtime/connectionCopy";
import type { CoeditSaveDisplayStatus } from "./spine/coeditSaveTruth";
import type { QuestionPersistenceMode } from "./useAuthoringPersistence";

/**
 * What an author's change to the open question MEANS, and what a manual save
 * does: the edit pipeline, owned end to end.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two rules about editing the open question lived in the render body, and both
 * are precedence rules — exactly the kind that a second call site copies and
 * then drifts from:
 *
 *   - an edit withdraws the workbook-import rewind (an edit is the one thing
 *     that makes rewinding the import unsafe), installs the draft, and then
 *     reaches exactly ONE writer: the exam room's own scalar path, the
 *     prompt-room's skip, or the legacy autosave queue;
 *   - a manual save answers a held-back write with the decision the author
 *     actually has to make rather than the word "failed".
 *
 * The writers stay injected: which writer owns a field is
 * `useAuthoringSaveRouting`'s decision, and this module only routes to the one
 * it is given. Nothing here creates a dependency it could receive instead.
 */
export interface AuthoringEditWriters {
  /** Which writer owns the open question's fields. */
  mode: QuestionPersistenceMode;
  /**
   * The exam room's exact scalar write. Returns whether the room took the edit:
   * when it does, a whole-question HTTP save beside it would be a second writer
   * racing the CRDT, so nothing else may be scheduled.
   */
  publishWorkspaceScalar: (next: QuestionRevision) => boolean;
  /** The legacy autosave queue. */
  scheduleAutosave: (next: QuestionRevision) => void;
  /** The last server-acknowledged revision the prompt-free diff measures against. */
  promptFreeBaselineRef: MutableRefObject<QuestionRevision | null>;
}

export interface AuthoringEditing {
  /** The open draft, and the one way an author's shaped edit installs into it. */
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  /** An edit is the one thing that makes the import rewind unsafe. */
  withdrawWorkbookUndo: () => void;
}

export interface AuthoringSaveNow {
  /** The room owns the durable save when one is mounted. */
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  coeditDisplayStatus: CoeditSaveDisplayStatus | null;
  /** The legacy writer's barrier. */
  flushNow: (revision: QuestionRevision) => Promise<{ ok: boolean }>;
}

export interface AuthoringEditsInput {
  writers: AuthoringEditWriters;
  editing: AuthoringEditing;
  save: AuthoringSaveNow;
  /** The open draft, or null when no question is open. */
  draft: QuestionRevision | null;
  /** The draft is dirty and the server has moved past its base: the write is held back. */
  conflicted: boolean;
  /** The author's decision surface for a held-back write. */
  openReview: () => void;
  /** The one notice channel. */
  setNotice: (message: string | null) => void;
}

export interface AuthoringEdits {
  /** The author changed the open question. */
  handleChange: (next: QuestionRevision) => void;
  /** The author asked to save now, explicitly. */
  handleSaveNow: () => Promise<void>;
}

export function useAuthoringEdits({
  writers,
  editing,
  save,
  draft,
  conflicted,
  openReview,
  setNotice,
}: AuthoringEditsInput): AuthoringEdits {
  const { mode, publishWorkspaceScalar, scheduleAutosave, promptFreeBaselineRef } = writers;
  const { setDraft, withdrawWorkbookUndo } = editing;

  const handleChange = useCallback(
    (next: QuestionRevision) => {
      // An edit is the one thing that makes the import rewind unsafe, so the
      // offer is withdrawn here rather than checked later.
      withdrawWorkbookUndo();
      setDraft(next);
      // The exam room persists every field of the question it owns, including
      // the scalar settings, through its own exact Yjs acknowledgement. Never
      // enqueue a whole-question HTTP autosave beside it.
      if (mode === "workspace-room" && publishWorkspaceScalar(next)) return;
      // While co-editing owns the prompt, a prompt-only change stays OUT of the
      // legacy autosave queue: the Y.Doc is the source of truth for the prompt,
      // the service persists it, and scheduling a whole-question save here
      // would either fail (COEDIT_ACTIVE) or bump a revision for a keystroke.
      // The projection the composer emits is still real — it feeds preview and
      // validation — it just does not schedule a save.
      const baseline = promptFreeBaselineRef.current;
      if (mode === "prompt-room" && baseline && isPromptOnlyChange(baseline, next)) {
        return;
      }
      scheduleAutosave(next);
    },
    [
      mode,
      promptFreeBaselineRef,
      publishWorkspaceScalar,
      scheduleAutosave,
      setDraft,
      withdrawWorkbookUndo,
    ]
  );

  const handleSaveNow = useCallback(async () => {
    if (!draft) return;
    setNotice(null);
    // The exam-level workspace is already the durable save queue. A manual save
    // shortcut must not send a stale whole-question HTTP revision beside the
    // shared Yjs roots; the workspace acknowledgement is the only source of
    // save truth in SAT co-edit mode.
    if (save.workspaceCollaboration) {
      if (save.coeditDisplayStatus === "error") save.workspaceCollaboration.retry();
      return;
    }
    const result = await save.flushNow(draft);
    if (result.ok) return;
    if (conflicted) {
      // Diverged, not failed: the write is held back on purpose because the
      // server already holds a newer revision. The author asked to save, so
      // answer with the decision they actually have to make.
      openReview();
      return;
    }
    setNotice(SAVE_CONFLICT_COPY.failed);
  }, [conflicted, draft, openReview, save, setNotice]);

  return { handleChange, handleSaveNow };
}
