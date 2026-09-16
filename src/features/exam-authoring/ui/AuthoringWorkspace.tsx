import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentValidationIssue,
  BatchQuestionDraft,
  BulkQuestionAction,
  QuestionRevision,
  SatWorkbookCommitResult,
  SatWorkbookUndoState,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import {
  assessmentKeys,
  toEnsureDraftShellErrorInfo,
  useAssessmentValidation,
  useAuthoringShell,
  useBatchCreateAssessmentQuestions,
  useBulkAssessmentQuestions,
  useCreateAssessmentQuestion,
  useDuplicateAssessmentQuestion,
  useEnsureDraftShell,
  useExamQuestion,
  useLoadSatSampleExam,
  useReorderAssessmentQuestions,
} from "../api/assessmentQueries";
import { isBackendNotFound } from "../infrastructure/examAuthoringBackendGateway";
import { useQuestionAutosave } from "../hooks/useQuestionAutosave";
import { combineSaveStatus } from "./spine/coeditSaveTruth";
import {
  authorForActor,
  classifyQuestionFields,
  occupantsOf,
  resolveAuthoringRealtimeFlags,
  resolveEffectiveCapabilities,
  useAuthoringPresence,
  useAuthoringRealtime,
  useQuestionDivergence,
  type AuthoringCapabilities,
  type AuthoringPresence,
  type DivergenceEvent,
} from "../realtime";
import { SAVE_CONFLICT_COPY } from "../realtime/connectionCopy";
import { RemoteUpdateNotice } from "./collaboration/RemoteUpdateNotice";
import { ConflictResolver } from "./collaboration/ConflictResolver";
import { CollaboratorStack } from "./collaboration/CollaboratorStack";
import { CollaborationLiveRegion } from "./collaboration/CollaborationLiveRegion";
import { CoeditRecoverySurface } from "./collaboration/CoeditRecoverySurface";
import { DeviceDraftRecoverySurface } from "./collaboration/DeviceDraftRecoverySurface";
import {
  mergeCollaborationParticipants,
  selfParticipant,
} from "./collaboration/collaborationParticipants";
import { QuestionPresenceBadge } from "./collaboration/QuestionPresenceBadge";
import {
  DELETION_COPY,
  PRESENCE_COPY,
  PUBLISH_COPY,
  STRUCTURAL_COPY,
  questionLabel,
} from "./collaboration/collaborationCopy";
import { validateSatQuestion } from "../providers/sat/satProvider";
import { QuestionImportSheet } from "../import/QuestionImportSheet";
import { SatWorkbookImportSheet } from "../import/SatWorkbookImportSheet";
import type { SpineQueueFilter } from "./spine/queueModel";
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
  summaryFromRevision,
} from "./authoringWorkspaceSurfaces";
import { useAuthoringSaveRouting } from "./useAuthoringSaveRouting";
import { useCoeditRecoveryAndPresence } from "./useCoeditRecoveryAndPresence";
import {
  COEDIT_MUTATION_FLUSH_TIMEOUT_MS,
  COEDIT_ROUTE_FLUSH_TIMEOUT_MS,
  coeditRoomBlockMessage,
  coeditRoomShouldWarnBeforeUnload,
} from "./collaboration/coeditNavigationGate";
import { examKeys } from "../api/examQueries";
import { useWorkspaceProjectionWrites } from "./useWorkspaceProjectionWrites";
import {
  isQuestionWorkspaceScalar,
  normalizeQuestionRevision,
  questionWorkspaceScalar,
} from "./authoringWorkspaceModel";
import {
  SatAuthoringErrorSurface,
  SatAuthoringLoadingSurface,
} from "./SatAuthoringStateSurfaces";
import { SpineLayout } from "./spine/SpineLayout";
import { SpineHeader } from "./spine/SpineHeader";
import { SpinePreviewSheet } from "./spine/SpinePreviewSheet";
import { SpineQueueSheet } from "./spine/SpineQueueSheet";
import { QuestionQueueRail } from "./spine/QuestionQueueRail";
import { ExamOverviewPane } from "./spine/ExamOverviewPane";
import { buildExamOverview, selectionAfterDelete } from "./spine/overviewModel";
import { QuestionJumpPalette } from "./spine/QuestionJumpPalette";
import { ShortcutHelpDialog } from "./spine/ShortcutHelpDialog";
import { SpineQuestionView } from "./spine/SpineQuestionView";
import {
  isPromptOnlyChange,
  colorForActor,
  resolveCoeditEnabled,
  usePromptCoediting,
  useSatAuthoringCollaboration,
  type CoeditClientCapability,
  type SatWorkspaceCommandName,
} from "../realtime/coedit";
import type { RichComposerCollaboration } from "../editor/RichQuestionComposer";
import { resolveAuthoringField } from "./spine/readinessFamilies";
import { Inspector } from "./spine/Inspector";
import { useRailWidth } from "./spine/RailResizer";
import { useOverlayStack } from "./spine/useOverlayStack";
import { useOverlayToggle } from "./spine/useOverlayToggle";
import { SaveCluster } from "./spine/SaveCluster";
import { flashAuthoringField } from "./spine/TargetFlash";
import { motion, useReducedMotion } from "motion/react";
import { spineMotion } from "@/src/shared/motion";

/**
 * Placeholder binding used while a room is being opened: it renders the
 * composer's non-editable loading surface and claims nothing (no extensions,
 * not ready, not writable). The legacy editable editor must never mount for a
 * prompt that is about to move into a room.
 */
const PENDING_PROMPT_COLLABORATION: RichComposerCollaboration = Object.freeze({
  extensions: [],
  ready: false,
  readOnly: true,
});

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

