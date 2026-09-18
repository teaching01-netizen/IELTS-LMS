import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  QuestionRevision,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import {
  useAssessmentValidation,
  useBatchCreateAssessmentQuestions,
  useBulkAssessmentQuestions,
  useCreateAssessmentQuestion,
  useDuplicateAssessmentQuestion,
  useEnsureDraftShell,
  useExamQuestion,
  useLoadSatSampleExam,
  useReorderAssessmentQuestions,
} from "../api/assessmentQueries";
import { authoringEffects } from "../api/authoringQueryEffects";
import { useAuthoringShellLifecycle } from "../application/authoringShellLifecycle";
import { AuthoringLifecycleSurface } from "./AuthoringLifecycleSurface";
import { combineSaveStatus } from "./spine/coeditSaveTruth";
import {
  authorForActor,
  occupantsOf,
  useAuthoringRealtime,
  useQuestionDivergence,
  type AuthoringPresence,
  type DivergenceEvent,
} from "../realtime";
import { RemoteUpdateNotice } from "./collaboration/RemoteUpdateNotice";
import { ConflictResolver } from "./collaboration/ConflictResolver";
import { CollaboratorStack } from "./collaboration/CollaboratorStack";
import { CollaborationLiveRegion } from "./collaboration/CollaborationLiveRegion";
import { CoeditRecoverySurface } from "./collaboration/CoeditRecoverySurface";
import { DeviceDraftRecoverySurface } from "./collaboration/DeviceDraftRecoverySurface";
import { QuestionPresenceBadge } from "./collaboration/QuestionPresenceBadge";
import { PRESENCE_COPY } from "./collaboration/collaborationCopy";
import { validateSatQuestion } from "../providers/sat/satProvider";
import { QuestionImportSheet } from "../import/QuestionImportSheet";
import { SatWorkbookImportSheet } from "../import/SatWorkbookImportSheet";
import { SampleExamLoadDialog } from "./SampleExamLoadDialog";
import { WorkbookImportUndoBanner } from "./WorkbookImportUndoBanner";
import { useOptionalAuthSession } from "../../auth/api/authSession";
import { buildStaffDraftKey } from "../../../utils/staffDraftKey";
import { AuthoringConfirmDialog, restoreAuthoringFocus } from "./authoringPrimitives";
import {
  EditorSkeleton,
  EmptyEditor,
  IssuesPane,
  QuestionLoadError,
} from "./authoringWorkspaceSurfaces";
import { useAuthoringPersistence } from "./useAuthoringPersistence";
import { useAuthoringWorkbook } from "./useAuthoringWorkbook";
import { useAuthoringQuestionCommands } from "./useAuthoringQuestionCommands";
import { useAuthoringNavigationGuard } from "./useAuthoringNavigationGuard";
import { useAuthoringDraftLifecycle } from "./useAuthoringDraftLifecycle";
import { useAuthoringKeyboard, type WorkspaceMode } from "./useAuthoringKeyboard";
import { useAuthoringSelection } from "./useAuthoringSelection";
import { useCoeditRecoveryAndPresence } from "./useCoeditRecoveryAndPresence";
import { coeditRoomShouldWarnBeforeUnload } from "./collaboration/coeditNavigationGate";
import { useWorkspaceProjectionWrites } from "./useWorkspaceProjectionWrites";
import { serverQuestionDocument, useAuthoringDraft } from "./useAuthoringDraft";
import { useAuthoringEdits } from "./useAuthoringEdits";
import { SpineLayout } from "./spine/SpineLayout";
import { SpineHeader } from "./spine/SpineHeader";
import { SpinePreviewSheet } from "./spine/SpinePreviewSheet";
import { SpineQueueSheet } from "./spine/SpineQueueSheet";
import { QuestionQueueRail } from "./spine/QuestionQueueRail";
import { ExamOverviewPane } from "./spine/ExamOverviewPane";
import { buildExamOverview } from "./spine/overviewModel";
import { QuestionJumpPalette } from "./spine/QuestionJumpPalette";
import { ShortcutHelpDialog } from "./spine/ShortcutHelpDialog";
import { SpineQuestionView } from "./spine/SpineQuestionView";
import { useSatAuthoringCollaboration, type SatWorkspaceCommandName } from "../realtime/coedit";
import { useAuthoringCoeditSession } from "./useAuthoringCoeditSession";
import { useAuthoringCollaborationBridge } from "./useAuthoringCollaborationBridge";
import { useAuthoringCollaborationPresence } from "./useAuthoringCollaborationPresence";
import {
  useAuthoringConflictRecovery,
  useAuthoringDeviceDraftRecovery,
} from "./useAuthoringConflictRecovery";
import { resolveAuthoringField } from "./spine/readinessFamilies";
import { Inspector } from "./spine/Inspector";
import { useRailWidth } from "./spine/RailResizer";
import { useAuthoringOverlays } from "./useAuthoringOverlays";
import { SaveCluster } from "./spine/SaveCluster";
import { flashAuthoringField } from "./spine/TargetFlash";
import { motion, useReducedMotion } from "motion/react";
import { spineMotion } from "@/src/shared/motion";

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

