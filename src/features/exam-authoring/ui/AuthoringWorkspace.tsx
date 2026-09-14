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
  StructuredContent,
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
import {
  coeditDisplayStatusFor,
  coeditSaveStatusFor,
  combineSaveStatus,
  type CoeditSaveDisplayStatus,
} from "./spine/coeditSaveTruth";
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
import {
  isPromptOnlyChange,
  colorForActor,
  resolveCoeditEnabled,
  savePromptFreeFields,
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

type QuestionWorkspaceScalar = {
  questionType: QuestionRevision["questionType"];
  answer: QuestionRevision["answer"] | { kind: "single_choice"; options: Array<{ id: string }>; correctOptionId: string | null };
  metadata: QuestionRevision["metadata"];
  accessibility: QuestionRevision["accessibility"];
  isPretest?: boolean;
};

function questionWorkspaceScalar(question: QuestionRevision, isPretest?: boolean): QuestionWorkspaceScalar {
  const answer = question.answer.kind === "single_choice"
    ? {
        kind: "single_choice" as const,
        options: question.answer.options.map(({ id }) => ({ id })),
        correctOptionId: question.answer.correctOptionId,
      }
    : question.answer;
  return {
    questionType: question.questionType,
    answer,
    metadata: question.metadata,
    accessibility: question.accessibility,
    ...(isPretest === undefined ? {} : { isPretest }),
  };
}

function emptyWorkspaceContent(): QuestionRevision["prompt"] {
  return {
    version: 2,
    nodes: [],
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStructuredContent(value: unknown): StructuredContent {
  if (!isRecord(value)) return emptyWorkspaceContent();
  if (value["version"] === 2 && isRecord(value["document"]) && value["document"]["type"] === "doc") {
    return {
      version: 2,
      nodes: Array.isArray(value["nodes"]) ? value["nodes"] as StructuredContent["nodes"] : [],
      document: value["document"] as unknown as StructuredContent["document"],
    };
  }
  if (value["version"] === 1 && Array.isArray(value["nodes"])) {
    return value as unknown as StructuredContent;
  }
  return emptyWorkspaceContent();
}

/** API/database rows can contain pre-v2 or partially shaped rich fields. */
function normalizeQuestionRevision(question: QuestionRevision): QuestionRevision {
  const raw = question as unknown as Record<string, unknown>;
  const rawMetadata = isRecord(raw["metadata"]) ? raw["metadata"] : {};
  const rawAccessibility = isRecord(raw["accessibility"]) ? raw["accessibility"] : {};
  const rawAnswer = isRecord(raw["answer"]) ? raw["answer"] : {};
  const answer = rawAnswer["kind"] === "student_produced_response"
    ? {
        kind: "student_produced_response" as const,
        acceptedResponses: Array.isArray(rawAnswer["acceptedResponses"])
          ? rawAnswer["acceptedResponses"].filter((value): value is string => typeof value === "string")
          : [],
        normalizeFraction: rawAnswer["normalizeFraction"] !== false,
        normalizeDecimal: rawAnswer["normalizeDecimal"] !== false,
        numericTolerance: typeof rawAnswer["numericTolerance"] === "string" ? rawAnswer["numericTolerance"] : null,
      }
    : {
        kind: "single_choice" as const,
        options: (Array.isArray(rawAnswer["options"]) ? rawAnswer["options"] : []).map((option, index) => {
          const rawOption = isRecord(option) ? option : {};
          return {
            id: typeof rawOption["id"] === "string" && rawOption["id"].trim()
              ? rawOption["id"]
              : String.fromCharCode(65 + index),
            content: normalizeStructuredContent(rawOption["content"]),
          };
        }),
        correctOptionId: typeof rawAnswer["correctOptionId"] === "string" ? rawAnswer["correctOptionId"] : null,
      };
  return {
    ...question,
    questionType: question.questionType === "student_produced_response" || question.questionType === "single_choice"
      ? question.questionType
      : answer.kind,
    stimulus: normalizeStructuredContent(raw["stimulus"]),
    prompt: normalizeStructuredContent(raw["prompt"]),
    rationale: normalizeStructuredContent(raw["rationale"]),
    answer,
    metadata: {
      sectionKey: typeof rawMetadata["sectionKey"] === "string" ? rawMetadata["sectionKey"] : "reading-writing",
      domain: typeof rawMetadata["domain"] === "string" ? rawMetadata["domain"] : null,
      skill: typeof rawMetadata["skill"] === "string" ? rawMetadata["skill"] : null,
      difficulty: rawMetadata["difficulty"] === "easy" || rawMetadata["difficulty"] === "hard" ? rawMetadata["difficulty"] : "medium",
      tags: Array.isArray(rawMetadata["tags"])
        ? rawMetadata["tags"].filter((value): value is string => typeof value === "string")
        : [],
    },
    accessibility: {
      longDescription: typeof rawAccessibility["longDescription"] === "string" ? rawAccessibility["longDescription"] : null,
    },
  };
}

function isQuestionWorkspaceScalar(value: unknown): value is QuestionWorkspaceScalar {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate["questionType"] === "single_choice" || candidate["questionType"] === "student_produced_response") &&
    candidate["answer"] !== null &&
    typeof candidate["answer"] === "object" &&
    candidate["metadata"] !== null &&
    typeof candidate["metadata"] === "object" &&
    candidate["accessibility"] !== null &&
    typeof candidate["accessibility"] === "object" &&
    (candidate["isPretest"] === undefined || typeof candidate["isPretest"] === "boolean")
  );
}

type QuestionWorkspaceRich = {
  prompt?: StructuredContent;
  stimulus?: StructuredContent;
  rationale?: StructuredContent;
  choices: Record<string, StructuredContent>;
};

function isWorkspaceRichContent(value: unknown): value is StructuredContent {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["version"] === 2 &&
    candidate["nodes"] !== null &&
    Array.isArray(candidate["nodes"]) &&
    candidate["document"] !== null &&
    typeof candidate["document"] === "object"
  );
}

