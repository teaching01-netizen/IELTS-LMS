import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ListChecks,
  PencilLine,
} from "lucide-react";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
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
import { isBackendNotFound } from "../../../services/backendBridge";
import { useQuestionAutosave } from "../hooks/useQuestionAutosave";
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
import { QuestionPresenceBadge } from "./collaboration/QuestionPresenceBadge";
import {
  DELETION_COPY,
  PRESENCE_COPY,
  PUBLISH_COPY,
  STRUCTURAL_COPY,
  questionLabel,
} from "./collaboration/collaborationCopy";
import {
  hasStructuredContent,
  plainTextFromContent,
  supportsFastPlainEditing,
} from "../editor/richContent";
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
import { resolveAuthoringField } from "./spine/readinessFamilies";
import { Inspector } from "./spine/Inspector";
import { useRailWidth } from "./spine/RailResizer";
import { useOverlayStack } from "./spine/useOverlayStack";
import { useOverlayToggle } from "./spine/useOverlayToggle";
import { SaveCluster } from "./spine/SaveCluster";
import { flashAuthoringField } from "./spine/TargetFlash";
import { motion, useReducedMotion } from "motion/react";
import { spineMotion } from "@/src/shared/motion";

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

type WorkspaceMode = "build" | "overview" | "issues";

