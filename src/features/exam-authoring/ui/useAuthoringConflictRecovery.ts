import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { authoringEffects } from "../api/authoringQueryEffects";
import type { useExamQuestion } from "../api/assessmentQueries";
import type { QuestionRevision } from "../contracts/assessment";
import { classifyQuestionFields, useQuestionDivergence } from "../realtime";
import type {
  CoeditRecovery,
  SatAuthoringCollaborationValue,
  UsePromptCoeditingResult,
  WorkspaceRecovery,
} from "../realtime/coedit";
import { DELETION_COPY, PUBLISH_COPY, STRUCTURAL_COPY } from "./collaboration/collaborationCopy";
import {
  isQuestionWorkspaceScalar,
  normalizeQuestionRevision,
  questionWorkspaceScalar,
} from "./authoringWorkspaceModel";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import type { CoeditSaveDisplayStatus } from "./spine/coeditSaveTruth";

/**
 * A device-local draft that was recovered after a reload, and the ONE decision
 * the recovery layer must make about it.
 *
 * WHY THIS IS ITS OWN OWNER
 * -------------------------
 * The durable autosave hands a recovered draft back through `onRecover`. When a
 * room owns the visible editor, adopting that value into `draft` would make it
 * look restored in React state while the editor kept showing the room's
 * content, so the honest move is to HOLD it and offer an explicit import — and
 * `holdRecoveredDraft` is asked that question by the persistence owner while
 * persistence is being constructed.
 *
 * That is a dependency edge, not a coincidence: persistence may not adopt a
 * recovered draft without asking this owner first. So the state lives here, is
 * created before persistence, and is injected into it — rather than being
 * declared in a component that only later learns whether persistence wanted it.
 */
export interface HeldDeviceDraft {
  /** The question the recovered draft belongs to. */
  questionId: string;
  draft: QuestionRevision;
}

export interface AuthoringDeviceDraftRecovery {
  /** The held draft, for the explicit import surface. Null when nothing is held. */
  recovery: HeldDeviceDraft | null;
  /**
   * Hold a recovered draft instead of adopting it. Returns false when no room
   * owns the editor, in which case the caller adopts it directly.
   */
  hold: (examQuestionId: string, draft: QuestionRevision) => boolean;
  /** The author decided (kept or discarded); nothing is held any more. */
  clear: () => void;
}

export function useAuthoringDeviceDraftRecovery({
  roomOwnsEditor,
  selectedExamQuestionId,
}: {
  roomOwnsEditor: boolean;
  selectedExamQuestionId: string | null;
}): AuthoringDeviceDraftRecovery {
  const [recovery, setRecovery] = useState<HeldDeviceDraft | null>(null);

  const hold = useCallback(
    (examQuestionId: string, draft: QuestionRevision): boolean => {
      if (!roomOwnsEditor) return false;
      setRecovery({ questionId: examQuestionId, draft });
      return true;
    },
    [roomOwnsEditor]
  );
  const clear = useCallback(() => setRecovery(null), []);

  // A held draft belongs to the question it was recovered for: moving to
  // another question drops it rather than offering an import into one it never
  // described.
  useEffect(() => {
    setRecovery((current) =>
      current && current.questionId !== selectedExamQuestionId ? null : current
    );
  }, [selectedExamQuestionId]);

  return { recovery, hold, clear };
}

/**
 * The conflict and recovery surface: what the workspace shows when the server
 * and this client disagree, and what the author can do about it.
 *
 * It owns four things that used to be scattered through the render body:
 *
 *   1. the LAZY remote document — fetched when Review opens, never from an
 *      event payload (an event carries ids and revisions, not content), and
 *      fed back into the divergence store as the remote side of the compare;
 *   2. the compare itself: `base` is the document the author STARTED FROM,
 *      taken from the divergence entry that recorded it and mirrored into the
 *      prompt-free baseline seam. Reading the live query instead would turn the
 *      three-way compare into a two-way diff, and a same-field conflict could
 *      never be reported as one;
 *   3. the three notices (deleted remotely / published / structural move);
 *   4. the seven recovery actions — use latest, copy my work, retry (one action
 *      for both writers), export the local prompt, discard a preserved copy,
 *      copy/keep/discard the held device draft, and open the replacement draft.
 *
 * `local` is always the workspace draft: the editable document has exactly one
 * owner, and this hook does not become a second one.
 */