function questionWorkspaceRich(
  values: Record<string, unknown>,
  questionPath: string,
): QuestionWorkspaceRich | null {
  const prefix = `rich:${questionPath}/`;
  const result: QuestionWorkspaceRich = { choices: {} };
  let found = false;
  const prompt = values[`${prefix}prompt`];
  if (isWorkspaceRichContent(prompt)) {
    result.prompt = prompt;
    found = true;
  }
  const stimulus = values[`${prefix}stimulus`];
  if (isWorkspaceRichContent(stimulus)) {
    result.stimulus = stimulus;
    found = true;
  }
  const rationale = values[`${prefix}rationale`];
  if (isWorkspaceRichContent(rationale)) {
    result.rationale = rationale;
    found = true;
  }
  for (const [path, value] of Object.entries(values)) {
    if (!path.startsWith(`${prefix}choice/`)) continue;
    const optionId = path.slice(`${prefix}choice/`.length);
    if (!optionId || !isWorkspaceRichContent(value)) continue;
    result.choices[optionId] = value;
    found = true;
  }
  return found ? result : null;
}

function applyQuestionWorkspaceRich(
  question: QuestionRevision,
  rich: QuestionWorkspaceRich,
): QuestionRevision {
  const next: QuestionRevision = {
    ...question,
    ...(rich.prompt ? { prompt: rich.prompt } : {}),
    ...(rich.stimulus ? { stimulus: rich.stimulus } : {}),
    ...(rich.rationale ? { rationale: rich.rationale } : {}),
  };
  if (next.answer.kind !== "single_choice") return next;
  return {
    ...next,
    answer: {
      ...next.answer,
      options: next.answer.options.map((option) =>
        (() => {
          const content = rich.choices[option.id];
          return content ? { ...option, content } : option;
        })(),
      ),
    },
  };
}

