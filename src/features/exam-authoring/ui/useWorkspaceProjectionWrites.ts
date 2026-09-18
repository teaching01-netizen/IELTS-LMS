import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { QuestionRevision } from "../contracts/assessment";
import type { SatAuthoringCollaborationValue } from "../realtime/coedit";
import {
  applyQuestionWorkspaceRich,
  applyQuestionWorkspaceScalar,
  emptyWorkspaceContent,
  isQuestionWorkspaceScalar,
  questionWorkspaceHydration,
  questionWorkspaceRich,
  questionWorkspaceScalar,
  type QuestionWorkspaceScalar,
} from "./authoringWorkspaceModel";

/**
 * The open question's content, projected both ways against the exam room.
 *
 * The room owns the rich roots and the scalar record; React owns the draft the
 * editors and validators read. This hook is the ONLY place that pumps one into
 * the other, in both directions:
 *
 *   - seed : the HTTP question PROPOSES a seed once, after the room is ready
 *            and its local cache has replayed — the room arbitrates it;
 *   - read : a collaborator's scalar/rich update projects onto the draft;
 *   - write: a local change projects onto the room, field by field, so an
 *            older parent render cannot clobber a concurrent edit elsewhere.
 *
 * It also owns the AUTHORITY HANDOFF: the room being connected is not the same
 * as the room holding this question. `hydration` is that distinction, and every
 * one of the three directions above waits for it — read and write never cross
 * the barrier, and a seed proposal is the only thing that may cross it early.
 */
export interface WorkspaceProjectionWritesInput {
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  /** `question/<examQuestionId>` for the open question, when one is selected. */
  workspaceQuestionPath: string | null;
  selectedExamQuestionId: string | null;
  /**
   * The exam-question placement the HTTP question was loaded for. A revision
   * carries the QUESTION id, which is a different entity from the placement the
   * room keys its roots by, so the placement is what ties a seed to the open
   * question.
   */
  baseQuestionExamQuestionId: string | null;
  /** The HTTP question: the seed only, never the source of truth. */
  baseQuestion: QuestionRevision | null;
  isPretest: boolean | undefined;
  draft: QuestionRevision | null;
  /** The last draft the editors rendered, for change detection. */
  draftRef: { current: QuestionRevision | null };
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
}

export interface QuestionHydration {
  /**
   * Every root this question needs is owned by the room.
   *
   * A connected room is NOT the same thing: the seed is a proposal the service
   * arbitrates, so there is a real window in which the room has synced and the
   * question's roots do not exist yet. Everything that hands authority to the
   * room waits for this flag.
   */
  ready: boolean;
  /** The root paths the room does not hold yet, for diagnostics and surfaces. */
  pendingPaths: string[];
}

export interface WorkspaceProjectionWrites {
  /** The room's scalar record for the open question, if it has one yet. */
  sharedQuestionScalar: QuestionWorkspaceScalar | null;
  /** Whether the room owns the open question's canonical roots yet. */
  hydration: QuestionHydration;
  /**
   * Projects a local question change onto the room's scalar record.
   * False when no room owns the open question, in which case the caller keeps
   * its legacy save path.
   */
  publishScalar: (question: QuestionRevision) => boolean;
  /** Projects a local question change onto the room's rich roots. */
  handleLocalRichChange: (question: QuestionRevision) => void;
}

