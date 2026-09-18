import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { authoringEffects } from "../api/authoringQueryEffects";
import type { QuestionRevision } from "../contracts/assessment";
import type { DivergenceEvent } from "../realtime";
import {
  resolveFieldWriter,
  savePromptFreeFields,
  type FieldWriter,
} from "../realtime/coedit";

/**
 * Which writer owns the open question, and the save that writer permits.
 *
 * The routing decision and the write live together on purpose: the failure this
 * replaces was a second writer appearing beside the room because one call site
 * carried its own copy of the rule. `resolveFieldWriter` states it once, and
 * `saveDraft` is the only function that acts on it.
 */
export interface AuthoringSaveRoutingInput {
  examId: string;
  queryClient: QueryClient;
  selectedExamQuestionId: string | null;
  questionDraftKey: string | null;
  /** The exam-level workspace room is mounted for this session. */
  workspaceRoomActive: boolean;
  /** The question-scoped prompt room owns the prompt. */
  promptRoomActive: boolean;
  /** Last server-acknowledged revision the prompt-free field diff uses. */
  promptFreeBaselineRef: { current: QuestionRevision | null };
  /** Set when the draft was published elsewhere: the write target is invalid. */
  mutationFrozenRef: { current: boolean };
  /** Set when the question was deleted elsewhere: the write target is gone. */
  deletedRemotelyRef: { current: boolean };
  /** Receives SERVER_ACK so the author's own save never reads as remote work. */
  divergenceDispatchRef: { current: (event: DivergenceEvent) => void };
  /** Cleared once a recovered device draft has been superseded by a save. */
  recoveredQuestionDraftKeyRef: { current: string | null };
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  updateSummaryCache: (examQuestionId: string, saved: QuestionRevision) => void;
}

export interface AuthoringSaveRouting {
  fieldWriter: FieldWriter;
  saveDraft: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
}