function applyQuestionWorkspaceScalar(
  question: QuestionRevision,
  scalar: QuestionWorkspaceScalar,
): QuestionRevision {
  if (scalar.answer.kind === "single_choice") {
    const currentOptions = question.answer.kind === "single_choice" ? question.answer.options : [];
    return {
      ...question,
      questionType: scalar.questionType,
      answer: {
        kind: "single_choice",
        options: scalar.answer.options.map(({ id }) => ({
          id,
          content: currentOptions.find((option) => option.id === id)?.content ?? {
            version: 2,
            nodes: [],
            document: { type: "doc", content: [{ type: "paragraph" }] },
          },
        })),
        correctOptionId: scalar.answer.correctOptionId,
      },
      metadata: scalar.metadata,
      accessibility: scalar.accessibility,
    };
  }
  return {
    ...question,
    questionType: scalar.questionType,
    answer: scalar.answer,
    metadata: scalar.metadata,
    accessibility: scalar.accessibility,
  };
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
  // effects below keep current: whether the collaborative document owns the
  // prompt right now, and the last server-acknowledged revision the prompt-free
  // field diff is measured against.
  const coeditOwnsPromptRef = useRef(false);
  const promptFreeBaselineRef = useRef<QuestionRevision | null>(null);
  const localWorkspaceScalarRef = useRef<{ questionId: string; json: string } | null>(null);
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
  const [coeditSaveClock, setCoeditSaveClock] = useState(() => Date.now());
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
      // Prompt co-editing owns the prompt: save everything ELSE through the
      // partial endpoint. The legacy full save carries a prompt, so it would be
      // refused with a typed COEDIT_ACTIVE conflict the moment a co-edit row is
      // active — turning every non-prompt edit into a visible failure. The
      // prompt itself is persisted only by the collaborative store path.
      const saved = coeditOwnsPromptRef.current
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
      promptFreeBaselineRef.current = saved;
      // The baseline advances to the server revision, but the PROMPT keeps the
      // projection the room owns: a partial field write answers with the
      // server's materialized (and therefore older) prompt, and copying that
      // into the draft would show the author stale text in preview/validation
      // and make their next keystroke read as a field change rather than the
      // prompt-only edit it is.
      setDraft(
        coeditOwnsPromptRef.current ? { ...saved, prompt: revision.prompt } : saved
      );
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
  const isQuestionDirtyForRealtime = useCallback(
    (examQuestionId: string) =>
      examQuestionId === selectedExamQuestionId && autosave.hasPendingChanges,
    [selectedExamQuestionId, autosave.hasPendingChanges]
  );
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
  const realtimeDeliveryEnabled = !workspaceUiActive && effectiveCapabilities.delivery;
  const coeditSession = coedit.session;
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

  // Read by `saveDraft`/`handleChange`, which are declared above this point.
  useEffect(() => {
    coeditOwnsPromptRef.current = workspaceUiActive || coeditRoomOpen;
  }, [coeditRoomOpen, workspaceUiActive]);

  // The save truth of the prompt comes from the co-edit acknowledgement, not
  // from the legacy autosave counter, which knows nothing about the CRDT. Both
  // are combined below by taking the LEAST advanced of the two, so neither can
  // claim "Saved" for work the other is still holding.
  const coeditSaveStatus = !workspaceUiActive && coeditRoomOpen
    ? coeditSaveStatusFor(coedit.session?.saveState.name ?? "idle")
    : null;

  // A room that cannot continue must say so and offer the recovery the design
  // requires: copy/export the prompt before a replacement draft is opened.
  const coeditRecovery = workspaceCollaboration?.recovery ?? coeditSession?.recovery ?? null;

  const handleRealtimeLifecycle = useCallback(
    (signal: "draft-replaced" | "published" | "exam-changed") => {
      // Re-fetch the shell so the workspace re-resolves the current draft; the
      // draft binding change re-mounts the socket against the new draft.
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      if (signal === "published") {
        setPublishedFrozen(true);
      }
      if (signal === "draft-replaced") {
        // `draft.replaced` is the durable signal for a replacement (design:
        // "Draft replacement and workbook replacement/undo"). Routing it into
        // the room makes the export offer appear even if the close frame was
        // lost, which is the case the socket alone cannot cover.
        if (workspaceCollaboration) workspaceCollaboration.reportReplaced();
        else coedit.reportReplaced();
      }
    },
    [coedit, examId, queryClient, workspaceCollaboration]
  );

  // Phase 05 divergence: driven by the Phase 04 reconciler seams, so the
  // decision of WHAT happened stays in one place and this only records state.
  const [publishedFrozen, setPublishedFrozen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const coeditPendingSince = workspaceCollaboration?.pendingSince ?? coeditSession?.pendingSince ?? null;
  useEffect(() => {
    if (coeditPendingSince === null) return undefined;
    setCoeditSaveClock(Date.now());
    const timer = globalThis.setInterval(() => setCoeditSaveClock(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [coeditPendingSince]);

  const coeditDisplayStatus: CoeditSaveDisplayStatus | null = workspaceCollaboration
    ? workspaceCollaboration.status === "error" &&
      workspaceCollaboration.lifecyclePhase === "active" &&
      !workspaceCollaboration.workspaceSnapshot.readOnly
      ? "error"
      : workspaceCollaboration.status === "preparing"
        ? "saving"
        : coeditDisplayStatusFor({
            saveState: workspaceCollaboration.workspaceSnapshot.saveState,
            connectionPhase: workspaceCollaboration.connectionPhase,
            hasEstablishedConnection: workspaceCollaboration.workspaceSnapshot.hasEstablishedConnection,
            lifecyclePhase: workspaceCollaboration.lifecyclePhase,
            readOnly: workspaceCollaboration.workspaceSnapshot.readOnly,
            pendingSince: workspaceCollaboration.pendingSince ?? null,
            now: coeditSaveClock,
          })
    : coeditUiActive
      ? coedit.error !== null &&
        (!coeditSession ||
          (coeditSession.lifecyclePhase === "active" && !coeditSession.readOnly))
        ? "error"
        : coeditDisplayStatusFor({
            saveState: coeditSession?.saveState ?? null,
            connectionPhase: coeditSession?.connectionPhase ?? "connecting",
            hasEstablishedConnection: coeditSession?.hasEstablishedConnection ?? false,
            lifecyclePhase: coeditSession?.lifecyclePhase ?? (publishedFrozen ? "frozen" : "active"),
            readOnly: Boolean(coeditSession?.readOnly ?? publishedFrozen),
            pendingSince: coeditPendingSince,
            autosaveStatus: autosave.status,
            now: coeditSaveClock,
          })
      : null;
  const collaborationReadOnly = workspaceCollaboration
    ? workspaceCollaboration.workspaceSnapshot.readOnly || workspaceCollaboration.lifecyclePhase !== "active"
    : Boolean(coeditSession?.readOnly || publishedFrozen);
  const collaborationPublished = Boolean(
    workspaceCollaboration?.workspaceSnapshot.published || coeditSession?.recovery.published,
  );
  const collaborationLifecyclePhase =
    workspaceCollaboration?.lifecyclePhase ?? coeditSession?.lifecyclePhase ?? null;
  const collaborationIsReadOnly =
    workspaceCollaboration?.workspaceSnapshot.readOnly ?? coeditSession?.readOnly ?? null;
  const hasCollaborationSession = Boolean(workspaceCollaboration || coeditSession);

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
  const sharedQuestionScalar = useMemo(() => {
    if (!workspaceCollaboration || !workspaceQuestionPath) return null;
    const value = workspaceCollaboration.workspaceSnapshot.values[`${workspaceQuestionPath}/scalar`];
    return isQuestionWorkspaceScalar(value) ? value : null;
  }, [workspaceCollaboration, workspaceQuestionPath]);
  const sharedQuestionScalarJson = useMemo(
    () => (sharedQuestionScalar ? JSON.stringify(sharedQuestionScalar) : null),
    [sharedQuestionScalar],
  );
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

  // The HTTP question is only the seed. Once the exam-level room has synced,
  // scalar settings are projected into the selected question and all rich
  // fields bind directly to their shared XML fragments.
  useEffect(() => {
    if (
      !workspaceCollaboration ||
      !workspaceQuestionPath ||
      !baseQuestion ||
      !workspaceCollaboration.workspaceSnapshot.ready
    ) return;
    workspaceCollaboration.ensureValue(
      `${workspaceQuestionPath}/scalar`,
      questionWorkspaceScalar(baseQuestion, questionQuery.data?.isPretest),
    );
    workspaceCollaboration.ensureRichField(`${workspaceQuestionPath}/prompt`, baseQuestion.prompt);
    workspaceCollaboration.ensureRichField(`${workspaceQuestionPath}/stimulus`, baseQuestion.stimulus);
    workspaceCollaboration.ensureRichField(`${workspaceQuestionPath}/rationale`, baseQuestion.rationale);
    if (baseQuestion.answer.kind === "single_choice") {
      for (const option of baseQuestion.answer.options) {
        workspaceCollaboration.ensureRichField(
          `${workspaceQuestionPath}/choice/${option.id}`,
          option.content,
        );
      }
    }
  }, [
    baseQuestion,
    questionQuery.data?.isPretest,
    workspaceCollaboration,
    workspaceQuestionPath,
    workspaceCollaboration?.workspaceSnapshot.ready,
  ]);

  useEffect(() => {
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
  }, [draft, selectedExamQuestionId, sharedQuestionScalar, sharedQuestionScalarJson]);

  // A supporting-material or rationale editor may be collapsed locally. Keep
  // the question projection current from the shared XML roots anyway, so
  // remote edits are visible as soon as the section is expanded and are also
  // reflected in preview/validation without requiring a local remount.
  useEffect(() => {
    if (!draft || !sharedQuestionRich || !workspaceQuestionPath) return;
    const next = applyQuestionWorkspaceRich(draft, sharedQuestionRich);
    if (JSON.stringify(next) === JSON.stringify(draft)) return;
    setDraft((current) => {
      if (!current || current.id !== draft.id) return current;
      const projected = applyQuestionWorkspaceRich(current, sharedQuestionRich);
      return JSON.stringify(projected) === JSON.stringify(current) ? current : projected;
    });
  }, [draft, sharedQuestionRich, workspaceQuestionPath]);

  useEffect(() => {
    if (!workspaceCollaboration) return;
    workspaceCollaboration.setPresence({
      surface: "builder",
      ...(selectedExamQuestionId ? { questionId: selectedExamQuestionId } : {}),
    });
  }, [selectedExamQuestionId, workspaceCollaboration?.setPresence]);

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
  // thrown away (design 2026-09-13, "Offline and recovery behavior").
  const copyCoeditPrompt = useCallback(async () => {
    const exported = coeditRecovery?.exportPrompt() ?? null;
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
    // Shared scalar and rich fields are sent through the exam-level room. Do
    // not gate navigation on the legacy question autosave queue, which should
    // remain empty while this provider owns the workspace.
    if (workspaceCollaboration) return true;
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
      if (workspaceCollaboration && selectedExamQuestionId) {
        const currentShared = workspaceCollaboration.workspaceSnapshot.values[
          `question/${selectedExamQuestionId}/scalar`
        ];
        const currentSharedIsPretest = isQuestionWorkspaceScalar(currentShared)
          ? currentShared.isPretest
          : questionQuery.data?.isPretest;
        const scalar = questionWorkspaceScalar(next, currentSharedIsPretest);
        const json = JSON.stringify(scalar);
        const previous = draftRef.current;
        const previousScalarJson = previous
          ? JSON.stringify(questionWorkspaceScalar(previous, currentSharedIsPretest))
          : null;
        // Rich-editor projections call this same question-level callback for
        // remote updates. Only a genuine scalar change may write the scalar
        // root; otherwise a stale rich projection could overwrite a
        // collaborator's newer answer/metadata settings.
        const scalarChanged = previousScalarJson === null
          ? !isQuestionWorkspaceScalar(currentShared)
          : previousScalarJson !== json;
        if (scalarChanged) {
          localWorkspaceScalarRef.current = { questionId: selectedExamQuestionId, json };
          workspaceCollaboration.setValue(`question/${selectedExamQuestionId}/scalar`, scalar);
        }
        // All workspace fields, including scalar settings, are persisted by
        // the exact Yjs acknowledgement. Never enqueue a whole-question HTTP
        // autosave alongside the exam-level room.
        return;
      }
      // While co-editing owns the prompt, a prompt-only change stays OUT of the
      // legacy autosave queue: the Y.Doc is the source of truth for the prompt,
      // the service persists it, and scheduling a whole-question save here
      // would either fail (COEDIT_ACTIVE) or bump a revision for a keystroke.
      // The projection the composer emits is still real — it feeds preview and
      // validation — it just does not schedule a save.
      const baseline = promptFreeBaselineRef.current;
      if (coeditOwnsPromptRef.current && baseline && isPromptOnlyChange(baseline, next)) {
        return;
      }
      autosave.scheduleAutosave(next);
    },
    [autosave, questionQuery.data?.isPretest, selectedExamQuestionId, workspaceCollaboration]
  );
  const handleLocalRichChange = useCallback(
    (next: QuestionRevision) => {
      if (!workspaceCollaboration || !selectedExamQuestionId) return;
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
    [selectedExamQuestionId, workspaceCollaboration],
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
              {coeditUiActive && !coeditRecovery?.published && (coeditRecovery?.issue === "closed" || coeditRecovery?.issue === "replaced") ? (
                <CoeditRecoverySurface
                  onOpenCurrentDraft={openCurrentDraft}
                  onReviewMyChanges={reviewCoeditChanges}
                  onCopyMyChanges={() => void copyCoeditPrompt()}
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
