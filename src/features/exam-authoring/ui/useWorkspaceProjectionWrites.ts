import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { QuestionRevision } from "../contracts/assessment";
import type {
  CoeditLifecyclePhase,
  CoeditSeedDeliveryState,
  SatAuthoringCollaborationValue,
  WorkspaceSeedOutcome,
} from "../realtime/coedit";
import {
  applyQuestionWorkspaceRich,
  applyQuestionWorkspaceScalar,
  emptyWorkspaceContent,
  isQuestionFieldHydrated,
  isQuestionWorkspaceScalar,
  questionWorkspaceHydration,
  questionWorkspaceRich,
  questionWorkspaceRichFieldPaths,
  questionWorkspaceScalar,
  type QuestionWorkspaceScalar,
} from "./authoringWorkspaceModel";

/**
 * How long one rich root may stay un-seeded before its editor stops waiting.
 *
 * A seed proposal is a proposal: it can be refused, conflict, or fail, and the
 * browser used to learn none of that. The wait is therefore bounded — past the
 * deadline the field reports `failed` and offers a retry, which is strictly
 * better than an infinite pulse because it is a state the author can leave.
 */
export const WORKSPACE_FIELD_INITIALIZATION_DEADLINE_MS = 15_000;

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

export type WorkspaceFieldHydrationState = "hydrated" | "pending" | "failed";

export interface WorkspaceFieldHydration {
  /**
   * `hydrated` — the room holds this field's root;
   * `pending`  — its seed is still outstanding inside the bounded wait;
   * `failed`   — the wait expired, or the room reported a non-applied outcome.
   */
  state: WorkspaceFieldHydrationState;
  /** When this field began waiting, for copy and diagnostics. */
  pendingSince: number | null;
  /**
   * Why this field is not usable, in the author's words, or null while it is
   * hydrated or merely starting up.
   *
   * Assembled from facts the client actually holds — the delivery ledger, the
   * room's reported outcome, the session's own read-only/lifecycle posture —
   * rather than a generic sentence. "This field never initialized" is not
   * something an author or an engineer can act on; "the shared copy was never
   * requested" and "the room refused it" are.
   */
  reason: string | null;
}

/**
 * The one place the client explains a field that will not initialize.
 *
 * Pure and exported so the vocabulary can be asserted without mounting a
 * workspace: every branch is a fact the browser already knows, and the order
 * matters — a decided outcome outranks a transport guess, and the session's own
 * posture outranks both.
 */
export function fieldInitializationReason(input: {
  delivery: CoeditSeedDeliveryState | null;
  reported: { outcome: WorkspaceSeedOutcome; retryable: boolean } | null;
  barrierOpen: boolean;
  readOnly: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
}): string | null {
  // Before the room has synced and replayed, waiting is ordinary startup and
  // there is nothing to explain.
  if (!input.barrierOpen) return null;
  if (input.readOnly) {
    return "This session is read-only, so this field's shared copy cannot be created from here.";
  }
  if (input.lifecyclePhase !== "active") {
    return "The room is frozen for publishing, so this field's shared copy cannot be created.";
  }
  if (input.reported) {
    switch (input.reported.outcome) {
      case "rejected":
        return "The room refused the shared copy of this field. Reload the question to try again.";
      case "conflict":
        return "The room already holds a different copy of this field. Reload the question to see it.";
      case "failed":
        return "The room could not store the shared copy of this field.";
      default:
        return "The room did not apply the shared copy of this field.";
    }
  }
  const delivery = input.delivery;
  if (!delivery) return "The shared copy of this field was never requested.";
  switch (delivery.delivery) {
    case "invalid-frame":
      return `This field's shared copy was rejected before it was sent (${delivery.detail ?? "invalid proposal"}).`;
    case "relay-failed":
      return `This field's shared copy could not be sent (${delivery.detail ?? "the transport refused it"}).`;
    case "queued":
      return "This field's shared copy is waiting for the collaboration socket.";
    default:
      // Sent, and the room said nothing at all back. That is the service's
      // validator dropping the frame, and naming it is the whole point.
      return "This field's shared copy was sent, but the room never answered for it.";
  }
}

export interface WorkspaceProjectionWrites {
  /** The room's scalar record for the open question, if it has one yet. */
  sharedQuestionScalar: QuestionWorkspaceScalar | null;
  /** Whether the room owns the open question's canonical roots yet. */
  hydration: QuestionHydration;
  /**
   * Readiness of ONE editor's root, named relative to the open question.
   *
   * Deliberately per-field: the whole-question `hydration` above is the
   * authority handoff for read/write projection, and using it to gate editors
   * made one missing optional root (a rationale nobody has written, a refused
   * seed) block the prompt and every choice too.
   */
  fieldHydration: (fieldPath: string) => WorkspaceFieldHydration;
  /** Re-proposes the seeds for fields still waiting and restarts their wait. */
  retryFieldInitialization: () => void;
  /** True while any rich root of the open question is still waiting. */
  questionFieldsPending: boolean;
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