export function useAuthoringSaveRouting(
  input: AuthoringSaveRoutingInput,
): AuthoringSaveRouting {
  const {
    examId,
    queryClient,
    selectedExamQuestionId,
    questionDraftKey,
    workspaceRoomActive,
    promptRoomActive,
    promptFreeBaselineRef,
    mutationFrozenRef,
    deletedRemotelyRef,
    divergenceDispatchRef,
    recoveredQuestionDraftKeyRef,
    setDraft,
    updateSummaryCache,
  } = input;

  const fieldWriter = resolveFieldWriter({ workspaceRoomActive, promptRoomActive });
  // The LIVE selection, read after an await. The callback closure holds the
  // question this save started for, which is what the write must be attributed
  // to — this ref is how the resolution learns whether the author is still
  // looking at it.
  const selectedExamQuestionIdRef = useRef(selectedExamQuestionId);
  useEffect(() => {
    selectedExamQuestionIdRef.current = selectedExamQuestionId;
  }, [selectedExamQuestionId]);

  const saveDraft = useCallback(
    async (revision: QuestionRevision) => {
      const examQuestionId = selectedExamQuestionId;
      if (!examQuestionId) throw new Error("Cannot save a question that is not selected.");
      // Single ownership (resolveFieldWriter): exactly one writer persists this
      // question's fields. The exam room stores the scalars and the rich roots
      // through its own acknowledged path, which the service materializes into
      // the same columns — so an HTTP write beside it is a second writer whose
      // stale full-column snapshot races the CRDT by wall-clock. Nothing is
      // written here in that case, so the legacy race guards below (which exist
      // to protect an HTTP target) do not apply either.
      if (fieldWriter === "workspace") return undefined;
      // Race-recovery freeze (plan §F). Both cases surface as a typed failure
      // instead of an HTTP write: the published draft is not a valid target and
      // a remotely deleted question can only answer 404. The author's typed
      // content is untouched either way — only the WRITE is blocked.
      if (mutationFrozenRef.current) {
        throw new Error(
          "This draft was published. Open the new draft to keep editing."
        );
      }
      if (deletedRemotelyRef.current) {
        throw new Error(
          "This question was deleted elsewhere. Copy your work before leaving."
        );
      }
      // A question-scoped room owns the prompt ONLY: save everything ELSE
      // through the partial endpoint. The legacy full save carries a prompt, so
      // it would be refused with a typed COEDIT_ACTIVE conflict the moment a
      // room row is active — turning every non-prompt edit into a visible
      // failure. The prompt itself is persisted only by the store path.
      const saved = fieldWriter === "prompt-room"
        ? await savePromptFreeFields({
            examQuestionId,
            revision,
            base: promptFreeBaselineRef.current,
            deps: {
              saveFields: (revisionId, request) =>
                assessmentAuthoringApi.saveQuestionRevisionFields(revisionId, request),
              loadLatest: async (id) => (await assessmentAuthoringApi.getQuestion(id)).question,
            },
          })
        : await assessmentAuthoringApi.saveQuestionRevision(revision.id, {
            revision: revision.revision,
            questionType: revision.questionType,
            stimulus: revision.stimulus,
            prompt: revision.prompt,
            answer: revision.answer,
            rationale: revision.rationale,
            metadata: revision.metadata,
            accessibility: revision.accessibility,
          });
      if (!saved) {
        // Nothing outside the prompt changed since the last acknowledgement.
        // No write happened, so nothing is advanced and nothing is claimed:
        // the collaborative document already owns the only changed field.
        return undefined;
      }
      // Installing the answer into the OPEN draft is only correct while the
      // author is still on the question this save was for. The editor renders
      // whatever `draft` holds and takes its header from the SELECTED module, so
      // a writeback that lands after a switch repaints the question the author
      // moved to with the one they left: the Math prompt and its answer appeared
      // inside a Reading & Writing question, and because this save had just been
      // acknowledged it even read as Saved. The write itself is real and stays
      // attributed to its own question (summary, acknowledgement, cache) below.
      const stillOpen = selectedExamQuestionIdRef.current === examQuestionId;
      if (stillOpen) {
        promptFreeBaselineRef.current = saved;
        // The baseline advances to the server revision, but the PROMPT keeps the
        // projection the room owns: a partial field write answers with the
        // server's materialized (and therefore older) prompt, and copying that
        // into the draft would show the author stale text in preview/validation
        // and make their next keystroke read as a field change rather than the
        // prompt-only edit it is.
        setDraft(
          fieldWriter === "prompt-room" ? { ...saved, prompt: revision.prompt } : saved
        );
      }
      // The author's OWN save must never read as a remote revision. `setDraft`
      // and the query-cache write land in one batch, so the divergence hook
      // re-seeds with `base = saved` while this entry still holds the edited
      // draft — and without this ack the base never advances, making the re-seed
      // indistinguishable from a collaborator's newer revision. The visible
      // cost of that: the save area claims "a newer version is available" for
      // the author's own work, and the pause that exists to protect a stale
      // draft swallows their next edit.
      divergenceDispatchRef.current({
        type: "SERVER_ACK",
        examQuestionId,
        saved,
      });
      if (recoveredQuestionDraftKeyRef.current === questionDraftKey) {
        recoveredQuestionDraftKeyRef.current = null;
      }
      updateSummaryCache(examQuestionId, saved);
      // The save moved the summary row and the reports derived from it; the
      // tree's rows themselves did not move. Stale-only, because the refetch
      // policy here belongs to the screen, not to the autosave: an active
      // refetch on every keystroke's write would race the next keystroke.
      void authoringEffects.shellChanged(queryClient, examId, { refetchType: "none" });
      return saved;
    },
    [
      deletedRemotelyRef,
      divergenceDispatchRef,
      examId,
      fieldWriter,
      mutationFrozenRef,
      promptFreeBaselineRef,
      queryClient,
      questionDraftKey,
      recoveredQuestionDraftKeyRef,
      selectedExamQuestionId,
      setDraft,
      updateSummaryCache,
    ]
  );

  return { fieldWriter, saveDraft };
}