type WorkspaceMode = "build" | "overview" | "issues";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const shellQuery = useAuthoringShell(examId);
  const ensureDraft = useEnsureDraftShell(examId);
  const createQuestion = useCreateAssessmentQuestion(examId);
  const batchCreate = useBatchCreateAssessmentQuestions(examId);
  const duplicateQuestion = useDuplicateAssessmentQuestion(examId);
  const reorderQuestions = useReorderAssessmentQuestions(examId);
  const bulkQuestions = useBulkAssessmentQuestions(examId);
  const validation = useAssessmentValidation(examId);
  const loadSampleExam = useLoadSatSampleExam(examId);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedExamQuestionId, setSelectedExamQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuestionRevision | null>(null);
  const draftRef = useRef<QuestionRevision | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("build");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SpineQueueFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [navigationError, setNavigationError] = useState<string | null>(null);
  // Phase 05 race-recovery guards, declared here because `saveDraft` (defined
  // below) must consult them. A published draft or a remotely deleted question
  // freezes the mutation path WITHOUT touching the author's typed content.
  const mutationFrozenRef = useRef(false);
  const deletedRemotelyRef = useRef(false);
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
  // Phase 05 invariant: a known-newer remote revision stops NETWORK autosave
  // while the durable local write continues. A ref (not state) because the
  // divergence that sets it is derived from the autosave this feeds.
  const networkSavePausedRef = useRef(false);
  // True while the open question holds unsaved local work, so a refetch may not
  // adopt the server document over it. Written by an effect that is declared
  // BEFORE the refetch path that reads it, so within one commit the reader sees
  // this render's value rather than the previous one's.
  const draftProtectedRef = useRef(false);
  // Prompt co-editing (2026-09-13 design). `saveDraft` and `handleChange` are
  // declared BEFORE the co-edit hook, so both read through refs that the
  // effects below keep current: which writer owns the open question's fields
  // (resolved once, in the effect, by resolveFieldWriter), and the last
  // server-acknowledged revision the prompt-free field diff is measured
  // against.
  const promptFreeBaselineRef = useRef<QuestionRevision | null>(null);
  const conflictOpenerRef = useRef<HTMLElement | null>(null);
  const overlayStack = useOverlayStack();
  const [previewOpen, setPreviewOpen] = useOverlayToggle(overlayStack,"preview","sheet");
  const [importOpen, setImportOpen] = useOverlayToggle(overlayStack,"import","sheet");
  const [workbookImportOpen, setWorkbookImportOpen] = useOverlayToggle(overlayStack,"workbook","sheet");
  const [workbookBaseline, setWorkbookBaseline] = useState<AssessmentAuthoringShell | null>(null);
  const [workbookUndo, setWorkbookUndo] = useState<SatWorkbookUndoState | null>(null);
  const [workbookUndoBusy, setWorkbookUndoBusy] = useState(false);
  const [sampleDialogOpen, setSampleDialogOpen] = useOverlayToggle(overlayStack,"sample","dialog");
  const [jumpPaletteOpen, setJumpPaletteOpen] = useOverlayToggle(overlayStack,"palette","dialog");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useOverlayToggle(overlayStack,"shortcuts","dialog");
  const [questionListOpen, setQuestionListOpen] = useOverlayToggle(overlayStack,"navigator","sheet");
  const rail = useRailWidth();
  const [compactViewport, setCompactViewport] = useState(false);
  const [keepMetadataForNext, setKeepMetadataForNext] = useState(true);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [inspectorModal,setInspectorModal]=useState(false);
  const inspectorOpener=useRef<HTMLElement|null>(null);
  const {requestOpen:requestOverlay,close:closeOverlay}=overlayStack;
  const openInspector=useCallback(()=>{
    if(inspectorModal&&!requestOverlay('inspector','sheet'))return;
    inspectorOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setInspectorOpen(true);
  },[inspectorModal,requestOverlay]);
  const closeInspector=useCallback(()=>{setInspectorOpen(false);closeOverlay('inspector');restoreAuthoringFocus(inspectorOpener.current);},[closeOverlay]);
  const requestField=useCallback((path:string|null)=>{const field=resolveAuthoringField(path);if(['domain','skill','difficulty','tags','accessibility'].includes(field))openInspector();setFocusField(field);},[openInspector]);
  useEffect(()=>{
    if(typeof window.matchMedia!=='function')return;const media=window.matchMedia('(max-width: 1279px)');
    const update=()=>setInspectorModal(media.matches);update();media.addEventListener?.('change',update);return()=>media.removeEventListener?.('change',update);
  },[]);
  useEffect(()=>{if(!inspectorOpen)return;if(inspectorModal){if(!requestOverlay('inspector','sheet'))setInspectorOpen(false);}else closeOverlay('inspector');},[inspectorModal,inspectorOpen,requestOverlay,closeOverlay]);
  const [deleteTarget, updateDeleteTarget] = useState<string|null>(null);
  const setDeleteTarget=useCallback((id:string|null)=>{if(id){if(requestOverlay('delete','dialog'))updateDeleteTarget(id);}else{updateDeleteTarget(null);closeOverlay('delete');}},[requestOverlay,closeOverlay]);
  const [rowMutationBusy, setRowMutationBusy] = useState(false);
  const rowMutationFlight = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const questionSheetFocusRef = useRef<HTMLElement | null>(null);
  const inspectorSheetFocusRef = useRef<HTMLElement | null>(null);
  const recoveredQuestionDraftKeyRef = useRef<string | null>(null);
  const [deviceDraftRecovery, setDeviceDraftRecovery] = useState<{
    questionId: string;
    draft: QuestionRevision;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const questionQuery = useExamQuestion(selectedExamQuestionId);
  const reduceMotion = useReducedMotion();
  const shell = shellQuery.data;
  const questionDraftKey = selectedExamQuestionId
    ? buildStaffDraftKey(staffActorId, "assessment-question", examId, selectedExamQuestionId)
    : null;
  const workspaceQuestionPath = selectedExamQuestionId
    ? `question/${selectedExamQuestionId}`
    : null;

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

  useEffect(() => {
    if (!shellVersionId) return;
    let cancelled = false;
    void assessmentAuthoringApi
      .getSatWorkbookUndoState(examId)
      .then((state) => {
        if (!cancelled) setWorkbookUndo(state?.available ? state : null);
      })
      .catch(() => {
        if (!cancelled) setWorkbookUndo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, shellVersionId, shellVersionRevision]);

  const selectedSection = useMemo(
    () =>
      shell?.sections.find((section) =>
        section.modules.some((module) => module.id === selectedModuleId)
      ) ?? null,
    [selectedModuleId, shell]
  );
  const selectedModule = useMemo(
    () => selectedSection?.modules.find((module) => module.id === selectedModuleId) ?? null,
    [selectedModuleId, selectedSection]
  );
  const allQuestions = useMemo(
    () =>
      shell?.sections.flatMap((section) =>
        section.modules.flatMap((module) =>
          module.questions.map((question) => ({ ...question, moduleId: module.id }))
        )
      ) ?? [],
    [shell]
  );
  const selectedModuleIndex =
    selectedModule?.questions.findIndex(
      (question) => question.examQuestionId === selectedExamQuestionId
    ) ?? -1;
  const selectedQuestionIssues = draft
    ? validateSatQuestion(draft.metadata.sectionKey, draft)
    : [];
  const totalAuthored = allQuestions.length;
  const totalErrors = allQuestions.reduce(
    (sum, question) => sum + (question.readiness.status === "error" ? 1 : 0),
    0
  );

  useEffect(() => {
    if (!shell) return;
    const deepQuestionId = searchParams.get("question");
    const deepField = searchParams.get("field");
    if (deepQuestionId) {
      const target = shell.sections
        .flatMap((section) =>
          section.modules.map((module) => ({
            module,
            question: module.questions.find((item) => item.examQuestionId === deepQuestionId),
          }))
        )
        .find((candidate) => candidate.question);
      if (target?.question) {
        setSelectedModuleId(target.module.id);
        setSelectedExamQuestionId(target.question.examQuestionId);
        requestField(deepField);
        const next = new URLSearchParams(searchParams);
        next.delete("question");
        next.delete("field");
        setSearchParams(next, { replace: true });
        return;
      }
    }
    const selectedStillExists =
      selectedModuleId &&
      shell.sections.some((section) =>
        section.modules.some((module) => module.id === selectedModuleId)
      );
    if (!selectedStillExists) {
      const firstModule = shell.sections[0]?.modules[0] ?? null;
      setSelectedModuleId(firstModule?.id ?? null);
      setSelectedExamQuestionId(firstModule?.questions[0]?.examQuestionId ?? null);
    }
  }, [searchParams, selectedModuleId, setSearchParams, shell, requestField]);

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
      void queryClient.prefetchQuery({
        queryKey: assessmentKeys.question(question.examQuestionId),
        queryFn: () => assessmentAuthoringApi.getQuestion(question.examQuestionId),
        staleTime: 60_000,
      });
    }
  }, [queryClient, selectedModule, selectedModuleIndex]);

  // Prompt co-editing (2026-09-13 design). The workspace is the composition
  // owner: it mounts exactly one provider for the selected question and
  // threads the binding into the spine as a PROP. Nothing below this level
  // imports Yjs or Hocuspocus.
  //
  // `server` is optimistic on purpose: we cannot know the server posture until
  // we ask, and a server that cannot offer co-editing answers with a typed
  // unavailable error that the hook degrades into "disabled" without showing
  // the author anything. Every OTHER gate is checked before we ask at all.
  const coeditCapability = useMemo<CoeditClientCapability>(
    () => ({
      server: true,
      // Prompt co-editing is a product default now; no Vite flag is required
      // to expose the collaborative header/editor.
      frontendEnabled: true,
      // A selected question in the shell IS in the current editable draft
      // (the shell only ever exposes the draft); a published/replaced draft
      // de-selects it and the server refuses the token anyway.
      // The route-level exam workspace owns the selected question whenever the
      // SAT workspace provider is mounted. Keeping this false prevents a
      // second question-scoped Hocuspocus room from opening beside it.
      activeEditableDraft: Boolean(selectedExamQuestionId) && workspaceCollaboration === null,
      writeCapableRole: sessionRole === "admin" || sessionRole === "builder",
    }),
    [
      selectedExamQuestionId,
      sessionRole,
      workspaceCollaboration,
    ]
  );
  const coeditEnabled = resolveCoeditEnabled(coeditCapability);
  const coedit = usePromptCoediting({
    examQuestionId: selectedExamQuestionId,
    capability: coeditCapability,
  });
  // A room really exists only once its provider does.
  const workspaceUiActive = workspaceCollaboration !== null;
  const coeditRoomOpen = workspaceUiActive
    ? Boolean(workspaceCollaboration.workspaceSnapshot.ready)
    : coeditEnabled && coedit.session !== null;
  // This flag owns the co-edit-only chrome, including the short preparation
  // window before the provider has produced a session.
  const coeditUiActive = workspaceUiActive || (coeditEnabled && coedit.status !== "disabled");
  // The exam-level room is the single realtime transport for SAT authoring.
  // Starting the legacy event socket beside it creates a second connection
  // that is intentionally refused by the default server posture and adds
  // noisy console failures. Non-workspace authoring keeps the old path.
  const coeditSession = coedit.session;

  const updateSummaryCache = useCallback(
    (examQuestionId: string, saved: QuestionRevision) => {
      queryClient.setQueryData<AssessmentAuthoringShell>(assessmentKeys.shell(examId), (current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((section) => ({
                ...section,
                modules: section.modules.map((module) => ({
                  ...module,
                  questions: module.questions.map((summary) =>
                    summary.examQuestionId === examQuestionId
                      ? summaryFromRevision(summary, saved)
                      : summary
                  ),
                })),
              })),
            }
          : current
      );
      queryClient.setQueryData<AssessmentQuestionDetail>(
        assessmentKeys.question(examQuestionId),
        (current) => (current ? { ...current, question: saved } : current)
      );
    },
    [examId, queryClient]
  );

  // Single ownership + one save path (resolveFieldWriter): the routing policy
  // and the write it permits are resolved together, in one place, from the two
  // room facts — not re-decided at each call site.
  const { fieldWriter, saveDraft } = useAuthoringSaveRouting({
    examId,
    queryClient,
    selectedExamQuestionId,
    questionDraftKey,
    workspaceRoomActive: workspaceUiActive,
    promptRoomActive: coeditEnabled && coedit.session !== null,
    promptFreeBaselineRef,
    mutationFrozenRef,
    deletedRemotelyRef,
    divergenceDispatchRef,
    recoveredQuestionDraftKeyRef,
    setDraft,
    updateSummaryCache,
  });

  const autosave = useQuestionAutosave({
    save: saveDraft,
    durableKey: questionDraftKey,
    autoSaveRecovered: false,
    networkPausedRef: networkSavePausedRef,
    onRecover: (recovered) => {
      if (!questionDraftKey) return;
      recoveredQuestionDraftKeyRef.current = questionDraftKey;
      if (workspaceCollaboration && selectedExamQuestionId) {
        // The collaborative editor reads from the exam room, so putting the
        // legacy recovered value in `draft` alone would make it look restored
        // in the surrounding React state while the visible editor continued
        // to show the room's content. Hold it for an explicit, safe import.
        setDeviceDraftRecovery({ questionId: selectedExamQuestionId, draft: recovered });
        setNavigationError(null);
        return;
      }
      setDraft(recovered);
      // A device-local draft came back after a reload. That is its own state,
      // not a remote conflict: nobody else's save is implied, and with the
      // refetch guard in place this can no longer be the accidental
      // consequence of a newer version silently replacing the editor.
      setNavigationError(
        `${SAVE_CONFLICT_COPY.recovered} ${SAVE_CONFLICT_COPY.recoveredHint}`
      );
    },
  });

  // Phase 04/05: the ONLY authoring realtime mount. It is deliberately placed
  // here (after autosave so the dirty closure binds; before the early returns
  // so the hook is unconditional) and NEVER inside an editor or rail.
  //
  // Composition rule (Phase 05): three small hooks, one owner. There is no
  // `useCollaborationEverything`; each hook owns exactly one concern and the
  // workspace threads their outputs into the spine as PROPS.
  const realtimeFlags = useMemo(
    () => resolveAuthoringRealtimeFlags(import.meta.env as Record<string, unknown>),
    []
  );
  const [serverCapabilities, setServerCapabilities] = useState<AuthoringCapabilities>({
    delivery: true,
    presence: false,
    conflictCompare: false,
  });
  // Server OFF always wins; the local kill switch can only narrow further.
  const effectiveCapabilities = useMemo(
    () => resolveEffectiveCapabilities(serverCapabilities, realtimeFlags),
    [serverCapabilities, realtimeFlags]
  );
  // The exam-level room is the single realtime transport for SAT authoring.
  // Starting the legacy event socket beside it creates a second connection
  // that is intentionally refused by the default server posture and adds
  // noisy console failures. Non-workspace authoring keeps the old path.
  const realtimeDeliveryEnabled = !workspaceUiActive && effectiveCapabilities.delivery;
  const isQuestionDirtyForRealtime = useCallback(
    (examQuestionId: string) =>
      examQuestionId === selectedExamQuestionId && autosave.hasPendingChanges,
    [selectedExamQuestionId, autosave.hasPendingChanges]
  );
  // While the token round-trip and initial sync are in flight the prompt must
  // NOT be an editable legacy editor: the room is about to own it, and text
  // typed into an editor that is destroyed a moment later never reaches the
  // Y.Doc (the room seeds from the stored projection). A placeholder binding
  // keeps the composer on its non-editable loading surface until the real one
  // arrives; it carries no save truth and claims no ownership.
  const workspacePromptBinding = useMemo(() => {
    if (!workspaceCollaboration || !selectedExamQuestionId) return null;
    const binding = workspaceCollaboration.fieldBinding(
      `question/${selectedExamQuestionId}/prompt`,
    );
    return binding ?? (
      workspaceCollaboration.status === "preparing" || workspaceCollaboration.status === "error"
        ? PENDING_PROMPT_COLLABORATION
        : null
    );
  }, [
    selectedExamQuestionId,
    workspaceCollaboration,
  ]);
  const coeditBinding = workspaceUiActive
    ? null
    : coedit.collaboration ??
      (coeditEnabled && (coedit.status === "preparing" || coedit.status === "error")
        ? PENDING_PROMPT_COLLABORATION
        : null);
  // Effective binding for the composer: only when co-editing actually took
  // over. A server-disabled posture renders the legacy editor; a connection
  // error stays on the read-only recovery surface so it cannot create a second
  // prompt writer beside an active room.
  const promptCollaboration = workspaceUiActive
    ? workspacePromptBinding ?? undefined
    : coeditEnabled && coedit.status !== "disabled"
      ? coeditBinding ?? undefined
      : undefined;
  const workspaceFieldCollaboration = useCallback(
    (fieldPath: string) => {
      if (!workspaceCollaboration || !workspaceQuestionPath) return null;
      return workspaceCollaboration.fieldBinding(`${workspaceQuestionPath}/${fieldPath}`);
    },
    [workspaceCollaboration, workspaceQuestionPath],
  );

  // The save truth of the prompt comes from the co-edit acknowledgement, not
  // from the legacy autosave counter, which knows nothing about the CRDT. Both
  // are combined below by taking the LEAST advanced of the two, so neither can
  // claim "Saved" for work the other is still holding.

  // Phase 05 divergence: driven by the Phase 04 reconciler seams, so the
  // decision of WHAT happened stays in one place and this only records state.
  const [publishedFrozen, setPublishedFrozen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const {
    handleRealtimeLifecycle,
    coeditSaveStatus,
    coeditRecovery,
    coeditRecoverySurface,
    coeditDisplayStatus,
    collaborationReadOnly,
    collaborationPublished,
    collaborationLifecyclePhase,
    collaborationIsReadOnly,
    hasCollaborationSession,
  } = useCoeditRecoveryAndPresence({
    examId,
    queryClient,
    workspaceCollaboration,
    coedit,
    workspaceUiActive,
    coeditRoomOpen,
    coeditUiActive,
    selectedExamQuestionId,
    autosaveStatus: autosave.status,
    publishedFrozen,
    setPublishedFrozen,
  });

  useEffect(() => {
    if (collaborationPublished) {
      // A publish close can arrive through the dedicated co-edit room without
      // the legacy exam event socket. Feed it into the existing workspace
      // freeze so supporting fields and navigation keep the established
      // published/read-only behavior too.
      setPublishedFrozen(true);
      return;
    }
    if (!hasCollaborationSession) return;
    if (collaborationLifecyclePhase !== "active" || collaborationIsReadOnly) return;
    // A failed/cancelled publish broadcasts `active`; the collaborative room
    // is the authority for restoring editability after that staged transition.
    setPublishedFrozen(false);
  }, [
    collaborationIsReadOnly,
    collaborationLifecyclePhase,
    collaborationPublished,
    hasCollaborationSession,
  ]);

  // The realtime client is created before these hooks exist, so the seams it
  // calls are routed through refs that the effects below keep current (the
  // divergence dispatcher is declared with the other Phase 05 refs, above, so
  // `saveDraft` can use it). This is what lets the Phase 04 reconciler drive
  // Phase 05 state without a cycle.
  const presenceFrameRef = useRef<(raw: unknown) => void>(() => undefined);
  const autosavePendingRef = useRef(false);
  useEffect(() => {
    autosavePendingRef.current = autosave.hasPendingChanges;
  }, [autosave.hasPendingChanges]);
  useEffect(() => {
    mutationFrozenRef.current = publishedFrozen;
  }, [publishedFrozen]);

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

  const baseQuestion = useMemo(
    () => (questionQuery.data?.question ? normalizeQuestionRevision(questionQuery.data.question) : null),
    [questionQuery.data?.question],
  );
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
      hasPendingChanges: autosave.hasPendingChanges,
    });
  const diverged = divergence?.status === "diverged";
  useEffect(() => {
    // The single place divergence gates network writes. Everything else (the
    // 409 fence, the mutation freeze) stays as it was.
    networkSavePausedRef.current = diverged;
  }, [diverged]);
  useEffect(() => {
    // The sanctioned dirty rule (content vs the authored-against base, or an
    // unsaved-but-identical pending write) — never DOM state, focus, or
    // keystrokes. Gated on a draft existing: a pending flag that arrived BEFORE
    // the editor had anything in it (a recovered device draft) must not block
    // the seed, or the question would never open at all.
    draftProtectedRef.current =
      draft !== null && (autosave.hasPendingChanges || isQuestionDiverged);
  }, [draft, autosave.hasPendingChanges, isQuestionDiverged]);

  // The refetch path. Declared AFTER the dirty flag it consults, so a refetch
  // that lands in the same commit as the first keystroke still sees the work it
  // must not discard. A refetch may adopt the server document only when there
  // is no unsaved local work: otherwise the very fetch that reveals a newer
  // revision would replace the draft the notice beside it promises to keep, and
  // the device copy would be the only survivor — which is what turns "review
  // the newer version" into "recovered unsaved changes from this device" a
  // reload later. The clean case keeps its refetch-replace: that IS the
  // intended freshness path (Phase 04).
  useEffect(() => {
    if (
      questionQuery.data?.question &&
      questionQuery.data.examQuestionId === selectedExamQuestionId &&
      recoveredQuestionDraftKeyRef.current !== questionDraftKey &&
      !draftProtectedRef.current
    ) {
      setDraft(normalizeQuestionRevision(questionQuery.data.question));
    }
  }, [questionDraftKey, questionQuery.data, selectedExamQuestionId]);

  const openReview = useCallback(() => {
    // Captured for focus restore on close. Opening the sheet programmatically
    // must not move focus: the surface is non-modal and the author keeps
    // typing where they were.
    conflictOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConflictOpen(true);
  }, []);

  // Phase 05 parity: a FENCED write is the same product condition as a
  // socket-delivered newer revision — the author is dirty and a newer revision
  // exists — but it arrives with no socket at all (delivery off, degraded, or a
  // POST already in flight when the collaborator's save committed). Route it
  // into the same divergence state and the same Review surface instead of
  // stranding the author on a manual "reload and reapply your changes"
  // instruction. The fetch below is what turns the fence into a fact: HTTP, not
  // the event stream, is authoritative.
  const conflictRoutedRef = useRef<string | null>(null);
  // Read at resolution time, never as a dependency: the draft arriving is what
  // triggers this fetch, so depending on it would tear the effect down and
  // cancel the very request it just issued.
  const draftRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    draftRevisionRef.current = draft?.revision ?? null;
  }, [draft]);
  useEffect(() => {
    if (autosave.status !== "conflict") {
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
        const attemptedRevision = draftRevisionRef.current;
        if (attemptedRevision !== null && remoteRevision <= attemptedRevision) return;
        dispatchDivergence({
          type: "REMOTE_REVISION",
          examQuestionId: selectedExamQuestionId,
          remoteRevision,
          hasPendingChanges: autosavePendingRef.current,
        });
        openReview();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [autosave.status, dispatchDivergence, openReview, selectedExamQuestionId]);

  const presence = useAuthoringPresence({
    draftVersionId: shell?.versionId ?? null,
    selectedExamQuestionId,
    isDirty: isQuestionDiverged,
    enabled: effectiveCapabilities.presence,
    connectionState: authoringRealtime.connectionState,
    sendFrame: authoringRealtime.sendFrame,
    selfConnectionId: authoringRealtime.selfConnectionId,
  });
  const collaborationParticipants = useMemo(
    () => workspaceCollaboration
      ? workspaceCollaboration.participants
      : mergeCollaborationParticipants({
        self: coeditUiActive
          ? selfParticipant(
              coeditSession?.self ?? {
                actorId: staffActorId ?? "self",
                displayName:
                  authSession?.session?.user.displayName?.trim() ||
                  authSession?.session?.user.email ||
                  "You",
                color: colorForActor(staffActorId ?? "self"),
              },
              staffActorId,
              selectedExamQuestionId,
              coeditSession?.readOnly || publishedFrozen ? "viewing" : "editing",
            )
          : null,
        room: coeditSession?.collaborators ?? [],
        workspace: effectiveCapabilities.presence ? presence.occupants : [],
        selectedQuestionId: selectedExamQuestionId,
      }),
    [
      authSession?.session?.user.displayName,
      authSession?.session?.user.email,
      coeditSession?.collaborators,
      coeditSession?.readOnly,
      coeditSession?.self,
      coeditUiActive,
      effectiveCapabilities.presence,
      publishedFrozen,
      presence.occupants,
      selectedExamQuestionId,
      staffActorId,
      workspaceCollaboration,
    ],
  );
  useEffect(() => {
    divergenceDispatchRef.current = dispatchDivergence;
  }, [dispatchDivergence]);
  useEffect(() => {
    presenceFrameRef.current = presence.handlePresenceFrame;
  }, [presence.handlePresenceFrame]);

  // A fresh divergence is a fresh notice: never leave the banner dismissed
  // from a previous conflict.
  useEffect(() => {
    setNoticeDismissed(false);
  }, [selectedExamQuestionId, divergence?.remoteRevision]);

  const labelForQuestion = useCallback(
    (examQuestionId: string): string | null => {
      for (const section of shell?.sections ?? []) {
        for (const module of section.modules) {
          const index = module.questions.findIndex(
            (q) => q.examQuestionId === examQuestionId
          );
          if (index >= 0) return questionLabel(index);
        }
      }
      return null;
    },
    [shell]
  );

  const remoteAuthorName = divergence?.remoteAuthor?.displayName ?? null;
  useEffect(() => {
    presenceRosterRef.current = presence.occupants;
  }, [presence.occupants]);
  useEffect(() => {
    deletedRemotelyRef.current = Boolean(divergence?.deletedRemotely);
  }, [divergence?.deletedRemotely]);
  const selectedQuestionLabel = selectedExamQuestionId
    ? labelForQuestion(selectedExamQuestionId)
    : null;
  const editorHere = presence.editorsHere[0] ?? null;

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
  // same-field conflict can never be reported as one. `local` is always the
  // workspace draft: the editable document has exactly one owner.
  const baseDocument = divergence?.baseDocument ?? baseQuestion;
  useEffect(() => {
    // The prompt-free field diff and the prompt-only gate both measure against
    // the last server-acknowledged revision. `baseDocument` is exactly that: the
    // divergence store advances it on every acknowledgement, and a fresh
    // question load seeds it.
    promptFreeBaselineRef.current = baseDocument;
  }, [baseDocument]);
  const classifications = useMemo(() => {
    if (!effectiveCapabilities.conflictCompare) return [];
    if (!baseDocument || !draft || !remoteDocument) return [];
    return classifyQuestionFields({ base: baseDocument, local: draft, remote: remoteDocument });
  }, [effectiveCapabilities.conflictCompare, baseDocument, draft, remoteDocument]);

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
      autosave.acknowledgeServerRevision();
      setConflictOpen(false);
      setNoticeDismissed(false);
    },
    [selectedExamQuestionId, questionQuery, dispatchDivergence, autosave]
  );

  const activeRaceNotice = divergence?.deletedRemotely
    ? DELETION_COPY.body(remoteAuthorName ?? "Another author")
    : publishedFrozen
      ? PUBLISH_COPY.body
      : divergence?.movedRemotely
        ? STRUCTURAL_COPY.movedTo(selectedModule?.title ?? "another module")
        : divergence?.bulkChangedRemotely
            ? STRUCTURAL_COPY.orderUpdated
            : null;
  const structuralDivergence = Boolean(
    divergence?.deletedRemotely || divergence?.movedRemotely || divergence?.bulkChangedRemotely,
  );
  const showLegacyDivergenceSurface =
    Boolean(diverged) && (!coeditRoomOpen || structuralDivergence);

  const copyMyWork = useCallback(async () => {
    if (!draft) return;
    const text = JSON.stringify(draft, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
      setNavigationError("Your current question draft was copied to the clipboard.");
    } catch {
      setNavigationError("Copy failed — select the text in Review and copy it manually.");
    }
  }, [draft]);

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
    if (draft) autosave.retry(draft);
  }, [autosave, coedit, coeditDisplayStatus, coeditUiActive, draft, workspaceCollaboration]);

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
      setNavigationError("There is no local prompt copy to export yet.");
      return;
    }
    try {
      await navigator.clipboard?.writeText(JSON.stringify(exported, null, 2));
      setNavigationError("The local prompt was copied to the clipboard.");
    } catch {
      setNavigationError("Copy failed — copy the prompt from the editor before leaving.");
    }
  }, [coeditRecovery]);

  // Discarding a preserved copy is the author's decision, taken from the
  // recovery surface's confirm step; nothing else in the workspace removes
  // local work.
  const discardCoeditLocalCopy = useCallback(() => {
    void coeditRecovery?.discardStaleCache().catch(() => undefined);
  }, [coeditRecovery]);

  const copyDeviceDraft = useCallback(async () => {
    const recovered = deviceDraftRecovery?.draft;
    if (!recovered) return;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(recovered, null, 2));
      setNavigationError("The recovered question was copied to the clipboard.");
    } catch {
      setNavigationError("Copy failed — keep the recovered changes here before leaving.");
    }
  }, [deviceDraftRecovery]);

  const keepDeviceDraft = useCallback(() => {
    const recovered = deviceDraftRecovery;
    if (!recovered || !workspaceCollaboration || recovered.questionId !== selectedExamQuestionId) return;
    const snapshot = workspaceCollaboration.workspaceSnapshot;
    if (!snapshot.ready || snapshot.readOnly || workspaceCollaboration.lifecyclePhase !== "active") {
      setNavigationError("The shared draft is not editable right now. Your recovered changes are still available.");
      return;
    }
    const path = `question/${recovered.questionId}`;
    const currentScalar = snapshot.values[`${path}/scalar`];
    const isPretest = isQuestionWorkspaceScalar(currentScalar)
      ? currentScalar.isPretest
      : questionQuery.data?.isPretest;
    workspaceCollaboration.setValue(`${path}/scalar`, questionWorkspaceScalar(recovered.draft, isPretest));
    workspaceCollaboration.setRichField(`${path}/prompt`, recovered.draft.prompt);
    workspaceCollaboration.setRichField(`${path}/stimulus`, recovered.draft.stimulus);
    workspaceCollaboration.setRichField(`${path}/rationale`, recovered.draft.rationale);
    if (recovered.draft.answer.kind === "single_choice") {
      for (const option of recovered.draft.answer.options) {
        workspaceCollaboration.setRichField(`${path}/choice/${option.id}`, option.content);
      }
    }
    setDraft(recovered.draft);
    autosave.acknowledgeServerRevision();
    setDeviceDraftRecovery(null);
    setNavigationError("Your recovered changes were added to the shared draft.");
  }, [autosave, deviceDraftRecovery, questionQuery.data?.isPretest, selectedExamQuestionId, workspaceCollaboration]);

  const discardDeviceDraft = useCallback(() => {
    if (!deviceDraftRecovery) return;
    autosave.acknowledgeServerRevision();
    setDeviceDraftRecovery(null);
    setNavigationError("The recovered device draft was discarded.");
  }, [autosave, deviceDraftRecovery]);

  useEffect(() => {
    if (deviceDraftRecovery && deviceDraftRecovery.questionId !== selectedExamQuestionId) {
      setDeviceDraftRecovery(null);
    }
  }, [deviceDraftRecovery, selectedExamQuestionId]);

  const openCurrentDraft = useCallback(() => {
    setConflictOpen(false);
    setNoticeDismissed(false);
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
    if (workspaceCollaboration) workspaceCollaboration.retry();
    else coedit.retry();
  }, [coedit, examId, queryClient, workspaceCollaboration]);

  const reviewCoeditChanges = useCallback(() => {
    setConflictOpen(true);
  }, []);

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
        lastSavedAt={workspaceCollaboration ? null : autosave.lastSavedAt}
        diverged={showLegacyDivergenceSurface}
        onRetry={handleRetrySave}
        onReviewConflict={workspaceCollaboration ? undefined : openReview}
      />
    ) : null;

  // The room and the legacy queue are independent sources of unsaved work: a
  // room never enqueues a legacy autosave, and the legacy branch never opens
  // one. Warning from only one of them would let a browser close discard the
  // other's content, so each contributes its own truth.
  const roomNeedsUnloadWarning = workspaceCollaboration
    ? coeditRoomShouldWarnBeforeUnload(workspaceCollaboration.workspaceSnapshot)
    : false;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldWarn =
      roomNeedsUnloadWarning ||
      (autosave.hasPendingChanges &&
        (autosave.isOffline || ["unsaved", "saving", "error"].includes(autosave.status)));
    if (!shouldWarn) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [autosave.hasPendingChanges, autosave.isOffline, autosave.status, roomNeedsUnloadWarning]);

  /**
   * The in-page barrier, run before a question/module switch and before every
   * HTTP structural mutation.
   *
   * `mutation` is the default because most callers are about to change the exam
   * over HTTP (create, duplicate, delete, reorder, bulk, import, validate), and
   * the room cannot see those writes: running one while the room has not
   * committed the same exam applies it to a revision the author has already
   * moved past.
   *
   * `selection` is a move INSIDE the room. The previous question's content
   * stays in the Y.Doc and in its IndexedDB copy whether or not the network has
   * acknowledged it, so waiting on the service here would only make switching
   * slower — and would make it impossible offline, which is the state this
   * layer exists to survive. The room is still consulted for a genuinely
   * at-risk state, which is why an author offline in a merely-pending room can
   * keep working but a refused room cannot.
   */
  const flushBeforeNavigation = useCallback(async (intent: "selection" | "mutation" = "mutation") => {
    // Shared scalar and rich fields are sent through the exam-level room. Do
    // not gate navigation on the legacy question autosave queue, which should
    // remain empty while this provider owns the workspace.
    if (workspaceCollaboration) {
      if (intent === "selection") return true;
      const result = await workspaceCollaboration.flushAndWaitForSaved(
        COEDIT_MUTATION_FLUSH_TIMEOUT_MS,
      );
      // Read the snapshot AFTER the wait: a refusal, a freeze, or a fresh
      // acknowledgement all arrive while it is pending.
      const block = coeditRoomBlockMessage(
        workspaceCollaboration.workspaceSnapshot,
        result.outcome,
      );
      if (block === null) return true;
      setNavigationError(block);
      return false;
    }
    if (!draft || autosave.status === "saved") return true;
    const result = await autosave.flushNow(draft);
    if (result.ok) return true;
    setNavigationError(
      // Fenced and diverged are the same condition with the same answer, so
      // they share one sentence: review the newer version, or take your work
      // with you. Neither accuses the save of failing.
      autosave.status === "conflict" ||
        networkSavePausedRef.current ||
        autosave.isNetworkPaused
        ? SAVE_CONFLICT_COPY.fencedBeforeLeaving
        : autosave.isOffline
          ? "You are offline. This draft is saved on this device; reconnect before leaving so it can sync."
          : SAVE_CONFLICT_COPY.failed
    );
    return false;
  }, [autosave, draft, workspaceCollaboration]);

  /**
   * The route barrier, run before leaving the authoring surface.
   *
   * The next screen (exam preview, release, exam library) reads the committed
   * MySQL projection rather than the room, so nothing less than a durable
   * acknowledgement of THIS tab's state proves it will show the author's work.
   * A refusal is not navigated past: the author is told what the next screen
   * would hide and stays with their content. Query invalidation is awaited
   * before the route changes so the preview cannot mount on a cached exam
   * detail still inside its five-minute staleTime.
   */
  const flushBeforeRouteChange = useCallback(async (): Promise<boolean> => {
    if (!workspaceCollaboration) return flushBeforeNavigation("mutation");
    const result = await workspaceCollaboration.flushAndWaitForSaved(
      COEDIT_ROUTE_FLUSH_TIMEOUT_MS,
    );
    const block = coeditRoomBlockMessage(
      workspaceCollaboration.workspaceSnapshot,
      result.outcome,
    );
    if (block !== null) {
      setNavigationError(block);
      return false;
    }
    // A refetch failure must not strand the author here: the room is durable,
    // which is the promise; freshness is best-effort on top of it.
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
    ]);
    return true;
  }, [examId, flushBeforeNavigation, queryClient, workspaceCollaboration]);

  const selectQuestion = useCallback(
    async (questionId: string, moduleId = selectedModuleId) => {
      if (rowMutationFlight.current) return false;
      if (questionId === selectedExamQuestionId) return true;
      setNavigationError(null);
      if (!(await flushBeforeNavigation("selection"))) return false;
      if (moduleId) setSelectedModuleId(moduleId);
      setDraft(null);
      setSelectedExamQuestionId(questionId);
      return true;
    },
    [flushBeforeNavigation, selectedExamQuestionId, selectedModuleId]
  );

  const selectModule = useCallback(
    async (moduleId: string) => {
      if (rowMutationFlight.current || moduleId === selectedModuleId) return;
      if (!(await flushBeforeNavigation("selection"))) return;
      const module = shell?.sections
        .flatMap((section) => section.modules)
        .find((item) => item.id === moduleId);
      setSearchQuery("");
      setFilter("all");
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
      setSelectedModuleId(moduleId);
      setDraft(null);
      setSelectedExamQuestionId(module?.questions[0]?.examQuestionId ?? null);
    },
    [flushBeforeNavigation, selectedModuleId, shell]
  );

  const handleChange = useCallback(
    (next: QuestionRevision) => {
      setWorkbookUndo(null);
      setDraft(next);
      const writer = fieldWriter;
      // The exam room persists every field of the question it owns, including
      // the scalar settings, through its own exact Yjs acknowledgement. Never
      // enqueue a whole-question HTTP autosave beside it.
      if (writer === "workspace" && publishWorkspaceScalar(next)) return;
      // While co-editing owns the prompt, a prompt-only change stays OUT of the
      // legacy autosave queue: the Y.Doc is the source of truth for the prompt,
      // the service persists it, and scheduling a whole-question save here
      // would either fail (COEDIT_ACTIVE) or bump a revision for a keystroke.
      // The projection the composer emits is still real — it feeds preview and
      // validation — it just does not schedule a save.
      const baseline = promptFreeBaselineRef.current;
      if (writer === "prompt-room" && baseline && isPromptOnlyChange(baseline, next)) {
        return;
      }
      autosave.scheduleAutosave(next);
    },
    [autosave, fieldWriter, publishWorkspaceScalar]
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const handleSaveNow = useCallback(async () => {
    if (!draft) return;
    setNavigationError(null);
    // The exam-level workspace is already the durable save queue. A manual
    // save shortcut must not send a stale whole-question HTTP revision beside
    // the shared Yjs roots; the workspace acknowledgement is the only source
    // of save truth in SAT co-edit mode.
    if (workspaceCollaboration) {
      if (coeditDisplayStatus === "error") workspaceCollaboration.retry();
      return;
    }
    const result = await autosave.flushNow(draft);
    if (result.ok) return;
    if (networkSavePausedRef.current || autosave.isNetworkPaused) {
      // Diverged, not failed: the write is held back on purpose because the
      // server already holds a newer revision. The author asked to save, so
      // answer with the decision they actually have to make.
      openReview();
      return;
    }
    setNavigationError(SAVE_CONFLICT_COPY.failed);
  }, [autosave, coeditDisplayStatus, draft, openReview, workspaceCollaboration]);

  const handleCreateQuestion = useCallback(
    async (inheritFrom?: QuestionRevision) => {
      if (
        rowMutationFlight.current ||
        !selectedModuleId ||
        !selectedModule ||
        selectedModule.questions.length >= selectedModule.targetQuestionCount
      )
        return;
      if (!(await flushBeforeNavigation())) return;
      try {
        const created = await createQuestion.mutateAsync(selectedModuleId);
        let createdQuestion = created.question;
        if (inheritFrom) {
          const inherited: QuestionRevision = {
            ...created.question,
            metadata: {
              ...created.question.metadata,
              domain: inheritFrom.metadata.domain,
              skill: inheritFrom.metadata.skill,
              difficulty: inheritFrom.metadata.difficulty,
            },
          };
          createdQuestion = await assessmentAuthoringApi.saveQuestionRevision(inherited.id, {
            revision: inherited.revision,
            questionType: inherited.questionType,
            stimulus: inherited.stimulus,
            prompt: inherited.prompt,
            answer: inherited.answer,
            rationale: inherited.rationale,
            metadata: inherited.metadata,
            accessibility: inherited.accessibility,
          });
          updateSummaryCache(created.examQuestionId, createdQuestion);
          void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
        }
        setSelectedExamQuestionId(created.examQuestionId);
        setDraft(createdQuestion);
        announceWorkspaceCommand("question.created", {
          questionId: created.examQuestionId,
          moduleId: selectedModuleId,
        });
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question could not be created."
        );
      }
    },
    [
      announceWorkspaceCommand,
      createQuestion,
      examId,
      flushBeforeNavigation,
      queryClient,
      selectedModule,
      selectedModuleId,
      updateSummaryCache,
    ]
  );

  const handleBatchImport = useCallback(
    async (drafts: BatchQuestionDraft[]) => {
      if (!selectedModuleId) throw new Error("Choose a SAT module before importing questions.");
      if (!(await flushBeforeNavigation()))
        throw new Error("Save the current question before importing.");
      const result = await batchCreate.mutateAsync({
        moduleId: selectedModuleId,
        request: { questions: drafts, operationKey: crypto.randomUUID() },
      });
      await queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      announceWorkspaceCommand("question.created", {
        moduleId: selectedModuleId,
        questionIds: result.createdQuestionIds,
      });
      setImportOpen(false);
      const first = result.createdQuestionIds[0];
      if (first) {
        setSelectedExamQuestionId(first);
        setDraft(null);
      }
    },
    [announceWorkspaceCommand, batchCreate, examId, flushBeforeNavigation, queryClient, selectedModuleId, setImportOpen]
  );

  const openWorkbookImport = useCallback(async () => {
    setNavigationError(null);
    if (!(await flushBeforeNavigation())) return;
    try {
      const baseline = await assessmentAuthoringApi.getShell(examId);
      setWorkbookBaseline(baseline);
      setWorkbookImportOpen(true);
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "The SAT workbook importer could not be opened."
      );
    }
  }, [examId, flushBeforeNavigation, setWorkbookImportOpen]);

  const handleWorkbookCommitted = useCallback(
    (result: SatWorkbookCommitResult) => {
      const nextShell = result.shell;
      queryClient.setQueryData(assessmentKeys.shell(examId), nextShell);
      queryClient.removeQueries({ queryKey: ["assessment-question"] });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      const firstModule = nextShell.sections[0]?.modules[0] ?? null;
      setWorkspaceMode("build");
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
      setDraft(null);
      setSelectedModuleId(firstModule?.id ?? null);
      setSelectedExamQuestionId(firstModule?.questions[0]?.examQuestionId ?? null);
      setWorkbookImportOpen(false);
      setWorkbookBaseline(null);
      setWorkbookUndo(result.undo.available ? result.undo : null);
      announceWorkspaceCommand("workbook.imported", {
        questionCount: nextShell.sections.reduce(
          (total, section) => total + section.modules.reduce((count, module) => count + module.questions.length, 0),
          0,
        ),
      });
    },
    [announceWorkspaceCommand, examId, queryClient, setWorkbookImportOpen]
  );

  const handleWorkbookUndo = useCallback(async () => {
    if (!workbookUndo?.available || workbookUndoBusy) return;
    if (autosave.status !== "saved") {
      setWorkbookUndo(null);
      setNavigationError("Undo is no longer available after editing the imported SAT.");
      return;
    }
    setWorkbookUndoBusy(true);
    setNavigationError(null);
    try {
      const nextShell = await assessmentAuthoringApi.undoSatWorkbookImport(
        examId,
        workbookUndo.importId
      );
      queryClient.setQueryData(assessmentKeys.shell(examId), nextShell);
      queryClient.removeQueries({ queryKey: ["assessment-question"] });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      const firstModule = nextShell.sections[0]?.modules[0] ?? null;
      setWorkspaceMode("build");
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
      setDraft(null);
      setSelectedModuleId(firstModule?.id ?? null);
      setSelectedExamQuestionId(firstModule?.questions[0]?.examQuestionId ?? null);
      setWorkbookUndo(null);
      announceWorkspaceCommand("workbook.undone", { importId: workbookUndo.importId });
    } catch (error) {
      setWorkbookUndo(null);
      setNavigationError(
        error instanceof Error ? error.message : "The Excel import could not be undone."
      );
    } finally {
      setWorkbookUndoBusy(false);
    }
  }, [announceWorkspaceCommand, autosave.status, examId, queryClient, workbookUndo, workbookUndoBusy]);

  const handleLoadSampleExam = useCallback(async () => {
    setNavigationError(null);
    if (!(await flushBeforeNavigation())) return;
    try {
      const latestShell = await assessmentAuthoringApi.getShell(examId);
      const { buildCompleteSatSample } = await import("../providers/sat/sampleExam");
      const nextShell = await loadSampleExam.mutateAsync(buildCompleteSatSample(latestShell));
      const firstModule = nextShell.sections[0]?.modules[0] ?? null;
      setWorkspaceMode("build");
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
      setDraft(null);
      setSelectedModuleId(firstModule?.id ?? null);
      setSelectedExamQuestionId(firstModule?.questions[0]?.examQuestionId ?? null);
      setSampleDialogOpen(false);
      announceWorkspaceCommand("sample.loaded", { questionCount: nextShell.sections.reduce((total, section) => total + section.modules.reduce((count, module) => count + module.questions.length, 0), 0) });
    } catch (error) {
      setSampleDialogOpen(false);
      setNavigationError(
        error instanceof Error ? error.message : "The sample SAT could not be loaded."
      );
    }
  }, [announceWorkspaceCommand, examId, flushBeforeNavigation, loadSampleExam, setSampleDialogOpen]);

  // Explicit target IDs: never select a row and invoke a stale selected-row closure.
  const handleDuplicate = useCallback(async (targetId = selectedExamQuestionId) => {
    const module = shell?.sections.flatMap(section=>section.modules).find(module=>module.questions.some(q=>q.examQuestionId===targetId));
    if (!targetId || !module || module.questions.length>=module.targetQuestionCount || rowMutationFlight.current) return;
    rowMutationFlight.current=true;setRowMutationBusy(true);
    try {
      if (!(await flushBeforeNavigation())) return;
      const created=await duplicateQuestion.mutateAsync({examQuestionId:targetId,request:{destinationModuleId:module.id,insertAfterExamQuestionId:targetId,operationKey:crypto.randomUUID()}});
      setSelectedModuleId(module.id);setSelectedExamQuestionId(created.examQuestionId);setDraft(created.question);
      announceWorkspaceCommand("question.duplicated", { questionId: created.examQuestionId, sourceQuestionId: targetId, moduleId: module.id });
    } catch(error) {setNavigationError(error instanceof Error?error.message:"Question could not be duplicated.");}
    finally {rowMutationFlight.current=false;setRowMutationBusy(false);}
  },[announceWorkspaceCommand,duplicateQuestion,flushBeforeNavigation,selectedExamQuestionId,shell]);

  const handleDelete = useCallback(async (targetId = selectedExamQuestionId) => {
    const module=shell?.sections.flatMap(section=>section.modules).find(module=>module.questions.some(q=>q.examQuestionId===targetId));
    if(!targetId||!module||rowMutationFlight.current)return false;
    rowMutationFlight.current=true;setRowMutationBusy(true);
    const deletingActive=targetId===selectedExamQuestionId;
    const index=module.questions.findIndex(q=>q.examQuestionId===targetId);
    const fallback=selectionAfterDelete(module.questions.filter(q=>q.examQuestionId!==targetId),index);
    try {
      if(!(await flushBeforeNavigation()))return false;
      await assessmentAuthoringApi.deleteQuestion(targetId);
      queryClient.removeQueries({queryKey:assessmentKeys.question(targetId)});
      if(deletingActive){setDraft(null);setSelectedExamQuestionId(fallback.examQuestionId);}
      setSelectedIds(current=>{const next=new Set(current);next.delete(targetId);return next;});
      await queryClient.invalidateQueries({queryKey:assessmentKeys.shell(examId)});
      void queryClient.invalidateQueries({queryKey:assessmentKeys.release(examId)});
      void queryClient.invalidateQueries({queryKey:assessmentKeys.readinessRoot(examId)});
      announceWorkspaceCommand("question.deleted", { questionId: targetId, moduleId: module.id });
      return true;
    }catch(error){setNavigationError(error instanceof Error?error.message:"Question could not be deleted.");return false;}
    finally {rowMutationFlight.current=false;setRowMutationBusy(false);}
  },[announceWorkspaceCommand,examId,flushBeforeNavigation,queryClient,selectedExamQuestionId,shell]);

  const handleSaveAndNext = useCallback(async () => {
    if (rowMutationFlight.current || !draft || !selectedModule) return;
    if (workspaceCollaboration) {
      if (coeditDisplayStatus === "error") {
        workspaceCollaboration.retry();
        return;
      }
      const currentIndex = selectedModule.questions.findIndex(
        (question) => question.examQuestionId === selectedExamQuestionId
      );
      const next = selectedModule.questions[currentIndex + 1];
      if (next) {
        setDraft(null);
        setSelectedExamQuestionId(next.examQuestionId);
        return;
      }
      if (selectedModule.questions.length < selectedModule.targetQuestionCount) {
        await handleCreateQuestion(keepMetadataForNext ? draft : undefined);
      }
      return;
    }
    const result = await autosave.commitAndAdvance(draft);
    if (!result.ok || !result.isLatest) {
      setNavigationError("Save failed. The next question was not opened.");
      return;
    }
    const currentIndex = selectedModule.questions.findIndex(
      (question) => question.examQuestionId === selectedExamQuestionId
    );
    const next = selectedModule.questions[currentIndex + 1];
    if (next) {
      setDraft(null);
      setSelectedExamQuestionId(next.examQuestionId);
      return;
    }
    if (selectedModule.questions.length < selectedModule.targetQuestionCount)
      await handleCreateQuestion(keepMetadataForNext ? draft : undefined);
  }, [
    autosave,
    coeditDisplayStatus,
    draft,
    handleCreateQuestion,
    keepMetadataForNext,
    selectedExamQuestionId,
    selectedModule,
    workspaceCollaboration,
  ]);

  const handleReorder = useCallback(
    async (questionIds: string[], expectedQuestionIds: string[]) => {
      if (!selectedModuleId || !(await flushBeforeNavigation())) return;
      try {
        await reorderQuestions.mutateAsync({
          moduleId: selectedModuleId,
          request: { questionIds, expectedQuestionIds },
        });
        announceWorkspaceCommand("question.reordered", {
          moduleId: selectedModuleId,
          questionIds,
        });
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question order could not be saved."
        );
        throw error;
      }
    },
    [announceWorkspaceCommand, flushBeforeNavigation, reorderQuestions, selectedModuleId]
  );

  const handleBulkAction = useCallback(
    async (
      questionIds: string[],
      action: BulkQuestionAction,
      expectedRevisions?: Record<string, number>
    ) => {
      if (!(await flushBeforeNavigation()))
        throw new Error("Save the current question before applying a bulk action.");
      try {
        await bulkQuestions.mutateAsync({
          questionIds,
          action,
          ...(expectedRevisions ? { expectedRevisions } : {}),
          operationKey: crypto.randomUUID(),
        });
        announceWorkspaceCommand("question.bulk_changed", {
          questionIds,
          action,
        });
        setSelectedIds(new Set());
        selectionAnchorRef.current = null;
        if (
          action.type === "delete" &&
          selectedExamQuestionId &&
          questionIds.includes(selectedExamQuestionId)
        ) {
          setDraft(null);
          setSelectedExamQuestionId(null);
        }
        if (
          action.type === "move" &&
          selectedExamQuestionId &&
          questionIds.includes(selectedExamQuestionId)
        )
          setSelectedModuleId(action.destinationModuleId);
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Bulk action could not be completed."
        );
        throw error;
      }
    },
    [announceWorkspaceCommand, bulkQuestions, flushBeforeNavigation, selectedExamQuestionId]
  );

  const handlePretestChange = useCallback(
    (isPretest: boolean) => {
      if (!selectedExamQuestionId) return;
      if (workspaceCollaboration) {
        const path = `question/${selectedExamQuestionId}/scalar`;
        const current = workspaceCollaboration.workspaceSnapshot.values[path];
        const scalar = isQuestionWorkspaceScalar(current)
          ? { ...current, isPretest }
          : draft
            ? questionWorkspaceScalar(draft, isPretest)
            : null;
        if (scalar) workspaceCollaboration.setValue(path, scalar);
        return;
      }
      void handleBulkAction(
        [selectedExamQuestionId],
        { type: "set_pretest", value: isPretest },
      ).catch(() => undefined);
    },
    [draft, handleBulkAction, selectedExamQuestionId, workspaceCollaboration],
  );

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

  const openIssues = useCallback(async () => {
    if (!(await flushBeforeNavigation())) return;
    setWorkspaceMode("issues");
    try {
      await validation.mutateAsync();
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Validation could not be completed."
      );
    }
  }, [flushBeforeNavigation, validation]);

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

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      const interactive = Boolean(
        target?.closest(
          'button, a[href], summary, [role="button"], [role="menu"], [role^="menuitem"], [role="dialog"], [data-radix-popper-content-wrapper]'
        )
      );
      const inOverlay = Boolean(
        target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')
      );
      if (event.defaultPrevented || event.isComposing || inOverlay) return;
      if(command&&event.key.toLowerCase()==='s'){
        if(event.shiftKey){if(!editing){event.preventDefault();openInspector();}return;}
        event.preventDefault();void handleSaveNow();return;
      }
      if(!editing&&command&&event.key==='/'){event.preventDefault();setShortcutHelpOpen(true);return;}
      if (interactive || editing) {
        if (editing && event.key === "Escape") {
          (document.activeElement as HTMLElement | null)?.blur();
          document
            .querySelector<HTMLElement>(`[data-question-list-row="${selectedExamQuestionId}"] button`)
            ?.focus();
        }
        return;
      }
      if (command && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setWorkspaceMode("build");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (selectedModule) {
          setWorkspaceMode("build");
          setJumpPaletteOpen(true);
          return;
        }
        setWorkspaceMode("build");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (!command && event.key === "?") {
        event.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        void handleSaveAndNext();
        return;
      }
      if (command && /^[1-4]$/.test(event.key) && draft?.answer.kind === "single_choice") {
        event.preventDefault();
        const optionId = draft.answer.options[Number(event.key) - 1]?.id;
        if (optionId)
          handleChange({ ...draft, answer: { ...draft.answer, correctOptionId: optionId } });
        return;
      }
      if (command && event.key.toLowerCase() === "d" && !interactive && !editing) {
        event.preventDefault();
        void handleDuplicate();
        return;
      }
      if (!interactive && !inOverlay && !editing && !command && (event.key === "ArrowDown" || event.key === "ArrowUp") && selectedModule) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = selectedModule.questions[selectedModuleIndex + direction];
        if (next) {
          event.preventDefault();
          void selectQuestion(next.examQuestionId);
        }
        return;
      }
      if (!interactive && !inOverlay && !editing && (event.key === "j" || event.key === "k") && selectedModule) {
        const direction = event.key === "j" ? 1 : -1;
        const next = selectedModule.questions[selectedModuleIndex + direction];
        if (next) {
          event.preventDefault();
          void selectQuestion(next.examQuestionId);
        }
        return;
      }
      if (!interactive && !inOverlay && !editing && event.code === "Space" && draft) {
        event.preventDefault();
        setPreviewOpen((value) => !value);
        return;
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [
    draft,
    handleChange,
    handleDuplicate,
    handleSaveAndNext,
    handleSaveNow,
    selectQuestion,
    selectedExamQuestionId,
    selectedModule,
    selectedModuleIndex,
    setJumpPaletteOpen,setPreviewOpen,setShortcutHelpOpen,openInspector,
  ]);

  if (shellQuery.isLoading) return <SatAuthoringLoadingSurface label="Opening SAT workspace…" />;
  // Phase 04: the shell query is now GET-only. A 404 means "no editable draft
  // yet" — a state DISTINCT from the generic error surface. Editors get an
  // explicit, role-gated "Open draft" CTA that runs the ensure mutation
  // (POST) once per click; observers never see the CTA and never trigger it.
  // Ensure success installs the shell via setQueryData so this component
  // re-renders with data; ensure failure shows the error with no auto-loop.
  const isNoDraft = !shell && isBackendNotFound(shellQuery.error);
  if (isNoDraft) {
    const ensureInfo = ensureDraft.error
      ? toEnsureDraftShellErrorInfo(ensureDraft.error)
      : null;
    const ensureDescription =
      ensureInfo?.kind === "exam-missing"
        ? "This exam does not exist, so there is no draft to open."
        : ensureInfo?.kind === "forbidden"
          ? "You do not have permission to open an editable draft for this exam."
          : ensureInfo?.kind === "conflict"
            ? "The draft changed while opening. Retry the open, or refresh to load the latest state."
            : ensureInfo
              ? ensureInfo.message
              : "This exam has no editable draft yet. Opening a draft creates one explicitly — refreshing never creates one.";
    return (
      <SatAuthoringErrorSurface
        title="No editable draft"
        description={ensureDescription}
        actionLabel={canOpenDraft ? (ensureDraft.isPending ? "Opening draft…" : "Open draft") : undefined}
        onAction={
          canOpenDraft
            ? () => {
                if (ensureDraft.isPending) return;
                ensureDraft.mutate();
              }
            : undefined
        }
        actionDisabled={ensureDraft.isPending}
      />
    );
  }
  if (shellQuery.error || !shell)
    return (
      <SatAuthoringErrorSurface
        title="Unable to load the SAT authoring workspace"
        description={
          shellQuery.error instanceof Error
            ? shellQuery.error.message
            : "This SAT draft is unavailable right now."
        }
        actionLabel="Retry"
        onAction={() => void shellQuery.refetch()}
      />
    );

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
                    status={combineSaveStatus(autosave.status, coeditSaveStatus)}
                    lastSavedAt={autosave.lastSavedAt}
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
              {deviceDraftRecovery ? (
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
                  saveStatus={combineSaveStatus(autosave.status, coeditSaveStatus)}
                  lastSavedAt={autosave.lastSavedAt}
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
          saveStatus={autosave.status}
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
            onClose={() => {
              setWorkbookImportOpen(false);
              setWorkbookBaseline(null);
            }}
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