export interface AuthoringConflictRecoveryInput {
  examId: string;
  queryClient: QueryClient;
  selectedExamQuestionId: string | null;
  /** Named in the structural-move copy. */
  selectedModuleTitle: string | null;
  divergence: ReturnType<typeof useQuestionDivergence>["divergence"];
  diverged: boolean;
  /** The HTTP question: the seed for `base` until a divergence records one. */
  baseQuestion: QuestionRevision | null;
  dispatchDivergence: ReturnType<typeof useQuestionDivergence>["dispatch"];
  draft: QuestionRevision | null;
  setDraft: (revision: QuestionRevision | null) => void;
  /** Persistence's seam: the last server-acknowledged revision. */
  promptFreeBaselineRef: MutableRefObject<QuestionRevision | null>;
  /** The open question's query, for a refetch at click time. */
  questionQuery: ReturnType<typeof useExamQuestion>;
  /** The fenced/diverged save state clears with a resolution. */
  acknowledgeServerRevision: () => void;
  retrySave: (revision: QuestionRevision) => void;
  /** Server-granted AND kill-switched: the compare affordance may be withheld. */
  conflictCompareEnabled: boolean;
  publishedFrozen: boolean;
  coeditRoomOpen: boolean;
  coeditUiActive: boolean;
  coeditDisplayStatus: CoeditSaveDisplayStatus | null;
  /** The prompt room, for its own retry. */
  coedit: UsePromptCoeditingResult;
  /** Whatever local work a room that cannot continue has preserved. */
  coeditRecovery: WorkspaceRecovery | CoeditRecovery | null;
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  deviceRecovery: AuthoringDeviceDraftRecovery;
  setNotice: (message: string | null) => void;
  /**
   * The FENCED-write routing rule's inputs, grouped because they exist for it:
   * a refusal that arrives over HTTP with no socket at all (delivery off,
   * degraded, or a POST in flight when a collaborator's save committed) is the
   * same product condition as a socket-delivered newer revision, so it is
   * routed into this surface rather than stranded on a manual "reload and
   * reapply" instruction.
   */
  fence: {
    /** `conflict` is this client's own refusal, not a generic failure. */
    saveStatus: QuestionSaveStatus;
    /** Read at resolution time, never as a dependency (see the hook body). */
    draftRevisionRef: MutableRefObject<number | null>;
    /** Whether the author has unsaved work, read at resolution time. */
    pendingChangesRef: MutableRefObject<boolean>;
    /** Restored on close, so a programmatic open does not move focus. */
    openerRef: RefObject<HTMLElement | null>;
  };
}

export interface AuthoringConflictRecovery {
  /** The remote side of the compare, for the sheet's three columns. */
  baseDocument: QuestionRevision | null;
  remoteDocument: QuestionRevision | null;
  classifications: ReturnType<typeof classifyQuestionFields>;
  remoteAuthorName: string | null;
  activeRaceNotice: string | null;
  showLegacyDivergenceSurface: boolean;
  handleUseLatest: (remote: QuestionRevision) => Promise<void>;
  copyMyWork: () => Promise<void>;
  handleRetrySave: () => void;
  copyCoeditPrompt: () => Promise<void>;
  discardCoeditLocalCopy: () => void;
  copyDeviceDraft: () => Promise<void>;
  keepDeviceDraft: () => void;
  discardDeviceDraft: () => void;
  /** Open the replacement draft a room swap produced. */
  openCurrentDraft: () => void;
  /** Open Review. */
  reviewCoeditChanges: () => void;
  /** The Review sheet's own state, which the routing rule above drives. */
  conflictOpen: boolean;
  setConflictOpen: (open: boolean) => void;
  noticeDismissed: boolean;
  setNoticeDismissed: (dismissed: boolean) => void;
  /** Open Review, capturing the opener for focus restore. */
  openReview: () => void;
}