export function AuthoringWorkspace({ examId, examTitle }: AuthoringWorkspaceProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authSession = useOptionalAuthSession();
  const workspaceCollaboration = useSatAuthoringCollaboration();
  const announceWorkspaceCommand = useCallback(
    (command: SatWorkspaceCommandName, payload: Record<string, unknown>) => {
      workspaceCollaboration?.publishCommand(command, payload);
    },
    [workspaceCollaboration],
  );
  const staffActorId = authSession?.session?.user.id ?? null;
  // Verified role path: useOptionalAuthSession() from ../../auth/api/authSession
  // (re-export of src/features/auth/authSession.tsx) -> session.user.role:
  // AuthUserRole = "admin" | "builder" | "proctor" | "grader" | "student"
  // (src/services/authService.ts:12). Only admin/builder may open a draft;
  // grader/proctor/student (+ signed-out null) are preview/read-only here.
  const sessionRole = authSession?.session?.user.role ?? null;
  const canOpenDraft = sessionRole === "admin" || sessionRole === "builder";
  const shellLifecycle = useAuthoringShellLifecycle(examId);
  const ensureDraft = useEnsureDraftShell(examId);
  const createQuestion = useCreateAssessmentQuestion(examId);
  const batchCreate = useBatchCreateAssessmentQuestions(examId);
  const duplicateQuestion = useDuplicateAssessmentQuestion(examId);
  const reorderQuestions = useReorderAssessmentQuestions(examId);
  const bulkQuestions = useBulkAssessmentQuestions(examId);
  const validation = useAssessmentValidation(examId);
  const loadSampleExam = useLoadSatSampleExam(examId);
  // The open question's draft is one owner with one mutation surface (see
  // `useAuthoringDraft`): nothing else installs a revision or clears the
  // document, and the rule for when the server may replace local work lives
  // there beside the guards it reads.
  const {
    draft,
    setDraft,
    clearDocument,
    adoptServerDocumentIfPermitted,
    draftRevisionRef,
    draftRef,
    draftProtectedRef,
    recoveredQuestionDraftKeyRef,
  } = useAuthoringDraft();
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("build");
  // Persistence state (the freeze guards, the pause flag, the refetch guard, the
  // draft mirror, and the refusal/notice channel) is owned by
  // `useAuthoringPersistence` and destructured below; the seams outside
  // persistence read it from there.
  // The presence roster is the ONLY source of collaborator names (the event
  // envelope carries a bare actor id). Kept in a ref so the realtime seams —
  // registered before presence is mounted — read it at call time without
  // re-subscribing on every roster change.
  const presenceRosterRef = useRef<readonly AuthoringPresence[]>([]);
  // Declared here rather than beside the hook that owns it, because `saveDraft`
  // (defined below) must dispatch SERVER_ACK on its own success, and the
  // realtime seams — also declared earlier than the hook — route through it.
  // The effect that keeps it current lives with the hook.
  const divergenceDispatchRef = useRef<(event: DivergenceEvent) => void>(() => undefined);
  // The Review sheet's opener, for focus restore on close. Declared here because
  // the sheet is rendered here and takes it as a prop; it is WRITTEN by the
  // conflict owner, which owns the rule that opens the sheet at all.
  const conflictOpenerRef = useRef<HTMLElement | null>(null);
  // Every overlay the workspace can open is owned by one hook, which also owns
  // the overlay-stack ordering rule and the inspector's modal/sheet behavior.
  // The workspace keeps the NAMES it already used, so this reads as composition
  // rather than as new wiring.
  const {
    overlayStack,
    previewOpen,
    setPreviewOpen,
    importOpen,
    setImportOpen,
    workbookImportOpen,
    setWorkbookImportOpen,
    sampleDialogOpen,
    setSampleDialogOpen,
    jumpPaletteOpen,
    setJumpPaletteOpen,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    questionListOpen,
    setQuestionListOpen,
    inspectorOpen,
    inspectorModal,
    openInspector,
    closeInspector,
    deleteTarget,
    setDeleteTarget,
  } = useAuthoringOverlays();
  const rail = useRailWidth();
  const [compactViewport, setCompactViewport] = useState(false);
  const [keepMetadataForNext, setKeepMetadataForNext] = useState(true);
  const [focusField, setFocusField] = useState<string | null>(null);
  // Which FIELD an inspector shortcut belongs to is a workspace concern (the
  // deep-link path names fields, not overlays), so the rule stays here and asks
  // the overlays hook to open the inspector.
  const requestField=useCallback((path:string|null)=>{const field=resolveAuthoringField(path);if(['domain','skill','difficulty','tags','accessibility'].includes(field))openInspector();setFocusField(field);},[openInspector]);
  const questionSheetFocusRef = useRef<HTMLElement | null>(null);
  const inspectorSheetFocusRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  // The lifecycle hook owns transport mapping (READY / NO_DRAFT /
  // EXAM_NOT_FOUND / FORBIDDEN / error). Everything below this line is either
  // a real shell or the lifecycle surface; no status code is inspected here.
  const shellState = shellLifecycle.state;
  const shell = shellState.kind === "ready" ? shellState.shell : undefined;
  // Which module and question the author is on (plus the queue's filter and row
  // multi-selection) is one owner. It also owns the two rules that used to be
  // effects here: the deep-link adoption and the "selection must still exist in
  // this shell" fallback. The workspace passes the draft reset back in, because
  // the draft is not selection state.
  const {
    selectedModuleId,
    setSelectedModuleId,
    selectedExamQuestionId,
    setSelectedExamQuestionId,
    selectedSection,
    selectedModule,
    selectedModuleIndex,
    allQuestions,
    entryQuestionFor,
    selectedIds,
    setSelectedIds,
    selectionAnchorRef,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    clearRowSelection,
  } = useAuthoringSelection({
    shell,
    onQuestionAdopted: () => clearDocument(),
    onDeepLinkField: requestField,
  });
  const questionQuery = useExamQuestion(selectedExamQuestionId);
  const questionDraftKey = selectedExamQuestionId
    ? buildStaffDraftKey(staffActorId, "assessment-question", examId, selectedExamQuestionId)
    : null;
  const workspaceQuestionPath = selectedExamQuestionId
    ? `question/${selectedExamQuestionId}`
    : null;
  // The recovered-device-draft holder is created BEFORE persistence, because
  // persistence may not adopt a recovered draft without asking it first: the
  // question "do you want to hold this?" has to be answerable while the
  // persistence owner is being built, and the answer is what gives an explicit
  // import somewhere to live.
  const deviceRecovery = useAuthoringDeviceDraftRecovery({
    roomOwnsEditor: workspaceCollaboration !== null,
    selectedExamQuestionId,
  });

  const shellVersionId = shell?.versionId ?? null;
  const shellVersionRevision = shell?.versionRevision ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      const isCompact = media.matches;
      setCompactViewport(isCompact);
      if (!isCompact) setQuestionListOpen(false);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [setQuestionListOpen]);

  const selectedQuestionIssues = draft
    ? validateSatQuestion(draft.metadata.sectionKey, draft)
    : [];
  const totalAuthored = allQuestions.length;
  const totalErrors = allQuestions.reduce(
    (sum, question) => sum + (question.readiness.status === "error" ? 1 : 0),
    0
  );

  useEffect(() => {
    if (!draft || !focusField) return;
    let frame=0,attempts=0;
    const focus=()=>{
      const target=document.querySelector<HTMLElement>(`[data-authoring-field="${focusField}"]`);
      if(!target&&attempts++<3){frame=window.requestAnimationFrame(focus);return;}
      if(target){target.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'nearest'});flashAuthoringField(focusField);
        const control=target.matches('input,textarea,select,[contenteditable=true]')?target:target.querySelector<HTMLElement>('input,textarea,select,[contenteditable=true]')??target.querySelector<HTMLElement>('button')??target;
        control.focus({preventScroll:true});setFocusField(null);}
    };
    frame=window.requestAnimationFrame(focus);return()=>window.cancelAnimationFrame(frame);
  },[draft,focusField,inspectorOpen,inspectorModal,reduceMotion]);

  useEffect(() => {
    if (!selectedModule || selectedModuleIndex < 0) return;
    for (const index of [selectedModuleIndex - 1, selectedModuleIndex + 1]) {
      const question = selectedModule.questions[index];
      if (!question) continue;
      void authoringEffects.questionPrefetched(queryClient, question.examQuestionId, () =>
        assessmentAuthoringApi.getQuestion(question.examQuestionId)
      );
    }
  }, [queryClient, selectedModule, selectedModuleIndex]);

  // Prompt co-editing (2026-09-13 design). The workspace is the composition
  // owner: it mounts exactly one provider for the selected question and
  // threads the binding into the spine as a PROP. Nothing below this level
  // imports Yjs or Hocuspocus. WHICH gates pass and which writer owns a field
  // is the collaboration bridge's business (see
  // `useAuthoringCollaborationBridge`), not the render body's.
  const { coedit, coeditEnabled, coeditRoomOpen, coeditUiActive, workspaceUiActive } =
    useAuthoringCoeditSession({
      selectedExamQuestionId,
      writeCapableRole: canOpenDraft,
      workspaceCollaboration,
    });
  const coeditSession = coedit.session;

  // A saved revision installs into both projections (the queue row's summary
  // and the question detail). The projection policy — including how a summary
  // is re-derived from a revision — belongs to the effects owner; the workspace
  // only reports the fact.
  const updateSummaryCache = useCallback(
    (examQuestionId: string, saved: QuestionRevision) => {
      authoringEffects.questionSaved(queryClient, examId, examQuestionId, saved);
    },
    [examId, queryClient]
  );

  // One owner for draft persistence: which writer owns the open question's
  // fields, the write pipeline, the save truth, and durability before a move.
  // Every persistence ref lives there now, so the declaration order of this
  // component no longer decides when a save path can read them.
  const persistence = useAuthoringPersistence({
    examId,
    queryClient,
    draft,
    setDraft,
    selectedExamQuestionId,
    questionDraftKey,
    workspaceRoomActive: workspaceUiActive,
    promptRoomActive: coeditEnabled && coedit.session !== null,
    workspaceCollaboration,
    divergenceDispatchRef,
    applySavedRevision: updateSummaryCache,
    holdRecoveredDraft: deviceRecovery.hold,
    recoveredQuestionDraftKeyRef,
  });
  const {
    mode: persistenceMode,
    navigationError,
    setNavigationError,
    mutationFrozenRef,
    deletedRemotelyRef,
    networkSavePausedRef,
    promptFreeBaselineRef,
    flushBeforeNavigation,
    flushBeforeRouteChange,
  } = persistence;

  // A shell that replaced the exam's questions WHOLESALE (SAT workbook import,
  // its undo, the sample exam) leaves the open draft and every row-scoped piece
  // of local selection pointing at questions that no longer exist. One named
  // transaction, used by all three, instead of three near-identical blocks.
  const applyReplacedShell = useCallback(
    (nextShell: AssessmentAuthoringShell) => {
      const firstModule = nextShell.sections[0]?.modules[0] ?? null;
      setWorkspaceMode("build");
      clearRowSelection();
      clearDocument();
      setSelectedModuleId(firstModule?.id ?? null);
      setSelectedExamQuestionId(firstModule?.questions[0]?.examQuestionId ?? null);
    },
    [clearRowSelection, setSelectedExamQuestionId, setSelectedModuleId]
  );

  // The workbook import transaction (stage → commit → undo availability) owns
  // its own state; the selection reset it triggers is the workspace's, injected
  // above so no wholesale replacement invents its own version of it.
  const {
    baseline: workbookBaseline,
    undo: workbookUndo,
    undoBusy: workbookUndoBusy,
    openImport: openWorkbookImport,
    closeImport: closeWorkbookImport,
    handleCommitted: handleWorkbookCommitted,
    withdrawUndo: withdrawWorkbookUndo,
    undoImport: handleWorkbookUndo,
  } = useAuthoringWorkbook({
    examId,
    queryClient,
    shellVersionId,
    shellVersionRevision,
    saveStatus: persistence.status,
    flushBeforeNavigation,
    onQuestionsReplaced: applyReplacedShell,
    announce: announceWorkspaceCommand,
    setNavigationError,
    setImportOpen: setWorkbookImportOpen,
  });

  // Which capabilities are live, whether the open question is dirty for the
  // transport, and WHICH writer owns a field are the collaboration bridge's
  // business; the workspace only threads them into the mount and the panels.
  const {
    setServerCapabilities,
    effectiveCapabilities,
    realtimeDeliveryEnabled,
    isQuestionDirtyForRealtime,
    promptCollaboration,
    workspaceFieldCollaboration,
  } = useAuthoringCollaborationBridge({
    workspaceUiActive,
    coeditEnabled,
    coedit,
    workspaceCollaboration,
    selectedExamQuestionId,
    workspaceQuestionPath,
    hasPendingChanges: persistence.hasPendingChanges,
  });

  // The save truth of the prompt comes from the co-edit acknowledgement, not
  // from the legacy autosave counter, which knows nothing about the CRDT. Both
  // are combined below by taking the LEAST advanced of the two, so neither can
  // claim "Saved" for work the other is still holding.

  // Phase 05 divergence: driven by the Phase 04 reconciler seams, so the
  // decision of WHAT happened stays in one place and this only records state.
  // The collaboration FREEZE is not here: it is one state owned by
  // `useCoeditRecoveryAndPresence`, which reads the same signals.

  const {
    handleRealtimeLifecycle,
    coeditSaveStatus,
    coeditRecovery,
    coeditRecoverySurface,
    coeditDisplayStatus,
    collaborationReadOnly,
    publishedFrozen,
  } = useCoeditRecoveryAndPresence({
    examId,
    queryClient,
    workspaceCollaboration,
    coedit,
    workspaceUiActive,
    coeditRoomOpen,
    coeditUiActive,
    selectedExamQuestionId,
    autosaveStatus: persistence.status,
  });

  // The question command surface: create, import, duplicate, delete, reorder,
  // bulk-change, set-pretest and save-and-advance. The mutations stay here
  // because this component is the composition root; the commands hook receives
  // them, so a test can drive the surface with fakes and no network.
  const {
    rowMutationBusy,
    rowMutationFlightRef,
    createQuestion: handleCreateQuestion,
    batchImport: handleBatchImport,
    duplicateQuestion: handleDuplicate,
    deleteQuestion: handleDelete,
    saveAndNext: handleSaveAndNext,
    reorder: handleReorder,
    bulkAction: handleBulkAction,
    setPretest: handlePretestChange,
    openIssues,
  } = useAuthoringQuestionCommands({
    identity: { examId, queryClient },
    selection: {
      selectedModuleId,
      selectedModule,
      shellSections: shell?.sections ?? [],
      selectedExamQuestionId,
      setSelectedModuleId,
      setSelectedExamQuestionId,
      setSelectedIds,
      clearSelectionAnchor: () => {
        selectionAnchorRef.current = null;
      },
    },
    draft: { draft, keepMetadataForNext, setDraft },
    collaboration: { workspaceCollaboration, coeditDisplayStatus },
    durability: {
      flushBeforeNavigation,
      commitAndAdvance: persistence.commitAndAdvance,
    },
    reporting: {
      updateSummaryCache,
      announce: announceWorkspaceCommand,
      setNavigationError,
      setWorkspaceMode,
      setImportOpen,
    },
    mutations: {
      createQuestion: (moduleId) => createQuestion.mutateAsync(moduleId),
      batchCreate: (request) => batchCreate.mutateAsync(request),
      duplicateQuestion: (request) => duplicateQuestion.mutateAsync(request),
      reorderQuestions: (request) => reorderQuestions.mutateAsync(request),
      bulkQuestions: (request) => bulkQuestions.mutateAsync(request),
      validateExam: () => validation.mutateAsync(),
    },
  });

  // The realtime client is created before these hooks exist, so the seams it
  // calls are routed through refs that the effects below keep current (the
  // divergence dispatcher is declared with the other Phase 05 refs, above, so
  // `saveDraft` can use it). This is what lets the Phase 04 reconciler drive
  // Phase 05 state without a cycle.
  const presenceFrameRef = useRef<(raw: unknown) => void>(() => undefined);
  const autosavePendingRef = useRef(false);
  useEffect(() => {
    autosavePendingRef.current = persistence.hasPendingChanges;
  }, [persistence.hasPendingChanges]);

  const authoringRealtime = useAuthoringRealtime({
    examId,
    enabled: canOpenDraft && Boolean(shell?.versionId) && realtimeDeliveryEnabled,
    draftVersionId: shell?.versionId ?? null,
    selectedExamQuestionId,
    isQuestionDirty: isQuestionDirtyForRealtime,
    onLifecycle: handleRealtimeLifecycle,
    onCapabilities: setServerCapabilities,
    onPresence: (raw) => presenceFrameRef.current(raw),
    // The reconciler only calls this for a DIRTY question: the clean path is
    // already handled by invalidation + refetch (the Phase 04 refetch-replace).
    onRemoteRevision: (examQuestionId, eventRevision, actorId) => {
      const author = authorForActor(presenceRosterRef.current, actorId);
      divergenceDispatchRef.current({
        type: "REMOTE_REVISION",
        examQuestionId,
        remoteRevision: eventRevision,
        hasPendingChanges: autosavePendingRef.current,
        ...(author ? { author } : {}),
      });
    },
    onRemoteStructuralChange: (examQuestionId, kind, actorId) => {
      const author = authorForActor(presenceRosterRef.current, actorId);
      const event: DivergenceEvent =
        kind === "deleted"
          ? { type: "REMOTE_DELETED", examQuestionId, ...(author ? { author } : {}) }
          : kind === "moved"
            ? { type: "REMOTE_MOVED", examQuestionId }
            : { type: "REMOTE_BULK_CHANGED", examQuestionId };
      divergenceDispatchRef.current(event);
    },
  });

  // The server's copy of the open question. ONE projection, read by both rules
  // that need it: the seed the editors, the room and the three-way compare are
  // authored against, and the document a refetch may install. The projection
  // itself is the draft owner's (`serverQuestionDocument`), so the two can no
  // longer disagree about what the server holds.
  const serverDocument = useMemo(
    () => serverQuestionDocument(questionQuery.data),
    [questionQuery.data]
  );
  const baseQuestion = serverDocument.revision;
  // Reading and writing the open question against the exam room: seeding,
  // remote projection onto the draft, and the local write path. The hook owns
  // the "who wrote this value" bookkeeping so no call site re-invents it.
  const {
    sharedQuestionScalar,
    publishScalar: publishWorkspaceScalar,
    handleLocalRichChange,
  } = useWorkspaceProjectionWrites({
    workspaceCollaboration,
    workspaceQuestionPath,
    selectedExamQuestionId,
    baseQuestionExamQuestionId: questionQuery.data?.examQuestionId ?? null,
    baseQuestion,
    isPretest: questionQuery.data?.isPretest,
    draft,
    draftRef,
    setDraft,
  });

  const { divergence, isDirty: isQuestionDiverged, dispatch: dispatchDivergence } =
    useQuestionDivergence(selectedExamQuestionId, {
      base: baseQuestion,
      draft,
      hasPendingChanges: persistence.hasPendingChanges,
    });
  const diverged = divergence?.status === "diverged";
  // ONE state for the open draft, derived from the conditions it used to be
  // recombined from. Published, deleted, diverged and dirty were four
  // independent booleans, each mirrored into a ref by its own effect, and every
  // reader re-decided the precedence — so the combinations the plan names as
  // impossible (`deleted remotely + editable + network saving + published`) were
  // representable, and the only reason they never surfaced was that each reader
  // happened to check its own flag first. The owner owns the precedence AND the
  // one projection of it into the refs the imperative seams read; this states
  // the conditions and the refs it projects into.
  const draftLifecycle = useAuthoringDraftLifecycle({
    conditions: {
      draft,
      saveStatus: persistence.status,
      hasPendingChanges: persistence.hasPendingChanges,
      divergedFromBase: isQuestionDiverged,
      publishedReadOnly: publishedFrozen,
      deletedRemotely: Boolean(divergence?.deletedRemotely),
    },
    seams: {
      mutationFrozenRef,
      deletedRemotelyRef,
      draftProtectedRef,
      networkSavePausedRef,
    },
  });

  // The refetch path: the trigger for the draft owner's adoption rule, declared
  // AFTER the dirty flag it consults, so a refetch that lands in the same commit
  // as the first keystroke still sees the work it must not discard. A refetch
  // may adopt the server document only when there is no unsaved local work:
  // otherwise the very fetch that reveals a newer revision would replace the
  // draft the notice beside it promises to keep, and the device copy would be
  // the only survivor — which is what turns "review the newer version" into
  // "recovered unsaved changes from this device" a reload later. The clean case
  // keeps its refetch-replace: that IS the intended freshness path (Phase 04).
  useEffect(() => {
    adoptServerDocumentIfPermitted({
      server: serverDocument,
      selectedExamQuestionId,
      draftKey: questionDraftKey,
    });
  }, [adoptServerDocumentIfPermitted, questionDraftKey, selectedExamQuestionId, serverDocument]);

  // Who else is here (roster merge, labels, the late-bound frame handler) is
  // the collaboration presence owner's business; the workspace keeps only the
  // seam that the realtime mount was built against.
  const { presence, collaborationParticipants, labelForQuestion, selectedQuestionLabel, editorHere } =
    useAuthoringCollaborationPresence({
      shell,
      selectedExamQuestionId,
      isQuestionDirty: isQuestionDiverged,
      enabled: effectiveCapabilities.presence,
      connectionState: authoringRealtime.connectionState,
      sendFrame: authoringRealtime.sendFrame,
      selfConnectionId: authoringRealtime.selfConnectionId,
      workspaceCollaboration,
      coeditUiActive,
      coeditSession,
      publishedFrozen,
      self: {
        actorId: staffActorId,
        displayName:
          authSession?.session?.user.displayName?.trim() ||
          authSession?.session?.user.email ||
          "You",
      },
      presenceFrameRef,
      presenceRosterRef,
    });
  useEffect(() => {
    divergenceDispatchRef.current = dispatchDivergence;
  }, [dispatchDivergence]);

  // The conflict and recovery surface — the lazy remote read, the three-way
  // compare and its baseline seam, the three notices, the seven recovery
  // actions, the Review sheet's open/dismissed state, and the rule that turns a
  // fenced write into a Review opening — is one owner. The workspace states the
  // facts it is given and renders the surfaces; it decides none of it.
  const {
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
  } = useAuthoringConflictRecovery({
    examId,
    queryClient,
    selectedExamQuestionId,
    selectedModuleTitle: selectedModule?.title ?? null,
    divergence,
    diverged,
    baseQuestion,
    dispatchDivergence,
    draft,
    setDraft,
    promptFreeBaselineRef,
    questionQuery,
    acknowledgeServerRevision: persistence.acknowledgeServerRevision,
    retrySave: persistence.retry,
    conflictCompareEnabled: effectiveCapabilities.conflictCompare,
    publishedFrozen,
    coeditRoomOpen,
    coeditUiActive,
    coeditDisplayStatus,
    coedit,
    coeditRecovery,
    workspaceCollaboration,
    deviceRecovery,
    setNotice: setNavigationError,
    fence: {
      saveStatus: persistence.status,
      draftRevisionRef,
      pendingChangesRef: autosavePendingRef,
      openerRef: conflictOpenerRef,
    },
  });

  const coeditHeaderPresenceSlot =
    draft && coeditUiActive ? (
      <CollaboratorStack
        participants={collaborationParticipants}
        labelFor={labelForQuestion}
        onSelectQuestion={(id) => void selectQuestion(id)}
      />
    ) : null;
  const coeditHeaderSaveSlot =
    draft && coeditUiActive && coeditDisplayStatus ? (
      <SaveCluster
        displayMode="coedit"
        announce={false}
        status={coeditDisplayStatus}
        lastSavedAt={workspaceCollaboration ? null : persistence.lastSavedAt}
        diverged={showLegacyDivergenceSurface}
        onRetry={handleRetrySave}
        onReviewConflict={workspaceCollaboration ? undefined : openReview}
      />
    ) : null;

  // Both durability barriers — in-page (`flushBeforeNavigation`) and across a
  // route change (`flushBeforeRouteChange`) — belong to the persistence owner,
  // which is the only module that knows whether a room or the legacy autosave
  // queue holds the unsaved work. This component only decides WHICH moves need
  // a barrier, and the navigation guard owns the two moves that need one.
  const { selectQuestion, selectModule } = useAuthoringNavigationGuard({
    selectedModuleId,
    selectedExamQuestionId,
    shellSections: shell?.sections ?? [],
    entryQuestionFor,
    flushBeforeNavigation,
    rowMutationFlightRef,
    hasPendingChanges: persistence.hasPendingChanges,
    isOffline: persistence.isOffline,
    saveStatus: persistence.status,
    // The room and the legacy queue are independent sources of unsaved work: a
    // room never enqueues a legacy autosave, and the legacy branch never opens
    // one. Warning from only one of them would let a browser close discard the
    // other's content.
    roomNeedsUnloadWarning: workspaceCollaboration
      ? coeditRoomShouldWarnBeforeUnload(workspaceCollaboration.workspaceSnapshot)
      : false,
    setNavigationError,
    setSelectedModuleId,
    setSelectedExamQuestionId,
    setDraft,
    setSelectedIds,
    setSearchQuery,
    setFilter,
    clearSelectionAnchor: () => {
      selectionAnchorRef.current = null;
    },
  });

  // What an edit MEANS (which single writer it reaches) and what a manual save
  // answers when the write is held back are one owner's rules, not the render
  // body's. The writers stay injected: this component is the composition root.
  const { handleChange, handleSaveNow } = useAuthoringEdits({
    writers: {
      mode: persistenceMode,
      publishWorkspaceScalar,
      scheduleAutosave: persistence.scheduleAutosave,
      promptFreeBaselineRef,
    },
    editing: { setDraft, withdrawWorkbookUndo },
    save: {
      workspaceCollaboration,
      coeditDisplayStatus,
      flushNow: persistence.flushNow,
    },
    draft,
    conflicted: draftLifecycle.conflicted,
    openReview,
    setNotice: setNavigationError,
  });

  const handleLoadSampleExam = useCallback(async () => {
    setNavigationError(null);
    if (!(await flushBeforeNavigation())) return;
    try {
      const latest = await assessmentAuthoringApi.getShell(examId);
      if (!latest.shell) {
        throw new Error("This exam has no editable draft to load the sample into yet.");
      }
      const { buildCompleteSatSample } = await import("../providers/sat/sampleExam");
      const nextShell = await loadSampleExam.mutateAsync(buildCompleteSatSample(latest.shell));
      applyReplacedShell(nextShell);
      setSampleDialogOpen(false);
      announceWorkspaceCommand("sample.loaded", { questionCount: nextShell.sections.reduce((total, section) => total + section.modules.reduce((count, module) => count + module.questions.length, 0), 0) });
    } catch (error) {
      setSampleDialogOpen(false);
      setNavigationError(
        error instanceof Error ? error.message : "The sample SAT could not be loaded."
      );
    }
  }, [
    announceWorkspaceCommand,
    applyReplacedShell,
    examId,
    flushBeforeNavigation,
    loadSampleExam,
    setSampleDialogOpen,
  ]);

  const toggleSelection = useCallback(
    (questionId: string, range: boolean) => {
      if (!selectedModule) return;
      setSelectedIds((current) => {
        const next = new Set(current);
        if (range && selectionAnchorRef.current) {
          const ids = selectedModule.questions.map((question) => question.examQuestionId);
          const from = ids.indexOf(selectionAnchorRef.current);
          const to = ids.indexOf(questionId);
          if (from >= 0 && to >= 0)
            for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1)
              next.add(ids[index]!);
        } else if (next.has(questionId)) next.delete(questionId);
        else next.add(questionId);
        selectionAnchorRef.current = questionId;
        return next;
      });
    },
    [selectedModule]
  );

  const openIssue = useCallback(
    async (issue: AssessmentValidationIssue) => {
      const match = issue.path.match(/^examQuestion:([^:]+):(.*)$/);
      if (!match) return;
      const [, questionId, fieldPath] = match;
      const target = shell?.sections
        .flatMap((section) =>
          section.modules.map((module) => ({
            moduleId: module.id,
            question: module.questions.find((question) => question.examQuestionId === questionId),
          }))
        )
        .find((candidate) => candidate.question);
      if (!target?.question || !questionId) return;
      setWorkspaceMode("build");
      setSelectedIds(new Set());
      if(await selectQuestion(questionId, target.moduleId))requestField(fieldPath??null);
    },
    [selectQuestion, shell, requestField]
  );

  // Keyboard commands are a named surface, not a rule table buried in this
  // component. The hook owns the rules and their guard order; every command it
  // can fire is a callback already declared above.
  useAuthoringKeyboard({
    draft,
    selectedExamQuestionId,
    selectedModule,
    selectedModuleIndex,
    searchInputRef,
    onModeChange: setWorkspaceMode,
    onChange: handleChange,
    onSaveNow: () => void handleSaveNow(),
    onSaveAndNext: () => void handleSaveAndNext(),
    onDuplicate: () => void handleDuplicate(),
    onSelectQuestion: (questionId) => void selectQuestion(questionId),
    onOpenInspector: () => openInspector(),
    onTogglePreview: () => setPreviewOpen((value) => !value),
    onOpenJumpPalette: () => setJumpPaletteOpen(true),
    onOpenShortcutHelp: () => setShortcutHelpOpen(true),
  });

  // The shell read is GET-only and never creates a draft. When there is no
  // shell we render the lifecycle surface, which is the ONLY place that decides
  // what NO_DRAFT vs EXAM_NOT_FOUND vs a real failure looks like. The explicit,
  // role-gated "Open draft" CTA (POST) lives there and runs once per click;
  // observers never see it and never trigger it. The ensure mutation installs
  // the shell in cache so this component re-renders with data, and never
  // auto-loops on failure.
  if (!shell) {
    return (
      <AuthoringLifecycleSurface
        state={shellState}
        canOpenDraft={canOpenDraft}
        draftOpen={{
          isPending: ensureDraft.isPending,
          error: ensureDraft.error,
          open: () => ensureDraft.mutate(),
        }}
        onRetry={() => void shellLifecycle.refetch()}
      />
    );
  }

  const moveTargets =
    selectedSection?.modules.filter((module) => module.id !== selectedModuleId) ?? [];
  const importRemaining = selectedModule
    ? Math.max(0, selectedModule.targetQuestionCount - selectedModule.questions.length)
    : 0;

  {
    const examOverview = buildExamOverview(shell.sections);
    const spineQueue = (() => {
      if (!selectedModule || !selectedSection) return null;
      if (workspaceMode === "overview") {
        return (
          <ExamOverviewPane
            overview={examOverview}
            isMutating={
              rowMutationBusy || createQuestion.isPending ||
              duplicateQuestion.isPending ||
              reorderQuestions.isPending ||
              bulkQuestions.isPending ||
              batchCreate.isPending ||
              loadSampleExam.isPending
            }
            onSelectModule={(moduleId) => {
              setWorkspaceMode("build");
              void selectModule(moduleId);
            }}
            onOpenIssueModule={(moduleId) => {
              setWorkspaceMode("build");
              void selectModule(moduleId);
              void openIssues();
            }}
          />
        );
      }
      if (workspaceMode === "build") {
        return (
          <QuestionQueueRail
            module={selectedModule}
            sections={shell.sections}
            sectionKey={selectedSection.sectionKey}
            sectionTitle={selectedSection.title}
            moveTargets={moveTargets}
            selectedQuestionId={selectedExamQuestionId}
            selectedQuestionIds={selectedIds}
            searchQuery={searchQuery}
            filter={filter}
            searchInputRef={searchInputRef}
            isMutating={
              createQuestion.isPending ||
              duplicateQuestion.isPending ||
              reorderQuestions.isPending ||
              bulkQuestions.isPending ||
              batchCreate.isPending ||
              loadSampleExam.isPending
            }
            onSearchQueryChange={setSearchQuery}
            onSelectModule={(moduleId) => void selectModule(moduleId)}
            onOpenImport={() => setImportOpen(true)}
            onFilterChange={setFilter}
            onSelectQuestion={(questionId) => void selectQuestion(questionId)}
            onDuplicateQuestion={(id)=>void handleDuplicate(id)}
            onRequestDelete={setDeleteTarget}
            onCreateQuestion={() => void handleCreateQuestion()}
            onToggleSelection={toggleSelection}
            onClearSelection={() => {
              setSelectedIds(new Set());
              selectionAnchorRef.current = null;
            }}
            onReorder={handleReorder}
            onBulkAction={handleBulkAction}
            {...(effectiveCapabilities.presence
              ? {
                  presenceSlot: (examQuestionId: string) => (
                    <QuestionPresenceBadge
                      occupants={occupantsOf(presence.occupants, examQuestionId)}
                    />
                  ),
                }
              : {})}
          />
        );
      }
      return (
        <IssuesPane
          report={validation.data ?? null}
          loading={validation.isPending}
          onRefresh={() => void openIssues()}
          onOpenIssue={(issue) => void openIssue(issue)}
        />
      );
    })();
    return (
      <div
        className="sat-product"
        data-au-section={selectedSection?.sectionKey ?? "rw"}
        data-authoring-realtime={authoringRealtime.connectionState}
      >
        <SpineLayout
          header={
            <SpineHeader
              examTitle={examTitle}
              sectionTitle={selectedSection?.title ?? null}
              moduleTitle={selectedModule?.title ?? null}
              issueCount={totalErrors}
              onOpenSampleExam={() => setSampleDialogOpen(true)}
              sampleExamDisabled={loadSampleExam.isPending}
              onOpenShortcuts={() => setShortcutHelpOpen(true)}
              workspaceMode={workspaceMode}
              onModeChange={(mode) => {
                if (mode === "issues") {
                  setQuestionListOpen(false);
                  void openIssues();
                } else if (mode === "overview") {
                  setQuestionListOpen(false);
                  setWorkspaceMode("overview");
                } else {
                  setWorkspaceMode(mode);
                }
              }}
              saveSlot={
                !coeditUiActive && draft ? (
                  <SaveCluster
                    transientSaved
                    announce={false}
                    status={combineSaveStatus(persistence.status, coeditSaveStatus)}
                    lastSavedAt={persistence.lastSavedAt}
                    diverged={Boolean(diverged) || Boolean(publishedFrozen)}
                    onRetry={handleRetrySave}
                    onReviewConflict={openReview}
                  />
                ) : null
              }
              workbookImportDisabled={!shell}
              onOpenWorkbookImport={() => void openWorkbookImport()}
              previewDisabled={!shell}
              onOpenFullPreview={() => {
                void (async () => {
                  if (await flushBeforeRouteChange()) navigate(`/sat/exams/${examId}/preview`);
                })();
              }}
              onOpenRelease={() => {
                void (async () => {
                  if (await flushBeforeRouteChange()) navigate(`/sat/exams/${examId}/release`);
                })();
              }}
              onBack={() => {
                void (async () => {
                  if (await flushBeforeRouteChange()) navigate("/sat/exams");
                })();
              }}
              onOpenQueue={() => setQuestionListOpen(true)}
              collaborationSlot={
                !coeditUiActive && effectiveCapabilities.presence ? (
                  <span className="flex items-center gap-2">
                    {editorHere ? (
                      <span
                        className="text-[11px] text-muted-foreground"
                        data-testid="editing-elsewhere-label"
                        title={PRESENCE_COPY.editingThisQuestion(
                          editorHere.displayName.trim() || "Another author"
                        )}
                      >
                        {PRESENCE_COPY.editingThisQuestion(
                          editorHere.displayName.trim() || "Another author"
                        )}
                      </span>
                    ) : null}
                    <CollaboratorStack
                      occupants={presence.occupants}
                      labelFor={labelForQuestion}
                      onSelectQuestion={(id) => void selectQuestion(id)}
                    />
                  </span>
                ) : null
              }
            />
          }
          queue={compactViewport?null:spineQueue}
          railWidth={rail.width}
          onRailWidthChange={rail.setWidth}
          inspector={draft?<Inspector open={inspectorOpen&&(!inspectorModal||overlayStack.openSheet==='inspector')} modal={inspectorModal} question={draft} issues={selectedQuestionIssues} onChange={handleChange} onClose={closeInspector} readOnly={collaborationReadOnly} isPretest={sharedQuestionScalar?.isPretest ?? questionQuery.data?.isPretest} onPretestChange={selectedExamQuestionId && !collaborationReadOnly ? handlePretestChange : undefined}/>:undefined}
          banner={
            <>
              {deviceRecovery.recovery ? (
                <DeviceDraftRecoverySurface
                  onKeepChanges={keepDeviceDraft}
                  onDiscardChanges={discardDeviceDraft}
                  onCopyChanges={() => void copyDeviceDraft()}
                />
              ) : null}
              {navigationError ? (
                <div role="alert" className="border-b px-5 py-2 text-center text-xs font-medium">
                  {navigationError}
                </div>
              ) : null}
              {coeditRecoverySurface ? (
                <CoeditRecoverySurface
                  body={coeditRecoverySurface.body}
                  // A refused or oversized write has no replacement draft to
                  // open and no remote rows to review, so those actions are
                  // absent rather than dead: the work's way out is the export.
                  {...(coeditRecoverySurface.roomEnded
                    ? { onOpenCurrentDraft: openCurrentDraft, onReviewMyChanges: reviewCoeditChanges }
                    : {})}
                  onCopyMyChanges={() => void copyCoeditPrompt()}
                  {...(coeditRecovery?.canExportStaleCache
                    ? { onDiscardLocalCopy: discardCoeditLocalCopy }
                    : {})}
                />
              ) : null}
              {activeRaceNotice ? (
                <div className={`${coeditUiActive && publishedFrozen ? "hidden" : ""} border-b px-5 py-2 text-center text-xs font-semibold text-destructive`}>
                  {activeRaceNotice}
                </div>
              ) : null}
              {showLegacyDivergenceSurface && !noticeDismissed ? (
                <RemoteUpdateNotice
                  remoteAuthorName={remoteAuthorName}
                  questionLabel={selectedQuestionLabel}
                  onReview={() => setConflictOpen(true)}
                  onDismiss={() => setNoticeDismissed(true)}
                  announce={false}
                />
              ) : null}
              {workbookUndo?.available ? (
                <WorkbookImportUndoBanner
                  busy={workbookUndoBusy}
                  onUndo={() => void handleWorkbookUndo()}
                />
              ) : null}
              <CollaborationLiveRegion
                // The route-level provider owns the single live region for the
                // exam workspace. Keep this fallback for isolated legacy
                // builder mounts and the existing prompt-only migration path.
                enabled={coeditUiActive && !workspaceCollaboration}
                participants={collaborationParticipants}
                connectionPhase={coeditSession?.connectionPhase}
                hasEstablishedConnection={coeditSession?.hasEstablishedConnection}
                lifecyclePhase={coeditSession?.lifecyclePhase ?? (publishedFrozen ? "frozen" : undefined)}
                saveStatus={coeditDisplayStatus}
                recoveryIssue={coeditRecovery?.published ? null : coeditRecovery?.issue ?? null}
              />
            </>
          }
        >
          {draft ? (
              <motion.div
                key={selectedExamQuestionId}
                initial={reduceMotion ? false : { opacity: 0.96 }}
                animate={{ opacity: 1 }}
                transition={spineMotion.question}
              >
                <SpineQuestionView
                  question={draft}
                  focusField={focusField}
                  onOpenSettings={openInspector}
                  isMutating={rowMutationBusy}
                  onRequestDelete={()=>setDeleteTarget(selectedExamQuestionId)}
                  canMoveUp={selectedModuleIndex>0}
                  canMoveDown={Boolean(selectedModule && selectedModuleIndex<selectedModule.questions.length-1)}
                  onMove={direction=>{if(!selectedModule)return;const expected=selectedModule.questions.map(q=>q.examQuestionId);const next=[...expected];const i=selectedModuleIndex,j=i+direction;const from=next[i],to=next[j];if(!from||!to)return;next[i]=to;next[j]=from;void handleReorder(next,expected).catch(()=>undefined);}}
                  {...(selectedModuleIndex >= 0 ? { questionNumber: selectedModuleIndex + 1 } : {})}
                  questionContext={
                    [selectedSection?.title, selectedModule?.title].filter(Boolean).join(" · ") || null
                  }
                  readOnly={collaborationReadOnly}
                  headerPresenceSlot={coeditHeaderPresenceSlot}
                  headerSaveSlot={coeditHeaderSaveSlot}
                  hideFooterSaveStatus={coeditUiActive}
                  saveStatus={combineSaveStatus(persistence.status, coeditSaveStatus)}
                  lastSavedAt={persistence.lastSavedAt}
                  issues={selectedQuestionIssues}
                  keepMetadataForNext={keepMetadataForNext}
                  onKeepMetadataForNextChange={setKeepMetadataForNext}
                  promptCollaboration={promptCollaboration}
                  {...(workspaceCollaboration ? { fieldCollaboration: workspaceFieldCollaboration } : {})}
                  {...(workspaceCollaboration ? { onLocalRichChange: handleLocalRichChange } : {})}
                  onChange={handleChange}
                  onSaveNow={() => void handleSaveNow()}
                  onSaveAndNext={() => void handleSaveAndNext()}
                  onRetrySave={handleRetrySave}
                  // One Review behavior for both save-cluster sites. The footer
                  // used to answer this click with a page message that told the
                  // author to reload and retype work the app was already
                  // holding, while the header opened the real surface.
                  onReviewConflict={openReview}
                  diverged={showLegacyDivergenceSurface || Boolean(publishedFrozen && !coeditUiActive)}
                  onDuplicate={() => void handleDuplicate()}
                  onDelete={() => handleDelete()}
                  onPreview={() => setPreviewOpen(true)}
                  onIssueSelect={requestField}
                />
              </motion.div>
          ) : selectedExamQuestionId && questionQuery.error ? (
            <QuestionLoadError
              error={questionQuery.error}
              onRetry={() => void questionQuery.refetch()}
            />
          ) : selectedExamQuestionId ? (
            <EditorSkeleton />
          ) : (
            <EmptyEditor
              moduleTitle={selectedModule?.title ?? null}
              {...(selectedModule &&
              selectedModule.questions.length < selectedModule.targetQuestionCount
                ? { onCreate: () => void handleCreateQuestion() }
                : {})}
            />
          )}
        </SpineLayout>
        {conflictOpen && (baseDocument || remoteDocument) ? (
          <ConflictResolver
            open={conflictOpen}
            base={baseDocument ?? remoteDocument!}
            local={draft ?? baseDocument ?? remoteDocument!}
            remote={remoteDocument ?? baseDocument!}
            classifications={classifications}
            remoteAuthorName={remoteAuthorName}
            deletedRemotely={Boolean(divergence?.deletedRemotely)}
            onUseLatest={(remote) => void handleUseLatest(remote)}
            onKeepEditing={() => {
              // Dismissing resolves nothing: stay diverged, keep the draft.
              setConflictOpen(false);
              setNoticeDismissed(true);
            }}
            onCopyLocal={() => void copyMyWork()}
            onClose={() => setConflictOpen(false)}
            openerRef={conflictOpenerRef}
          />
        ) : null}
        {selectedModule ? (
          <QuestionJumpPalette
            open={jumpPaletteOpen}
            questions={selectedModule.questions}
            selectedQuestionId={selectedExamQuestionId}
            commands={[
              {id:'settings',label:'Open question settings',group:'Question',onSelect:openInspector,disabledReason:!draft?'Select a question first':undefined},
              {id:'duplicate',label:'Duplicate question',group:'Question',onSelect:()=>void handleDuplicate(),disabledReason:rowMutationBusy?'Another operation is running':!draft?'Select a question first':selectedModule.questions.length>=selectedModule.targetQuestionCount?'Module is full':undefined},
              {id:'delete',label:'Delete question',group:'Question',onSelect:()=>setDeleteTarget(selectedExamQuestionId),disabledReason:!draft?'Select a question first':rowMutationBusy?'Another operation is running':undefined},
              ...([-1,1] as const).map(direction=>({id:direction===-1?'up':'down',label:direction===-1?'Move question up':'Move question down',group:'Question' as const,disabledReason:!draft?'Select a question first':rowMutationBusy?'Another operation is running':!selectedModule.questions[selectedModuleIndex+direction]?'Already at module boundary':undefined,onSelect:()=>{const expected=selectedModule.questions.map(q=>q.examQuestionId),next=[...expected],i=selectedModuleIndex,j=i+direction;const from=next[i],to=next[j];if(!from||!to)return;next[i]=to;next[j]=from;void handleReorder(next,expected).catch(()=>undefined);}})),
              {id:'question-preview',label:'Preview as student',group:'Question',onSelect:()=>setPreviewOpen(true),disabledReason:!draft?'Select a question first':undefined},
              {id:'preview',label:'Preview exam',group:'Exam',onSelect:()=>{void flushBeforeRouteChange().then(ok=>{if(ok)navigate(`/sat/exams/${examId}/preview`);});}},
              {id:'release',label:'Release exam',group:'Exam',onSelect:()=>{void flushBeforeRouteChange().then(ok=>{if(ok)navigate(`/sat/exams/${examId}/release`);});}},
              {id:'overview',label:'Exam overview',group:'Exam',onSelect:()=>setWorkspaceMode('overview')},
              {id:'issues',label:'Review issues',group:'Exam',onSelect:()=>void openIssues()},
              {id:'navigator',label:'Open question navigator',group:'View',onSelect:()=>{setWorkspaceMode('build');if(compactViewport)setQuestionListOpen(true);else searchInputRef.current?.focus();}},
              {id:'help',label:'Keyboard shortcuts',group:'View',onSelect:()=>setShortcutHelpOpen(true)},
            ]}
            onSelect={(questionId) => {
              setJumpPaletteOpen(false);
              void selectQuestion(questionId);
            }}
            onClose={() => setJumpPaletteOpen(false)}
          />
        ) : null}
        <AuthoringConfirmDialog open={deleteTarget!==null} title="Delete this question?" description="This removes the selected question from its SAT module. Other questions are unchanged." confirmLabel="Delete question" destructive busy={rowMutationBusy} onCancel={()=>setDeleteTarget(null)} onConfirm={()=>{const target=deleteTarget;if(target)void handleDelete(target).then(ok=>{if(ok)setDeleteTarget(null);});}}/>
        <ShortcutHelpDialog open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
        {compactViewport ? (
          <SpineQueueSheet
            open={questionListOpen}
            issuesMode={workspaceMode === "issues"}
            onOpenChange={setQuestionListOpen}
            onCaptureOpener={() => {
              if (document.activeElement instanceof HTMLElement) {
                questionSheetFocusRef.current = document.activeElement;
              }
            }}
            onRestoreOpener={() => {
              const opener = questionSheetFocusRef.current;
              questionSheetFocusRef.current = null;
              restoreAuthoringFocus(opener);
            }}
          >
            {spineQueue}
          </SpineQueueSheet>
        ) : null}
        <SpinePreviewSheet
          open={previewOpen}
          question={draft}
          saveStatus={persistence.status}
          onOpenChange={(next) => {
            if (!next) setPreviewOpen(false);
          }}
          onCaptureOpener={() => {
            if (document.activeElement instanceof HTMLElement) {
              inspectorSheetFocusRef.current = document.activeElement;
            }
          }}
          onRestoreOpener={() => {
            const opener = inspectorSheetFocusRef.current;
            inspectorSheetFocusRef.current = null;
            restoreAuthoringFocus(opener);
          }}
        />
        <QuestionImportSheet
          open={importOpen}
          sectionKey={selectedSection?.sectionKey ?? "reading-writing"}
          remainingCapacity={importRemaining}
          isImporting={batchCreate.isPending}
          onClose={() => {
            if (!batchCreate.isPending) setImportOpen(false);
          }}
          onImport={handleBatchImport}
        />
        {workbookBaseline ? (
          <SatWorkbookImportSheet
            open={workbookImportOpen}
            examId={examId}
            shell={workbookBaseline}
            existingQuestionCount={totalAuthored}
            onClose={closeWorkbookImport}
            onCommitted={handleWorkbookCommitted}
          />
        ) : null}
        <SampleExamLoadDialog
          open={sampleDialogOpen}
          busy={loadSampleExam.isPending}
          existingQuestionCount={totalAuthored}
          onCancel={() => {
            if (!loadSampleExam.isPending) setSampleDialogOpen(false);
          }}
          onConfirm={() => void handleLoadSampleExam()}
        />
      </div>
    );
  }
}

export function getShellProvider(shell: AssessmentAuthoringShell): string {
  return shell.providerKey;
}