export function useWorkspaceProjectionWrites(
  input: WorkspaceProjectionWritesInput,
): WorkspaceProjectionWrites {
  const {
    workspaceCollaboration,
    workspaceQuestionPath,
    selectedExamQuestionId,
    baseQuestionExamQuestionId,
    baseQuestion,
    isPretest,
    draft,
    draftRef,
    setDraft,
  } = input;

  // The last scalar THIS client wrote, so the projection back onto the draft
  // can tell its own write apart from a collaborator's newer one.
  const localWorkspaceScalarRef = useRef<{ questionId: string; json: string } | null>(null);

  const sharedQuestionScalar = useMemo(() => {
    if (!workspaceCollaboration || !workspaceQuestionPath) return null;
    const value = workspaceCollaboration.workspaceSnapshot.values[`${workspaceQuestionPath}/scalar`];
    return isQuestionWorkspaceScalar(value) ? value : null;
  }, [workspaceCollaboration, workspaceQuestionPath]);
  const sharedQuestionScalarJson = useMemo(
    () => (sharedQuestionScalar ? JSON.stringify(sharedQuestionScalar) : null),
    [sharedQuestionScalar],
  );
  // Which choice roots this question needs. The room's own scalar wins once it
  // exists (it is the newer truth); before that the HTTP question states the
  // shape being seeded. An SPR question requires no choice roots at all.
  const requiredChoiceIds = useMemo(() => {
    if (sharedQuestionScalar?.answer.kind === "single_choice") {
      return sharedQuestionScalar.answer.options.map((option) => option.id);
    }
    const source = baseQuestion ?? draft;
    return source?.answer.kind === "single_choice"
      ? source.answer.options.map((option) => option.id)
      : [];
  }, [baseQuestion, draft, sharedQuestionScalar]);

  // The authority handoff: is the room actually holding this question yet?
  const hydration = useMemo<QuestionHydration>(() => {
    if (!workspaceCollaboration || !workspaceQuestionPath) {
      return { ready: false, pendingPaths: [] };
    }
    return questionWorkspaceHydration(
      workspaceCollaboration.workspaceSnapshot.values,
      workspaceQuestionPath,
      { singleChoiceOptionIds: requiredChoiceIds },
    );
  }, [requiredChoiceIds, workspaceCollaboration, workspaceQuestionPath]);
  const hydrated = hydration.ready;

  const sharedQuestionRich = useMemo(
    () =>
      workspaceCollaboration && workspaceQuestionPath
        ? questionWorkspaceRich(
            workspaceCollaboration.workspaceSnapshot.values,
            workspaceQuestionPath,
          )
        : null,
    [
      workspaceCollaboration,
      workspaceQuestionPath,
    ],
  );

  // Seeding waits for BOTH halves of readiness — initial sync and the IndexedDB
  // replay — because a proposal sent before the local cache lands can be merged
  // over by it, which is the same duplication the server-side arbitration
  // exists to prevent.
  const seedBarrierOpen = Boolean(
    workspaceCollaboration?.workspaceSnapshot.ready &&
      workspaceCollaboration.workspaceSnapshot.localReady,
  );

  // The HTTP question is only the seed, and the seed is a proposal the room
  // arbitrates: two tabs opening the same empty question both see an empty
  // root, so a local write would let whichever merges second silently win. Once
  // the room has synced, scalar settings are projected into the selected
  // question and all rich fields bind directly to their shared XML fragments.
  //
  // This effect may re-run freely: a proposal for a root the room already
  // populates is dropped by the provider before it reaches the wire (and the
  // service refuses it anyway), so a stale base-question render can never
  // re-seed work the room already holds.
  useEffect(() => {
    if (
      !workspaceCollaboration ||
      !workspaceQuestionPath ||
      !baseQuestion ||
      !seedBarrierOpen
    ) return;
    // The seed is derived from the revision of ONE placement. A result still
    // carrying the previously open placement must never seed this one's roots.
    if (baseQuestionExamQuestionId !== selectedExamQuestionId) return;
    const revision = baseQuestion.revision;
    workspaceCollaboration.seedValue(
      `${workspaceQuestionPath}/scalar`,
      questionWorkspaceScalar(baseQuestion, isPretest),
      revision,
    );
    workspaceCollaboration.seedRichField(`${workspaceQuestionPath}/prompt`, baseQuestion.prompt, revision);
    workspaceCollaboration.seedRichField(`${workspaceQuestionPath}/stimulus`, baseQuestion.stimulus, revision);
    workspaceCollaboration.seedRichField(`${workspaceQuestionPath}/rationale`, baseQuestion.rationale, revision);
    if (baseQuestion.answer.kind === "single_choice") {
      for (const option of baseQuestion.answer.options) {
        workspaceCollaboration.seedRichField(
          `${workspaceQuestionPath}/choice/${option.id}`,
          option.content,
          revision,
        );
      }
    }
  }, [
    baseQuestion,
    baseQuestionExamQuestionId,
    isPretest,
    selectedExamQuestionId,
    seedBarrierOpen,
    workspaceCollaboration,
    workspaceQuestionPath,
  ]);

  useEffect(() => {
    // Before the question is hydrated the HTTP draft is authoritative: an empty
    // (or partial) room must not project over it. This is the guard that turns
    // "an allocated-but-empty root appeared" into nothing at all, even if such a
    // value ever reached the snapshot.
    if (!hydrated) return;
    if (!draft || !sharedQuestionScalar || !sharedQuestionScalarJson) return;
    const localWrite = localWorkspaceScalarRef.current;
    const currentScalarJson = JSON.stringify(questionWorkspaceScalar(draft, sharedQuestionScalar.isPretest));
    if (
      localWrite?.questionId === selectedExamQuestionId &&
      localWrite.json === currentScalarJson
    ) {
      if (localWrite.json === sharedQuestionScalarJson) localWorkspaceScalarRef.current = null;
      return;
    }
    if (currentScalarJson === sharedQuestionScalarJson) return;
    setDraft((current) => {
      if (!current || current.id !== draft.id) return current;
      if (JSON.stringify(questionWorkspaceScalar(current, sharedQuestionScalar.isPretest)) === sharedQuestionScalarJson) return current;
      return applyQuestionWorkspaceScalar(current, sharedQuestionScalar);
    });
  }, [draft, hydrated, selectedExamQuestionId, setDraft, sharedQuestionScalar, sharedQuestionScalarJson]);

  // A supporting-material or rationale editor may be collapsed locally. Keep
  // the question projection current from the shared XML roots anyway, so
  // remote edits are visible as soon as the section is expanded and are also
  // reflected in preview/validation without requiring a local remount.
  useEffect(() => {
    // Same barrier as the scalar projection above: the room may only replace a
    // field of the HTTP question once it owns that question's roots. Until then
    // a partial room (one root seeded, three still empty) is not authority.
    if (!hydrated) return;
    if (!draft || !sharedQuestionRich || !workspaceQuestionPath) return;
    const next = applyQuestionWorkspaceRich(draft, sharedQuestionRich);
    if (JSON.stringify(next) === JSON.stringify(draft)) return;
    setDraft((current) => {
      if (!current || current.id !== draft.id) return current;
      const projected = applyQuestionWorkspaceRich(current, sharedQuestionRich);
      return JSON.stringify(projected) === JSON.stringify(current) ? current : projected;
    });
  }, [draft, hydrated, setDraft, sharedQuestionRich, workspaceQuestionPath]);

  const publishScalar = useCallback(
    (question: QuestionRevision): boolean => {
      if (!workspaceCollaboration || !selectedExamQuestionId) return false;
      // A room is mounted for this question, but it does not hold the question's
      // canonical roots yet: the author cannot be editing this question through
      // it, so a write here would be the second writer filling an empty room.
      // `true` keeps the legacy HTTP autosave out, which is the invariant that
      // matters — the room owns the question, its seed just has not landed.
      if (!hydrated) return true;
      const currentShared = workspaceCollaboration.workspaceSnapshot.values[
        `question/${selectedExamQuestionId}/scalar`
      ];
      const currentSharedIsPretest = isQuestionWorkspaceScalar(currentShared)
        ? currentShared.isPretest
        : isPretest;
      const scalar = questionWorkspaceScalar(question, currentSharedIsPretest);
      const json = JSON.stringify(scalar);
      const previous = draftRef.current;
      const previousScalarJson = previous
        ? JSON.stringify(questionWorkspaceScalar(previous, currentSharedIsPretest))
        : null;
      // Rich-editor projections call the same question-level callback for
      // remote updates. Only a genuine scalar change may write the scalar root;
      // otherwise a stale rich projection could overwrite a collaborator's
      // newer answer/metadata settings.
      const scalarChanged = previousScalarJson === null
        ? !isQuestionWorkspaceScalar(currentShared)
        : previousScalarJson !== json;
      if (scalarChanged) {
        localWorkspaceScalarRef.current = { questionId: selectedExamQuestionId, json };
        workspaceCollaboration.setValue(`question/${selectedExamQuestionId}/scalar`, scalar);
      }
      return true;
    },
    [draftRef, hydrated, isPretest, selectedExamQuestionId, workspaceCollaboration],
  );

  const handleLocalRichChange = useCallback(
    (next: QuestionRevision) => {
      if (!workspaceCollaboration || !selectedExamQuestionId) return;
      // Same barrier as `publishScalar`: never write rich content into a room
      // that has not yet been handed the question's canonical roots.
      if (!hydrated) return;
      const path = `question/${selectedExamQuestionId}`;
      // The editor binding already wrote the field that changed. The explicit
      // projection also covers non-editor rich actions (for example replacing
      // a supporting-material starter), but only writes fields whose value
      // actually changed. Rewriting every rich root from a full question
      // snapshot here could clobber a collaborator's concurrent edit in a
      // different field with an older parent render.
      const previous = draftRef.current;
      if (!previous || JSON.stringify(previous.prompt) !== JSON.stringify(next.prompt)) {
        workspaceCollaboration.setRichField(`${path}/prompt`, next.prompt);
      }
      if (!previous || JSON.stringify(previous.stimulus) !== JSON.stringify(next.stimulus)) {
        workspaceCollaboration.setRichField(`${path}/stimulus`, next.stimulus);
      }
      if (!previous || JSON.stringify(previous.rationale) !== JSON.stringify(next.rationale)) {
        workspaceCollaboration.setRichField(`${path}/rationale`, next.rationale);
      }
      if (next.answer.kind === "single_choice") {
        const previousChoices = previous?.answer.kind === "single_choice" ? previous.answer.options : [];
        const nextChoiceIds = new Set(next.answer.options.map((option) => option.id));
        for (const option of next.answer.options) {
          const previousOption = previousChoices.find((candidate) => candidate.id === option.id);
          if (!previousOption || JSON.stringify(previousOption.content) !== JSON.stringify(option.content)) {
            workspaceCollaboration.setRichField(`${path}/choice/${option.id}`, option.content);
          }
        }
        // Choice fragments are named by stable option id and therefore outlive
        // a response-type change. Clear fragments that are no longer part of
        // the answer so switching back from SPR cannot resurrect old text.
        for (const option of previousChoices) {
          if (!nextChoiceIds.has(option.id)) {
            workspaceCollaboration.setRichField(`${path}/choice/${option.id}`, emptyWorkspaceContent());
          }
        }
      } else if (previous?.answer.kind === "single_choice") {
        for (const option of previous.answer.options) {
          workspaceCollaboration.setRichField(`${path}/choice/${option.id}`, emptyWorkspaceContent());
        }
      }
      // The workspace provider owns every rich field, not only the prompt.
      // Its Yjs store acknowledgement drives the save surface.
    },
    [draftRef, hydrated, selectedExamQuestionId, workspaceCollaboration],
  );

  return { sharedQuestionScalar, hydration, publishScalar, handleLocalRichChange };
}