export function useAuthoringConflictRecovery({
  examId,
  queryClient,
  selectedExamQuestionId,
  selectedModuleTitle,
  divergence,
  diverged,
  baseQuestion,
  dispatchDivergence,
  draft,
  setDraft,
  promptFreeBaselineRef,
  questionQuery,
  acknowledgeServerRevision,
  retrySave,
  conflictCompareEnabled,
  publishedFrozen,
  coeditRoomOpen,
  coeditUiActive,
  coeditDisplayStatus,
  coedit,
  coeditRecovery,
  workspaceCollaboration,
  deviceRecovery,
  setNotice,
  fence,
}: AuthoringConflictRecoveryInput): AuthoringConflictRecovery {
  // The Review sheet's own open/dismissed state belongs here rather than in the
  // workspace: it is what the routing rule below sets, what the actions here
  // clear, and what the sheet renders. Keeping it outside meant the rule and
  // the state it drives lived in two files.
  const [conflictOpen, setConflictOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const conflictOpenerRef = fence.openerRef;
  // A fresh divergence is a fresh notice: never leave the banner dismissed from
  // a previous conflict. It lives with the state it resets and the surface that
  // reads it, so a reader answering "is this notice showing?" reads one owner.
  const remoteRevision = divergence?.remoteRevision ?? null;
  useEffect(() => {
    setNoticeDismissed(false);
  }, [selectedExamQuestionId, remoteRevision]);
  // The question whose fence has already been routed, so one refusal produces
  // one Review opening instead of one per render of the save status.
  const conflictRoutedRef = useRef<string | null>(null);

  const openReview = useCallback(() => {
    // Captured for focus restore on close. Opening the sheet programmatically
    // must not move focus: the surface is non-modal and the author keeps
    // typing where they were.
    conflictOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConflictOpen(true);
  }, [conflictOpenerRef]);

  /**
   * The fenced-write routing rule.
   *
   * A FENCED write is the same product condition as a socket-delivered newer
   * revision — the author is dirty and a newer revision exists — but it arrives
   * with no socket at all. Route it into the same divergence state and the same
   * Review surface the socket path uses. This fetch is what turns the fence
   * into a fact: HTTP, not the event stream, is authoritative.
   *
   * The draft revision is read from a ref at resolution time, never as a
   * dependency: the draft arriving is what triggers this fetch, so depending on
   * it would tear the effect down and cancel the very request it just issued.
   */
  useEffect(() => {
    if (fence.saveStatus !== "conflict") {
      conflictRoutedRef.current = null;
      return undefined;
    }
    if (!selectedExamQuestionId || conflictRoutedRef.current === selectedExamQuestionId) {
      return undefined;
    }
    conflictRoutedRef.current = selectedExamQuestionId;
    let cancelled = false;
    void assessmentAuthoringApi
      .getQuestion(selectedExamQuestionId)
      .then((detail) => {
        if (cancelled) return;
        const remoteRevision = detail.question.revision;
        // 409 also covers draft_replaced / draft_not_editable. Only a genuinely
        // newer revision is a divergence; anything else keeps its own
        // explanation rather than being dressed up as a newer version.
        const attemptedRevision = fence.draftRevisionRef.current;
        if (attemptedRevision !== null && remoteRevision <= attemptedRevision) return;
        dispatchDivergence({
          type: "REMOTE_REVISION",
          examQuestionId: selectedExamQuestionId,
          remoteRevision,
          hasPendingChanges: fence.pendingChangesRef.current,
        });
        openReview();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    fence.draftRevisionRef,
    fence.pendingChangesRef,
    fence.saveStatus,
    selectedExamQuestionId,
    dispatchDivergence,
    openReview,
  ]);

  // The remote document is fetched LAZILY, only when Review opens, and never
  // from an event payload: an event carries ids + revisions, not content.
  const [remoteDocument, setRemoteDocument] = useState<QuestionRevision | null>(null);
  useEffect(() => {
    if (!conflictOpen || !selectedExamQuestionId) {
      setRemoteDocument(null);
      return undefined;
    }
    let cancelled = false;
    void assessmentAuthoringApi
      .getQuestion(selectedExamQuestionId)
      .then((detail) => {
        if (cancelled) return;
        setRemoteDocument(detail.question);
        dispatchDivergence({
          type: "REMOTE_DOCUMENT",
          examQuestionId: selectedExamQuestionId,
          remote: detail.question,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conflictOpen, selectedExamQuestionId, dispatchDivergence]);

  // `base` is the document the author STARTED FROM — taken from the divergence
  // entry that recorded it, not from the live query. Using the query would
  // silently use the newest server revision as the base as soon as anything
  // refetched, turning the three-way compare into a two-way diff in which a
  // same-field conflict can never be reported as one.
  const baseDocument = divergence?.baseDocument ?? baseQuestion;
  useEffect(() => {
    // The prompt-free field diff and the prompt-only gate both measure against
    // the last server-acknowledged revision. `baseDocument` is exactly that: the
    // divergence store advances it on every acknowledgement, and a fresh
    // question load seeds it.
    promptFreeBaselineRef.current = baseDocument;
  }, [baseDocument, promptFreeBaselineRef]);
  const classifications = useMemo(() => {
    if (!conflictCompareEnabled) return [];
    if (!baseDocument || !draft || !remoteDocument) return [];
    return classifyQuestionFields({ base: baseDocument, local: draft, remote: remoteDocument });
  }, [conflictCompareEnabled, baseDocument, draft, remoteDocument]);

  const handleUseLatest = useCallback(
    async (remote: QuestionRevision) => {
      if (!selectedExamQuestionId) return;
      // Refetch at CLICK time so a save that landed while the sheet was open is
      // not silently discarded in favour of the snapshot we opened with.
      const refreshed = await questionQuery.refetch().catch(() => null);
      const latest = refreshed?.data?.question ?? remote;
      // Install only AFTER the authoritative revision is in hand: the local
      // draft is never dropped before the replacement is rendered.
      setDraft(normalizeQuestionRevision(latest));
      dispatchDivergence({
        type: "RESOLVE_USE_LATEST",
        examQuestionId: selectedExamQuestionId,
        remote: latest,
      });
      // Nothing is left to send, so the fenced/diverged save state must clear
      // with it — otherwise the save area keeps offering a Retry for a payload
      // the client already knows is stale, on a conflict that no longer exists.
      acknowledgeServerRevision();
      setConflictOpen(false);
      setNoticeDismissed(false);
    },
    [
      selectedExamQuestionId,
      questionQuery,
      dispatchDivergence,
      setDraft,
      acknowledgeServerRevision,
      setConflictOpen,
      setNoticeDismissed,
    ]
  );

  const remoteAuthorName = divergence?.remoteAuthor?.displayName ?? null;
  const activeRaceNotice = divergence?.deletedRemotely
    ? DELETION_COPY.body(remoteAuthorName ?? "Another author")
    : publishedFrozen
      ? PUBLISH_COPY.body
      : divergence?.movedRemotely
        ? STRUCTURAL_COPY.movedTo(selectedModuleTitle ?? "another module")
        : divergence?.bulkChangedRemotely
          ? STRUCTURAL_COPY.orderUpdated
          : null;
  const structuralDivergence = Boolean(
    divergence?.deletedRemotely || divergence?.movedRemotely || divergence?.bulkChangedRemotely
  );
  const showLegacyDivergenceSurface =
    Boolean(diverged) && (!coeditRoomOpen || structuralDivergence);

  const copyMyWork = useCallback(async () => {
    if (!draft) return;
    const text = JSON.stringify(draft, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
      setNotice("Your current question draft was copied to the clipboard.");
    } catch {
      setNotice("Copy failed — select the text in Review and copy it manually.");
    }
  }, [draft, setNotice]);

  // One retry action for both writers: the failing half is the one that needs
  // re-driving, and a retry that silently addressed the other half would look
  // like it did nothing.
  const handleRetrySave = useCallback(() => {
    if (workspaceCollaboration && coeditDisplayStatus === "error") {
      workspaceCollaboration.retry();
      return;
    }
    if (coeditUiActive && (coeditDisplayStatus === "error" || coedit.error !== null)) {
      coedit.retry();
      return;
    }
    if (draft) retrySave(draft);
  }, [workspaceCollaboration, coeditDisplayStatus, coeditUiActive, coedit, draft, retrySave]);

  // Recovery affordance for a room that cannot continue: the local prompt is
  // exportable before a replacement draft is opened, and it is never silently
  // thrown away ("Offline and recovery behavior", docs/sat-authoring-coedit.md).
  const copyCoeditPrompt = useCallback(async () => {
    // A preserved pre-compaction copy is the local work at risk when one exists:
    // it is exported by its own byte-exact payload rather than the prompt-shaped
    // projection, which belongs to the live room.
    const staleCaches = coeditRecovery?.exportStaleCache() ?? null;
    const exported = staleCaches ?? coeditRecovery?.exportPrompt() ?? null;
    if (exported === null) {
      setNotice("There is no local prompt copy to export yet.");
      return;
    }
    try {
      await navigator.clipboard?.writeText(JSON.stringify(exported, null, 2));
      setNotice("The local prompt was copied to the clipboard.");
    } catch {
      setNotice("Copy failed — copy the prompt from the editor before leaving.");
    }
  }, [coeditRecovery, setNotice]);

  // Discarding a preserved copy is the author's decision, taken from the
  // recovery surface's confirm step; nothing else in the workspace removes
  // local work.
  const discardCoeditLocalCopy = useCallback(() => {
    void coeditRecovery?.discardStaleCache().catch(() => undefined);
  }, [coeditRecovery]);

  const copyDeviceDraft = useCallback(async () => {
    const recovered = deviceRecovery.recovery?.draft;
    if (!recovered) return;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(recovered, null, 2));
      setNotice("The recovered question was copied to the clipboard.");
    } catch {
      setNotice("Copy failed — keep the recovered changes here before leaving.");
    }
  }, [deviceRecovery.recovery, setNotice]);

  const keepDeviceDraft = useCallback(() => {
    const recovered = deviceRecovery.recovery;
    if (!recovered || !workspaceCollaboration || recovered.questionId !== selectedExamQuestionId)
      return;
    const snapshot = workspaceCollaboration.workspaceSnapshot;
    if (
      !snapshot.ready ||
      snapshot.readOnly ||
      workspaceCollaboration.lifecyclePhase !== "active"
    ) {
      setNotice(
        "The shared draft is not editable right now. Your recovered changes are still available."
      );
      return;
    }
    const path = `question/${recovered.questionId}`;
    const currentScalar = snapshot.values[`${path}/scalar`];
    const isPretest = isQuestionWorkspaceScalar(currentScalar)
      ? currentScalar.isPretest
      : questionQuery.data?.isPretest;
    workspaceCollaboration.setValue(
      `${path}/scalar`,
      questionWorkspaceScalar(recovered.draft, isPretest)
    );
    workspaceCollaboration.setRichField(`${path}/prompt`, recovered.draft.prompt);
    workspaceCollaboration.setRichField(`${path}/stimulus`, recovered.draft.stimulus);
    workspaceCollaboration.setRichField(`${path}/rationale`, recovered.draft.rationale);
    if (recovered.draft.answer.kind === "single_choice") {
      for (const option of recovered.draft.answer.options) {
        workspaceCollaboration.setRichField(`${path}/choice/${option.id}`, option.content);
      }
    }
    setDraft(recovered.draft);
    acknowledgeServerRevision();
    deviceRecovery.clear();
    setNotice("Your recovered changes were added to the shared draft.");
  }, [
    deviceRecovery,
    workspaceCollaboration,
    selectedExamQuestionId,
    questionQuery.data?.isPretest,
    setDraft,
    acknowledgeServerRevision,
    setNotice,
  ]);

  const discardDeviceDraft = useCallback(() => {
    if (!deviceRecovery.recovery) return;
    acknowledgeServerRevision();
    deviceRecovery.clear();
    setNotice("The recovered device draft was discarded.");
  }, [deviceRecovery, acknowledgeServerRevision, setNotice]);

  const openCurrentDraft = useCallback(() => {
    setConflictOpen(false);
    setNoticeDismissed(false);
    // The draft under us changed: refresh the tree and everything derived
    // from it, not just the shell.
    void authoringEffects.shellChanged(queryClient, examId);
    if (workspaceCollaboration) workspaceCollaboration.retry();
    else coedit.retry();
  }, [setConflictOpen, setNoticeDismissed, queryClient, examId, workspaceCollaboration, coedit]);

  const reviewCoeditChanges = useCallback(() => {
    setConflictOpen(true);
  }, [setConflictOpen]);

  return {
    baseDocument,
    remoteDocument,
    classifications,
    remoteAuthorName,
    activeRaceNotice,
    showLegacyDivergenceSurface,
    handleUseLatest,
    copyMyWork,
    handleRetrySave,
    copyCoeditPrompt,
    discardCoeditLocalCopy,
    copyDeviceDraft,
    keepDeviceDraft,
    discardDeviceDraft,
    openCurrentDraft,
    reviewCoeditChanges,
    conflictOpen,
    setConflictOpen,
    noticeDismissed,
    setNoticeDismissed,
    openReview,
  };
}