export function AuthoringWorkspace({ examId, examTitle }: AuthoringWorkspaceProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authSession = useOptionalAuthSession();
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const questionQuery = useExamQuestion(selectedExamQuestionId);
  const reduceMotion = useReducedMotion();
  const shell = shellQuery.data;
  const questionDraftKey = selectedExamQuestionId
    ? buildStaffDraftKey(staffActorId, "assessment-question", examId, selectedExamQuestionId)
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

  const saveDraft = useCallback(
    async (revision: QuestionRevision) => {
      const examQuestionId = selectedExamQuestionId;
      if (!examQuestionId) throw new Error("Cannot save a question that is not selected.");
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
      const saved = await assessmentAuthoringApi.saveQuestionRevision(revision.id, {
        revision: revision.revision,
        questionType: revision.questionType,
        stimulus: revision.stimulus,
        prompt: revision.prompt,
        answer: revision.answer,
        rationale: revision.rationale,
        metadata: revision.metadata,
        accessibility: revision.accessibility,
      });
      setDraft(saved);
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
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.shell(examId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.readinessRoot(examId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.release(examId),
        refetchType: "none",
      });
      return saved;
    },
    [examId, queryClient, questionDraftKey, selectedExamQuestionId, updateSummaryCache]
  );

  const autosave = useQuestionAutosave({
    save: saveDraft,
    durableKey: questionDraftKey,
    autoSaveRecovered: false,
    networkPausedRef: networkSavePausedRef,
    onRecover: (recovered) => {
      if (!questionDraftKey) return;
      recoveredQuestionDraftKeyRef.current = questionDraftKey;
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
  const realtimeDeliveryEnabled = effectiveCapabilities.delivery;
  const isQuestionDirtyForRealtime = useCallback(
    (examQuestionId: string) =>
      examQuestionId === selectedExamQuestionId && autosave.hasPendingChanges,
    [selectedExamQuestionId, autosave.hasPendingChanges]
  );
  const handleRealtimeLifecycle = useCallback(
    (signal: "draft-replaced" | "published" | "exam-changed") => {
      // Re-fetch the shell so the workspace re-resolves the current draft; the
      // draft binding change re-mounts the socket against the new draft.
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      if (signal === "published") {
        setPublishedFrozen(true);
      }
    },
    [examId, queryClient]
  );

  // Phase 05 divergence: driven by the Phase 04 reconciler seams, so the
  // decision of WHAT happened stays in one place and this only records state.
  const [publishedFrozen, setPublishedFrozen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

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

  const baseQuestion = questionQuery.data?.question ?? null;
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
      setDraft(questionQuery.data.question);
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
      setDraft(latest);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldWarn =
      autosave.hasPendingChanges &&
      (autosave.isOffline || ["unsaved", "saving", "error"].includes(autosave.status));
    if (!shouldWarn) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [autosave.hasPendingChanges, autosave.isOffline, autosave.status]);

  const flushBeforeNavigation = useCallback(async () => {
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
  }, [autosave, draft]);

  const selectQuestion = useCallback(
    async (questionId: string, moduleId = selectedModuleId) => {
      if (rowMutationFlight.current) return false;
      if (questionId === selectedExamQuestionId) return true;
      setNavigationError(null);
      if (!(await flushBeforeNavigation())) return false;
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
      if (!(await flushBeforeNavigation())) return;
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
      autosave.scheduleAutosave(next);
    },
    [autosave]
  );
  const handleSaveNow = useCallback(async () => {
    if (!draft) return;
    setNavigationError(null);
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
  }, [autosave, draft, openReview]);

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
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question could not be created."
        );
      }
    },
    [
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
      setImportOpen(false);
      const first = result.createdQuestionIds[0];
      if (first) {
        setSelectedExamQuestionId(first);
        setDraft(null);
      }
    },
    [batchCreate, examId, flushBeforeNavigation, queryClient, selectedModuleId, setImportOpen]
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
    },
    [examId, queryClient, setWorkbookImportOpen]
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
    } catch (error) {
      setWorkbookUndo(null);
      setNavigationError(
        error instanceof Error ? error.message : "The Excel import could not be undone."
      );
    } finally {
      setWorkbookUndoBusy(false);
    }
  }, [autosave.status, examId, queryClient, workbookUndo, workbookUndoBusy]);

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
    } catch (error) {
      setSampleDialogOpen(false);
      setNavigationError(
        error instanceof Error ? error.message : "The sample SAT could not be loaded."
      );
    }
  }, [examId, flushBeforeNavigation, loadSampleExam, setSampleDialogOpen]);

  // Explicit target IDs: never select a row and invoke a stale selected-row closure.
  const handleDuplicate = useCallback(async (targetId = selectedExamQuestionId) => {
    const module = shell?.sections.flatMap(section=>section.modules).find(module=>module.questions.some(q=>q.examQuestionId===targetId));
    if (!targetId || !module || module.questions.length>=module.targetQuestionCount || rowMutationFlight.current) return;
    rowMutationFlight.current=true;setRowMutationBusy(true);
    try {
      if (!(await flushBeforeNavigation())) return;
      const created=await duplicateQuestion.mutateAsync({examQuestionId:targetId,request:{destinationModuleId:module.id,insertAfterExamQuestionId:targetId,operationKey:crypto.randomUUID()}});
      setSelectedModuleId(module.id);setSelectedExamQuestionId(created.examQuestionId);setDraft(created.question);
    } catch(error) {setNavigationError(error instanceof Error?error.message:"Question could not be duplicated.");}
    finally {rowMutationFlight.current=false;setRowMutationBusy(false);}
  },[duplicateQuestion,flushBeforeNavigation,selectedExamQuestionId,shell]);

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
      return true;
    }catch(error){setNavigationError(error instanceof Error?error.message:"Question could not be deleted.");return false;}
    finally {rowMutationFlight.current=false;setRowMutationBusy(false);}
  },[examId,flushBeforeNavigation,queryClient,selectedExamQuestionId,shell]);

  const handleSaveAndNext = useCallback(async () => {
    if (rowMutationFlight.current || !draft || !selectedModule) return;
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
    draft,
    handleCreateQuestion,
    keepMetadataForNext,
    selectedExamQuestionId,
    selectedModule,
  ]);

  const handleReorder = useCallback(
    async (questionIds: string[], expectedQuestionIds: string[]) => {
      if (!selectedModuleId || !(await flushBeforeNavigation())) return;
      try {
        await reorderQuestions.mutateAsync({
          moduleId: selectedModuleId,
          request: { questionIds, expectedQuestionIds },
        });
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question order could not be saved."
        );
        throw error;
      }
    },
    [flushBeforeNavigation, reorderQuestions, selectedModuleId]
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
    [bulkQuestions, flushBeforeNavigation, selectedExamQuestionId]
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
                draft ? (
                  <SaveCluster
                    transientSaved
                    announce={false}
                    status={autosave.status}
                    lastSavedAt={autosave.lastSavedAt}
                    diverged={Boolean(diverged) || Boolean(publishedFrozen)}
                    onRetry={() => autosave.retry(draft)}
                    onReviewConflict={openReview}
                  />
                ) : null
              }
              workbookImportDisabled={!shell}
              onOpenWorkbookImport={() => void openWorkbookImport()}
              previewDisabled={!shell}
              onOpenFullPreview={() => {
                void (async () => {
                  if (await flushBeforeNavigation()) navigate(`/sat/exams/${examId}/preview`);
                })();
              }}
              onOpenRelease={() => {
                void (async () => {
                  if (await flushBeforeNavigation()) navigate(`/sat/exams/${examId}/release`);
                })();
              }}
              onBack={() => {
                void (async () => {
                  if (await flushBeforeNavigation()) navigate("/sat/exams");
                })();
              }}
              onOpenQueue={() => setQuestionListOpen(true)}
              collaborationSlot={
                effectiveCapabilities.presence ? (
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
          inspector={draft?<Inspector open={inspectorOpen&&(!inspectorModal||overlayStack.openSheet==='inspector')} modal={inspectorModal} question={draft} issues={selectedQuestionIssues} onChange={handleChange} onClose={closeInspector} isPretest={questionQuery.data?.isPretest} onPretestChange={selectedExamQuestionId?(isPretest)=>{void handleBulkAction([selectedExamQuestionId],{type:'set_pretest',value:isPretest}).catch(()=>undefined);}:undefined}/>:undefined}
          banner={
            <>
              {navigationError ? (
                <div role="alert" className="border-b px-5 py-2 text-center text-xs font-medium">
                  {navigationError}
                </div>
              ) : null}
              {activeRaceNotice ? (
                <div className="border-b px-5 py-2 text-center text-xs font-semibold text-destructive">
                  {activeRaceNotice}
                </div>
              ) : null}
              {diverged && !noticeDismissed ? (
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
                  saveStatus={autosave.status}
                  lastSavedAt={autosave.lastSavedAt}
                  issues={selectedQuestionIssues}
                  keepMetadataForNext={keepMetadataForNext}
                  onKeepMetadataForNextChange={setKeepMetadataForNext}
                  onChange={handleChange}
                  onSaveNow={() => void handleSaveNow()}
                  onSaveAndNext={() => void handleSaveAndNext()}
                  onRetrySave={() => autosave.retry(draft)}
                  // One Review behavior for both save-cluster sites. The footer
                  // used to answer this click with a page message that told the
                  // author to reload and retype work the app was already
                  // holding, while the header opened the real surface.
                  onReviewConflict={openReview}
                  diverged={Boolean(diverged) || Boolean(publishedFrozen)}
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
              {id:'preview',label:'Preview exam',group:'Exam',onSelect:()=>{void flushBeforeNavigation().then(ok=>{if(ok)navigate(`/sat/exams/${examId}/preview`);});}},
              {id:'release',label:'Release exam',group:'Exam',onSelect:()=>{void flushBeforeNavigation().then(ok=>{if(ok)navigate(`/sat/exams/${examId}/release`);});}},
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

function summaryFromRevision(
  summary: AssessmentQuestionSummary,
  question: QuestionRevision
): AssessmentQuestionSummary {
  const issues = validateSatQuestion(question.metadata.sectionKey, question);
  const blockingIssueCount = issues.filter((issue) => issue.blocking).length;
  const hasInvalid = issues.some(
    (issue) =>
      issue.blocking && !issue.code.endsWith(".required") && issue.code !== "sat.choice.count"
  );
  const readiness = blockingIssueCount === 0 ? "ready" : hasInvalid ? "error" : "incomplete";
  const answerKeyPreview =
    question.answer.kind === "single_choice"
      ? question.answer.correctOptionId
      : (question.answer.acceptedResponses.find((value) => value.trim()) ?? null);
  const choicePlain =
    question.answer.kind !== "single_choice" ||
    question.answer.options.every((option) => supportsFastPlainEditing(option.content));
  const contentComplexity =
    supportsFastPlainEditing(question.stimulus) &&
    supportsFastPlainEditing(question.prompt) &&
    supportsFastPlainEditing(question.rationale) &&
    choicePlain
      ? "plain"
      : "rich";
  return {
    ...summary,
    questionRevisionId: question.id,
    questionType: question.questionType,
    revision: question.revision,
    semanticRevision: question.semanticRevision,
    promptPreview: truncatePreview(plainTextFromContent(question.prompt), 180),
    answerKeyPreview,
    domain: question.metadata.domain,
    skill: question.metadata.skill,
    difficulty: question.metadata.difficulty,
    tags: question.metadata.tags,
    hasStimulus: hasStructuredContent(question.stimulus),
    contentComplexity,
    readiness: {
      status: readiness,
      blockingIssueCount,
      warningCount: issues.filter((issue) => !issue.blocking).length,
    },
  };
}

function truncatePreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function IssuesPane({
  report,
  loading,
  onRefresh,
  onOpenIssue,
}: {
  report: { errors: AssessmentValidationIssue[]; warnings: AssessmentValidationIssue[] } | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenIssue: (issue: AssessmentValidationIssue) => void;
}) {
  const issues = report ? [...report.errors, ...report.warnings] : [];
  const errorCount = report?.errors.length ?? 0;
  const warningCount = report?.warnings.length ?? 0;
  return (
    <section
      className="authoring-issues-pane flex w-[var(--authoring-sidebar-width)] min-w-0 flex-col border-r border-au-separator bg-au-surface"
      aria-label="SAT authoring issues"
    >
      <div className="flex items-center justify-between gap-3 border-b border-au-separator px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-slate-900">Issues</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Validation across the current SAT draft
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="authoring-interactive min-h-9 shrink-0 rounded-[10px] px-3 text-[12px] font-semibold text-slate-600 hover:bg-au-fill disabled:opacity-40"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      {report ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-au-separator px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-au-danger-tint px-2.5 py-1 text-[11px] font-semibold text-au-danger-text">
            <span className="h-1.5 w-1.5 rounded-full bg-au-danger" aria-hidden="true" />
            {errorCount} blocking
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-au-warning-tint px-2.5 py-1 text-[11px] font-semibold text-au-warning-text">
            <span className="h-1.5 w-1.5 rounded-full bg-au-warning" aria-hidden="true" />
            {warningCount} warnings
          </span>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-live="polite" aria-busy={loading}>
        {loading && !report ? (
          <div className="p-6 text-center text-[12px] text-slate-500">
            Checking every module and question…
          </div>
        ) : issues.length ? (
          issues.map((issue, index) => {
            const actionable = issue.path.startsWith("examQuestion:");
            return (
              <button
                key={`${issue.code}-${issue.path}-${index}`}
                type="button"
                disabled={!actionable}
                onClick={() => onOpenIssue(issue)}
                className={`authoring-interactive mb-1.5 flex w-full gap-2.5 rounded-[12px] p-3 text-left ${issue.blocking ? "bg-au-danger-tint" : "bg-au-warning-tint"} ${actionable ? "hover:ring-1 hover:ring-au-separator-strong" : "cursor-default"}`}
              >
                <AlertCircle
                  size={14}
                  aria-hidden="true"
                  className={`mt-0.5 shrink-0 ${issue.blocking ? "text-au-danger" : "text-au-warning"}`}
                />
                <span className="min-w-0">
                  <span
                    className={`block text-[12px] font-semibold leading-5 ${issue.blocking ? "text-au-danger-text" : "text-au-warning-text"}`}
                  >
                    {issue.message}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-slate-400">
                    {actionable ? "Open question and field" : issue.path}
                  </span>
                </span>
              </button>
            );
          })
        ) : report ? (
          <div className="p-8 text-center">
            <span
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-[13px] bg-au-success-tint text-au-success"
              aria-hidden="true"
            >
              <ListChecks size={20} aria-hidden="true" />
            </span>
            <p className="mt-3 text-[12px] font-semibold text-slate-800">No validation issues</p>
            <p className="mt-1 text-[11px] text-slate-500">
              This SAT draft passes current authoring validation.
            </p>
          </div>
        ) : (
          <div className="p-8 text-center text-[12px] text-slate-500">
            Run validation to review authoring issues.
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyEditor({
  moduleTitle,
  onCreate,
}: {
  moduleTitle: string | null;
  onCreate?: () => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-8 pb-24 text-center">
      <div className="max-w-[320px]">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-au-fill text-slate-500"
          aria-hidden="true"
        >
          <PencilLine size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <p className="mt-4 text-[15px] font-semibold tracking-[-0.018em] text-slate-900">
          {moduleTitle ? `Choose a question in ${moduleTitle}` : "Choose a module"}
        </p>
        <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
          The question list is the work queue; the editor opens only the selected item.
        </p>
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="authoring-interactive mt-4 inline-flex min-h-10 items-center rounded-[11px] bg-au-accent px-4 text-[12px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active"
          >
            Create next question
          </button>
        ) : null}
      </div>
    </div>
  );
}

function QuestionLoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <section
        className="authoring-surface authoring-surface--error w-full max-w-lg p-6 sm:p-8"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-au-danger-tint text-au-danger-text">
            <AlertCircle size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-950">
              Question could not be loaded
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-slate-600">
              {error instanceof Error ? error.message : "This question is unavailable right now."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="authoring-interactive mt-6 inline-flex min-h-10 items-center rounded-[11px] bg-au-accent px-4 text-[12px] font-semibold text-white hover:bg-au-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2"
        >
          Retry question
        </button>
      </section>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div
      className="mx-auto my-5 w-[calc(100%-2rem)] max-w-[940px] animate-pulse space-y-6 px-6 pb-24 pt-8 sm:my-7 sm:px-10"
      role="status"
      aria-label="Loading question"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2.5">
          <div className="h-4 w-44 rounded-md bg-au-fill" />
          <div className="h-3 w-28 rounded-md bg-au-fill" />
        </div>
        <div className="flex shrink-0 gap-2">
          <div className="h-9 w-[104px] rounded-[10px] bg-au-fill" />
          <div className="h-9 w-9 rounded-[10px] bg-au-fill" />
        </div>
      </div>
      <div className="authoring-metadata-bar h-[58px] rounded-[13px]" />
      <div className="space-y-2.5">
        <div className="h-3.5 w-36 rounded bg-au-fill" />
        <div className="h-[92px] rounded-[12px] bg-au-fill" />
      </div>
      <div className="space-y-2.5">
        <div className="h-3.5 w-24 rounded bg-au-fill" />
        <div className="h-[112px] rounded-[12px] bg-au-fill" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-[58px] rounded-[12px] bg-au-fill" />
        ))}
      </div>
    </div>
  );
}

export function getShellProvider(shell: AssessmentAuthoringShell): string {
  return shell.providerKey;
}