  // --- Field-scoped initialization -----------------------------------------
  //
  // Which rich roots this question needs, and which of them the room does not
  // hold yet. Readiness is answered per field so a missing root can only affect
  // the editor that binds to it.
  const richFieldPaths = useMemo(
    () => questionWorkspaceRichFieldPaths({ singleChoiceOptionIds: requiredChoiceIds }),
    [requiredChoiceIds],
  );
  const pendingRichFieldPaths = useMemo(() => {
    if (!workspaceCollaboration || !workspaceQuestionPath) return [];
    const values = workspaceCollaboration.workspaceSnapshot.values;
    return richFieldPaths.filter(
      (fieldPath) => !isQuestionFieldHydrated(values, workspaceQuestionPath, fieldPath),
    );
  }, [richFieldPaths, workspaceCollaboration, workspaceQuestionPath]);
  // Effects key off the CONTENT of this set, not its identity: snapshots arrive
  // on every collaborator keystroke, and a dep that changed per snapshot would
  // restart the bounded wait forever.
  const pendingRichFieldKey = pendingRichFieldPaths.join("|");
  const [failedFieldPaths, setFailedFieldPaths] = useState<readonly string[]>([]);
  // Bumped by an explicit retry so the seeding effect proposes again.
  const [seedAttempt, setSeedAttempt] = useState(0);
  const fieldPendingSinceRef = useRef<number | null>(null);

  // A questioned move restarts the wait: the previous question's fields say
  // nothing about this one's.
  useEffect(() => {
    fieldPendingSinceRef.current = null;
    setFailedFieldPaths((current) => (current.length === 0 ? current : []));
  }, [workspaceQuestionPath]);

  // The bounded wait. It never resets its start time on a new snapshot — only
  // a new question or an explicit retry does — so a busy room cannot postpone
  // the failure indefinitely.
  useEffect(() => {
    if (!seedBarrierOpen || !workspaceQuestionPath || !workspaceCollaboration) {
      fieldPendingSinceRef.current = null;
      setFailedFieldPaths((current) => (current.length === 0 ? current : []));
      return;
    }
    if (pendingRichFieldKey === "") {
      fieldPendingSinceRef.current = null;
      setFailedFieldPaths((current) => (current.length === 0 ? current : []));
      return;
    }
    fieldPendingSinceRef.current ??= Date.now();
    const elapsed = Date.now() - fieldPendingSinceRef.current;
    if (elapsed >= WORKSPACE_FIELD_INITIALIZATION_DEADLINE_MS) {
      const next = pendingRichFieldKey.split("|");
      setFailedFieldPaths((current) =>
        current.length === next.length && current.every((field, index) => field === next[index])
          ? current
          : next,
      );
      return;
    }
    const timer = window.setTimeout(() => {
      setFailedFieldPaths(pendingRichFieldKey.split("|"));
    }, WORKSPACE_FIELD_INITIALIZATION_DEADLINE_MS - elapsed);
    return () => window.clearTimeout(timer);
  }, [pendingRichFieldKey, seedBarrierOpen, workspaceCollaboration, workspaceQuestionPath]);

  const fieldHydration = useCallback(
    (fieldPath: string): WorkspaceFieldHydration => {
      if (!workspaceCollaboration || !workspaceQuestionPath) {
        return { state: "pending", pendingSince: null, reason: null };
      }
      const values = workspaceCollaboration.workspaceSnapshot.values;
      if (isQuestionFieldHydrated(values, workspaceQuestionPath, fieldPath)) {
        return { state: "hydrated", pendingSince: null, reason: null };
      }
      if (!seedBarrierOpen) {
        // The room has not finished syncing, so nothing has been proposed yet
        // and nothing has failed: this is still ordinary startup.
        return { state: "pending", pendingSince: null, reason: null };
      }
      // Keyed by the path the service was told to seed (`question/<id>/…`),
      // which is the same string every seed frame carries.
      const seedPath = `${workspaceQuestionPath}/${fieldPath}`;
      const reported = workspaceCollaboration.workspaceSnapshot.seedFailures?.[seedPath] ?? null;
      const decidedOutcome = reported && reported.outcome !== "applied" ? reported : null;
      const delivery = workspaceCollaboration.workspaceSnapshot.seedDeliveries?.[seedPath] ?? null;
      // A proposal the shared validator refused, or one the transport could not
      // send, is DECIDED: it is not a wait, and making the author sit out the
      // bounded deadline to be told so would hide the one fact they need. A
      // `queued` or `relayed` proposal is a genuine wait and stays pending.
      const decidedDelivery =
        delivery?.delivery === "invalid-frame" || delivery?.delivery === "relay-failed";
      // The reason is carried for a merely-pending field too, not only a failed
      // one: "its copy was rejected before it was sent" is worth saying the
      // moment it is known, rather than after a 15-second wait proves it.
      const reason = fieldInitializationReason({
        delivery,
        reported: decidedOutcome,
        barrierOpen: seedBarrierOpen,
        readOnly: workspaceCollaboration.workspaceSnapshot.readOnly,
        lifecyclePhase: workspaceCollaboration.workspaceSnapshot.lifecyclePhase,
      });
      if (decidedOutcome || decidedDelivery || failedFieldPaths.includes(fieldPath)) {
        return { state: "failed", pendingSince: fieldPendingSinceRef.current, reason };
      }
      return { state: "pending", pendingSince: fieldPendingSinceRef.current, reason };
    },
    [failedFieldPaths, seedBarrierOpen, workspaceCollaboration, workspaceQuestionPath],
  );
  const retryFieldInitialization = useCallback(() => {
    fieldPendingSinceRef.current = Date.now();
    setFailedFieldPaths([]);
    setSeedAttempt((attempt) => attempt + 1);
  }, []);

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
    // An explicit retry re-proposes every still-empty root. The service keys a
    // seed by its content, so this is idempotent: a proposal that already
    // applied is refused as a duplicate rather than applied twice.
    seedAttempt,
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

  return {
    sharedQuestionScalar,
    hydration,
    fieldHydration,
    retryFieldInitialization,
    questionFieldsPending: pendingRichFieldKey !== "",
    publishScalar,
    handleLocalRichChange,
  };
}
