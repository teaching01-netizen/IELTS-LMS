import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  FileSpreadsheet,
  ListChecks,
  MoreHorizontal,
  PanelRight,
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
  useAssessmentValidation,
  useAuthoringShell,
  useBatchCreateAssessmentQuestions,
  useBulkAssessmentQuestions,
  useCreateAssessmentQuestion,
  useDuplicateAssessmentQuestion,
  useExamQuestion,
  useLoadSatSampleExam,
  useReorderAssessmentQuestions,
} from "../api/assessmentQueries";
import { useQuestionAutosave } from "../hooks/useQuestionAutosave";
import {
  hasStructuredContent,
  plainTextFromContent,
  supportsFastPlainEditing,
} from "../editor/richContent";
import { validateSatQuestion } from "../providers/sat/satProvider";
import { QuestionEditor } from "./QuestionEditor";
import { QuestionImportSheet } from "../import/QuestionImportSheet";
import { SatWorkbookImportSheet } from "../import/SatWorkbookImportSheet";
import { QuestionListPane, type QuestionListFilter } from "./QuestionListPane";
import { QuestionInspectorPane, type InspectorSection } from "./QuestionInspectorPane";
import { QuestionQuickPreview } from "./QuestionQuickPreview";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { SampleExamLoadDialog } from "./SampleExamLoadDialog";
import { WorkbookImportUndoBanner } from "./WorkbookImportUndoBanner";
import { authoringMotion } from "./authoringMotion";
import { useOptionalAuthSession } from "../../auth/api/authSession";
import { buildStaffDraftKey } from "../../../utils/staffDraftKey";
import { AuthoringSegmented } from "./AuthoringSegmented";
import { SatMenu } from "../../../products/sat/ui/Menu";
import { AuthoringPaneResizer } from "./AuthoringPaneResizer";
import { restoreAuthoringFocus } from "./authoringPrimitives";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import {
  SatAuthoringErrorSurface,
  SatAuthoringLoadingSurface,
} from "./SatAuthoringStateSurfaces";
import { SpineLayout } from "./spine/SpineLayout";
import { SpineHeader } from "./spine/SpineHeader";
import { QuestionQueueRail } from "./spine/QuestionQueueRail";
import { SpineQuestionView } from "./spine/SpineQuestionView";
import { SaveCluster } from "./spine/SaveCluster";
import { isSpineEnabled } from "./spine/spineFlag";

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

type WorkspaceMode = "build" | "issues";
type AuthoringPane = "sidebar" | "inspector";

const AUTHORING_PANE_STORAGE_KEY = "sat-authoring:pane-width";

function readStoredPaneWidth(pane: AuthoringPane, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(`${AUTHORING_PANE_STORAGE_KEY}:${pane}`);
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  } catch {
    return fallback;
  }
}

function persistPaneWidth(pane: AuthoringPane, width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${AUTHORING_PANE_STORAGE_KEY}:${pane}`, String(width));
  } catch {
    // Private browsing and locked-down embedded contexts may deny storage.
  }
}

export function AuthoringWorkspace({ examId, examTitle }: AuthoringWorkspaceProps) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authSession = useOptionalAuthSession();
  const staffActorId = authSession?.session?.user.id ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const shellQuery = useAuthoringShell(examId);
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
  const [filter, setFilter] = useState<QuestionListFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [workbookImportOpen, setWorkbookImportOpen] = useState(false);
  const [workbookBaseline, setWorkbookBaseline] = useState<AssessmentAuthoringShell | null>(null);
  const [workbookUndo, setWorkbookUndo] = useState<SatWorkbookUndoState | null>(null);
  const [workbookUndoBusy, setWorkbookUndoBusy] = useState(false);
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [questionListOpen, setQuestionListOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredPaneWidth("sidebar", 320, 280, 440)
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readStoredPaneWidth("inspector", 320, 280, 440)
  );
  const [activeInspectorSection, setActiveInspectorSection] = useState<InspectorSection>("content");
  const [keepMetadataForNext, setKeepMetadataForNext] = useState(true);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const questionSheetFocusRef = useRef<HTMLElement | null>(null);
  const inspectorSheetFocusRef = useRef<HTMLElement | null>(null);
  const recoveredQuestionDraftKeyRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const questionQuery = useExamQuestion(selectedExamQuestionId);
  const shell = shellQuery.data;
  const questionDraftKey = selectedExamQuestionId
    ? buildStaffDraftKey(staffActorId, "assessment-question", examId, selectedExamQuestionId)
    : null;

  const shellVersionId = shell?.versionId ?? null;
  const shellVersionRevision = shell?.versionRevision ?? null;

  useEffect(() => {
    persistPaneWidth("sidebar", sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    persistPaneWidth("inspector", inspectorWidth);
  }, [inspectorWidth]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      const isCompact = media.matches;
      setCompactViewport(isCompact);
      if (!isCompact) {
        setQuestionListOpen(false);
        setInspectorSheetOpen(false);
      }
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

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
  const totalTarget =
    shell?.sections.reduce(
      (total, section) =>
        total + section.modules.reduce((sum, module) => sum + module.targetQuestionCount, 0),
      0
    ) ?? 0;
  const totalErrors = allQuestions.reduce(
    (sum, question) => sum + (question.readiness.status === "error" ? 1 : 0),
    0
  );
  const progressPct = totalTarget
    ? Math.min(100, Math.round((totalAuthored / totalTarget) * 100))
    : 0;

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
        setFocusField(resolveAuthoringField(deepField));
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
  }, [searchParams, selectedModuleId, setSearchParams, shell]);

  useEffect(() => {
    setActiveInspectorSection("content");
  }, [selectedExamQuestionId]);

  useEffect(() => {
    if (
      questionQuery.data?.question &&
      questionQuery.data.examQuestionId === selectedExamQuestionId &&
      recoveredQuestionDraftKeyRef.current !== questionDraftKey
    ) {
      setDraft(questionQuery.data.question);
    }
  }, [questionDraftKey, questionQuery.data, selectedExamQuestionId]);

  useEffect(() => {
    if (!draft || !focusField) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-authoring-field="${focusField}"]`);
      target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      (target?.matches("input, textarea, select, button, [contenteditable=true]")
        ? target
        : target?.querySelector<HTMLElement>(
            'input, textarea, select, button, [contenteditable="true"]'
          )
      )?.focus();
      setFocusField(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft, focusField, reduceMotion]);

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
    onRecover: (recovered) => {
      if (!questionDraftKey) return;
      recoveredQuestionDraftKeyRef.current = questionDraftKey;
      setDraft(recovered);
      setNavigationError(
        "Recovered unsaved changes from this device. Review them before leaving this question."
      );
    },
  });

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
      autosave.isOffline
        ? "You are offline. This draft is saved on this device; reconnect before leaving so it can sync."
        : "Save failed. The current question remains open; navigation was stopped so no work is lost."
    );
    return false;
  }, [autosave, draft]);

  const selectQuestion = useCallback(
    async (questionId: string, moduleId = selectedModuleId) => {
      if (questionId === selectedExamQuestionId) return;
      setNavigationError(null);
      if (!(await flushBeforeNavigation())) return;
      if (moduleId) setSelectedModuleId(moduleId);
      setDraft(null);
      setSelectedExamQuestionId(questionId);
    },
    [flushBeforeNavigation, selectedExamQuestionId, selectedModuleId]
  );

  const selectModule = useCallback(
    async (moduleId: string) => {
      if (moduleId === selectedModuleId) return;
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
    if (!result.ok) setNavigationError("Could not save this question. Retry before leaving it.");
  }, [autosave, draft]);

  const handleCreateQuestion = useCallback(
    async (inheritFrom?: QuestionRevision) => {
      if (
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
        request: { questions: drafts },
      });
      await queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      setImportOpen(false);
      const first = result.createdQuestionIds[0];
      if (first) {
        setSelectedExamQuestionId(first);
        setDraft(null);
      }
    },
    [batchCreate, examId, flushBeforeNavigation, queryClient, selectedModuleId]
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
  }, [examId, flushBeforeNavigation]);

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
    [examId, queryClient]
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
  }, [examId, flushBeforeNavigation, loadSampleExam]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedExamQuestionId || !selectedModuleId || !(await flushBeforeNavigation())) return;
    try {
      const created = await duplicateQuestion.mutateAsync({
        examQuestionId: selectedExamQuestionId,
        request: {
          destinationModuleId: selectedModuleId,
          insertAfterExamQuestionId: selectedExamQuestionId,
        },
      });
      setSelectedExamQuestionId(created.examQuestionId);
      setDraft(created.question);
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Question could not be duplicated."
      );
    }
  }, [duplicateQuestion, flushBeforeNavigation, selectedExamQuestionId, selectedModuleId]);

  const handleDelete = useCallback(async () => {
    if (!selectedExamQuestionId || !selectedModule || !(await flushBeforeNavigation())) return false;
    const currentIndex = selectedModule.questions.findIndex(
      (question) => question.examQuestionId === selectedExamQuestionId
    );
    const fallback =
      selectedModule.questions[currentIndex + 1] ??
      selectedModule.questions[currentIndex - 1] ??
      null;
    try {
      await assessmentAuthoringApi.deleteQuestion(selectedExamQuestionId);
      queryClient.removeQueries({ queryKey: assessmentKeys.question(selectedExamQuestionId) });
      setDraft(null);
      setSelectedExamQuestionId(fallback?.examQuestionId ?? null);
      await queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      return true;
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : "Question could not be deleted.");
      return false;
    }
  }, [examId, flushBeforeNavigation, queryClient, selectedExamQuestionId, selectedModule]);

  const handleSaveAndNext = useCallback(async () => {
    if (!draft || !selectedModule) return;
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

  const handleQuickAnswerKey = useCallback(
    async (questionId: string, optionId: string) => {
      setNavigationError(null);
      try {
        if (questionId === selectedExamQuestionId && draft?.answer.kind === "single_choice") {
          const next: QuestionRevision = {
            ...draft,
            answer: { ...draft.answer, correctOptionId: optionId },
          };
          setDraft(next);
          const result = await autosave.flushNow(next);
          if (!result.ok) throw new Error("Answer key could not be saved.");
          return;
        }
        if (!(await flushBeforeNavigation())) return;
        const detail = await assessmentAuthoringApi.getQuestion(questionId);
        if (detail.question.answer.kind !== "single_choice")
          throw new Error("Only multiple-choice questions have an A–D answer key.");
        const next = {
          ...detail.question,
          answer: { ...detail.question.answer, correctOptionId: optionId },
        } satisfies QuestionRevision;
        const saved = await assessmentAuthoringApi.saveQuestionRevision(next.id, {
          revision: next.revision,
          questionType: next.questionType,
          stimulus: next.stimulus,
          prompt: next.prompt,
          answer: next.answer,
          rationale: next.rationale,
          metadata: next.metadata,
          accessibility: next.accessibility,
        });
        updateSummaryCache(questionId, saved);
        void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
        void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Answer key could not be changed."
        );
      }
    },
    [
      autosave,
      draft,
      examId,
      flushBeforeNavigation,
      queryClient,
      selectedExamQuestionId,
      updateSummaryCache,
    ]
  );

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
      setFocusField(resolveAuthoringField(fieldPath ?? null));
      await selectQuestion(questionId, target.moduleId);
    },
    [selectQuestion, shell]
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
      if (inOverlay) return;
      if (interactive || editing) {
        if (editing && event.key === "Escape") {
          (document.activeElement as HTMLElement | null)?.blur();
          document
            .querySelector<HTMLElement>(`[data-question-list-row="${selectedExamQuestionId}"] button`)
            ?.focus();
        }
        return;
      }
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveNow();
        return;
      }
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setWorkspaceMode("build");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
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
      if (!interactive && !inOverlay && !editing && (event.key === "ArrowDown" || event.key === "ArrowUp") && selectedModule) {
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
  ]);

  if (shellQuery.isLoading) return <SatAuthoringLoadingSurface label="Opening SAT workspace…" />;
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

  const renderQuestionListPane = (embedded = false) => {
    if (selectedModule && selectedSection) {
      if (workspaceMode === "build") {
        return (
          <QuestionListPane
            embedded={embedded}
            module={selectedModule}
            sections={shell.sections}
            sectionKey={selectedSection.sectionKey}
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
            onSelectModule={(moduleId) => {
              setQuestionListOpen(false);
              void selectModule(moduleId);
            }}
            onOpenImport={() => {
              setQuestionListOpen(false);
              setImportOpen(true);
            }}
            onFilterChange={setFilter}
            onSelectQuestion={(questionId) => {
              setQuestionListOpen(false);
              void selectQuestion(questionId);
            }}
            onCreateQuestion={() => {
              setQuestionListOpen(false);
              void handleCreateQuestion();
            }}
            onToggleSelection={toggleSelection}
            onClearSelection={() => {
              setSelectedIds(new Set());
              selectionAnchorRef.current = null;
            }}
            onQuickAnswerKey={(questionId, optionId) =>
              void handleQuickAnswerKey(questionId, optionId)
            }
            onReorder={handleReorder}
            onBulkAction={handleBulkAction}
            saveStatus={autosave.status}
          />
        );
      }
      return (
        <IssuesPane
          report={validation.data ?? null}
          loading={validation.isPending}
          onRefresh={() => void openIssues()}
          onOpenIssue={(issue) => {
            setQuestionListOpen(false);
            void openIssue(issue);
          }}
        />
      );
    }
    return (
      <div className="authoring-sidebar flex w-[var(--authoring-sidebar-width)] min-w-0 items-center justify-center border-r border-au-separator bg-au-surface p-8 text-center text-[12px] text-slate-500">
        Choose a SAT module.
      </div>
    );
  };

  const renderInspector = (embedded = false) =>
    (embedded || inspectorOpen) && draft ? (
      <QuestionInspectorPane
        embedded={embedded}
        question={draft}
        issues={selectedQuestionIssues}
        activeSection={activeInspectorSection}
        onSectionChange={setActiveInspectorSection}
        onChange={handleChange}
        onClose={() => (embedded ? setInspectorSheetOpen(false) : setInspectorOpen(false))}
        onIssueSelect={(issue) => {
          setActiveInspectorSection("validation");
          setFocusField(resolveAuthoringField(issue.field ?? issue.path));
        }}
      />
    ) : null;

  const spineEnabled = isSpineEnabled(searchParams);

  if (spineEnabled) {
    const spineQueue = (() => {
      if (!selectedModule || !selectedSection) return null;
      if (workspaceMode === "build") {
        return (
          <QuestionQueueRail
            module={selectedModule}
            sections={shell.sections}
            sectionKey={selectedSection.sectionKey}
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
            onCreateQuestion={() => void handleCreateQuestion()}
            onToggleSelection={toggleSelection}
            onClearSelection={() => {
              setSelectedIds(new Set());
              selectionAnchorRef.current = null;
            }}
            onQuickAnswerKey={(questionId, optionId) =>
              void handleQuickAnswerKey(questionId, optionId)
            }
            onReorder={handleReorder}
            onBulkAction={handleBulkAction}
            saveStatus={autosave.status}
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
      >
        <SpineLayout
          header={
            <SpineHeader
              examTitle={examTitle}
              sectionTitle={selectedSection?.title ?? null}
              moduleTitle={selectedModule?.title ?? null}
              authored={totalAuthored}
              target={totalTarget}
              progressPct={progressPct}
              saveSlot={
                draft ? (
                  <SaveCluster
                    status={autosave.status}
                    lastSavedAt={autosave.lastSavedAt}
                    onRetry={() => autosave.retry(draft)}
                  />
                ) : null
              }
              onBack={() => {
                void (async () => {
                  if (await flushBeforeNavigation()) navigate("/sat/exams");
                })();
              }}
              onOpenQueue={() => setQuestionListOpen(true)}
            />
          }
          queue={spineQueue}
          banner={
            <>
              {navigationError ? (
                <div role="alert" className="border-b px-5 py-2 text-center text-xs font-medium">
                  {navigationError}
                </div>
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
            <SpineQuestionView
              question={draft}
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
              onDuplicate={() => void handleDuplicate()}
              onDelete={() => handleDelete()}
              onIssueSelect={(field) => setFocusField(resolveAuthoringField(field))}
            />
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
      </div>
    );
  }

  return (
    <div
      className="sat-product sat-authoring flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-au-canvas text-slate-950"
      data-au-section={selectedSection?.sectionKey ?? "rw"}
      style={
        {
          "--authoring-sidebar-width": `${sidebarWidth}px`,
          "--authoring-inspector-width": `${inspectorWidth}px`,
        } as CSSProperties
      }
    >
      <header
        className="authoring-glass authoring-topbar z-50 shrink-0 border-b border-au-separator px-2 py-1.5 sm:px-3"
        data-scrolled={topbarScrolled ? "true" : undefined}
      >
        <div className="mx-auto flex min-h-[52px] max-w-[1920px] items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={async () => {
              if (await flushBeforeNavigation()) navigate("/sat/exams");
            }}
            className="authoring-interactive flex min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
            aria-label="Back to SAT Exam Library"
            title="Back to SAT Exam Library"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span className="hidden lg:inline">Exam Library</span>
          </button>
          <div className="mx-0.5 h-5 w-px shrink-0 bg-au-fill" aria-hidden="true" />
          <div className="min-w-0 flex-1 px-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[13px] font-semibold tracking-[-0.012em]">{examTitle}</h1>
              <span className="shrink-0 rounded-full bg-au-fill px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-slate-600">
                Draft
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="truncate text-[11px] tabular-nums text-slate-500">
                {totalAuthored} of {totalTarget} questions authored
              </p>
              <span
                className="hidden h-[3px] w-14 shrink-0 overflow-hidden rounded-full bg-au-fill sm:block"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-au-accent transition-[width] duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setQuestionListOpen(true)}
            className="hidden min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent max-[900px]:flex"
            aria-label={workspaceMode === "issues" ? "Open authoring issues" : "Open question navigator"}
          >
            <ListChecks size={14} aria-hidden="true" />
            <span>{workspaceMode === "issues" ? "Issues" : "Questions"}</span>
          </button>
          <AuthoringSegmented
            className="shrink-0 max-[900px]:hidden"
            ariaLabel="Authoring view"
            layoutId="sat-authoring-mode"
            value={workspaceMode}
            onChange={(mode) => {
              if (mode === "issues") {
                setQuestionListOpen(false);
                void openIssues();
              } else {
                setWorkspaceMode(mode);
              }
            }}
            options={[
              { value: "build", label: "Build" },
              {
                value: "issues",
                label: (
                  <>
                    Issues
                    {totalErrors ? (
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-au-danger-tint px-1.5 text-[10px] font-semibold tabular-nums text-au-danger-text">
                        {totalErrors}
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => (compactViewport ? setInspectorSheetOpen(true) : setInspectorOpen((open) => !open))}
            disabled={!draft}
            className="authoring-interactive flex min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:cursor-not-allowed disabled:opacity-40"
            aria-controls="sat-question-inspector"
            aria-expanded={compactViewport ? inspectorSheetOpen && Boolean(draft) : inspectorOpen}
            title={compactViewport ? "Open question inspector" : inspectorOpen ? "Hide question inspector" : "Show question inspector"}
          >
            <PanelRight size={14} aria-hidden="true" />
            <span className="hidden xl:inline">Inspector</span>
          </button>
          <div className="hidden md:block">
            <SaveStatusIndicator
              status={autosave.status}
              lastSavedAt={autosave.lastSavedAt}
              {...(draft ? { onRetry: () => autosave.retry(draft) } : {})}
            />
          </div>
          <button
            type="button"
            disabled={!shell}
            onClick={() => void openWorkbookImport()}
            className="authoring-interactive hidden min-h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 disabled:opacity-30 sm:flex max-[900px]:hidden"
            title="Import the complete SAT from an Excel workbook"
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            Import
          </button>
          <SatMenu
            label="More authoring actions"
            compact
            align="end"
            triggerContent={<MoreHorizontal size={16} aria-hidden="true" />}
            items={[
              {
                id: "build-workspace",
                label: "Build questions",
                onSelect: () => setWorkspaceMode("build"),
                current: workspaceMode === "build",
              },
              {
                id: "issues-workspace",
                label: "Review issues",
                onSelect: () => void openIssues(),
                current: workspaceMode === "issues",
              },
              ...(compactViewport
                ? [
                    {
                      id: "import-workbook",
                      label: "Import from Excel…",
                      onSelect: () => void openWorkbookImport(),
                      disabled: !shell,
                      separatorBefore: true,
                    },
                  ]
                : []),
              {
                id: "preview-question",
                label: "Preview current question",
                onSelect: () => setPreviewOpen(true),
                disabled: !draft,
                separatorBefore: true,
              },
              {
                id: "load-sample",
                label: "Load sample exam…",
                onSelect: () => setSampleDialogOpen(true),
                disabled: loadSampleExam.isPending,
              },
            ]}
          />
          <button
            type="button"
            disabled={!shell}
            onClick={async () => {
              if (await flushBeforeNavigation()) navigate(`/sat/exams/${examId}/preview`);
            }}
            title="Open the full SAT using the real student delivery renderer"
            className="authoring-interactive hidden min-h-9 items-center rounded-[10px] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 disabled:opacity-30 md:flex"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await flushBeforeNavigation()) navigate(`/sat/exams/${examId}/release`);
            }}
            className="authoring-interactive flex min-h-9 shrink-0 items-center rounded-[10px] bg-au-accent px-3.5 text-[12px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2"
          >
            Release
          </button>
        </div>
      </header>

      {navigationError ? (
        <div
          role="alert"
          className="shrink-0 border-b border-au-danger/15 bg-au-danger-tint px-5 py-2 text-center text-[12px] font-medium text-au-danger-text"
        >
          {navigationError}
        </div>
      ) : null}

      {workbookUndo?.available ? (
        <WorkbookImportUndoBanner
          busy={workbookUndoBusy}
          onUndo={() => void handleWorkbookUndo()}
        />
      ) : null}

      <main className="authoring-workspace mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 overflow-hidden">
        {!compactViewport ? renderQuestionListPane() : null}
        {!compactViewport && selectedModule && selectedSection ? (
          <AuthoringPaneResizer
            label="Question navigator width"
            value={sidebarWidth}
            min={280}
            max={440}
            onChange={setSidebarWidth}
          />
        ) : null}

        <section
          className="authoring-editor-canvas min-w-0 flex-1 overflow-y-auto"
          onScroll={(event) => setTopbarScrolled(event.currentTarget.scrollTop > 6)}
        >
          {draft ? (
            <motion.div
              key={selectedExamQuestionId ?? draft.id}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0.04 } : authoringMotion.state}
            >
              <QuestionEditor
                question={draft}
                {...(selectedModuleIndex >= 0 ? { questionNumber: selectedModuleIndex + 1 } : {})}
                saveStatus={autosave.status}
                onChange={handleChange}
                onSaveNow={() => void handleSaveNow()}
                onSaveAndNext={() => void handleSaveAndNext()}
                keepMetadataForNext={keepMetadataForNext}
                onKeepMetadataForNextChange={setKeepMetadataForNext}
                onDuplicate={() => void handleDuplicate()}
                onDelete={() => handleDelete()}
              />
            </motion.div>
          ) : selectedExamQuestionId && questionQuery.error ? (
            <QuestionLoadError
              key="error"
              error={questionQuery.error}
              onRetry={() => void questionQuery.refetch()}
            />
          ) : selectedExamQuestionId ? (
            <EditorSkeleton key="loading" />
          ) : (
            <EmptyEditor
              key="empty"
              moduleTitle={selectedModule?.title ?? null}
              {...(selectedModule &&
              selectedModule.questions.length < selectedModule.targetQuestionCount
                ? { onCreate: () => void handleCreateQuestion() }
                : {})}
            />
          )}
        </section>
        {!compactViewport && inspectorOpen && draft ? (
          <AuthoringPaneResizer
            label="Question inspector width"
            value={inspectorWidth}
            min={280}
            max={440}
            direction={-1}
            onChange={setInspectorWidth}
          />
        ) : null}
        {!compactViewport ? renderInspector() : null}
        <QuestionQuickPreview
          open={previewOpen}
          question={draft}
          onClose={() => setPreviewOpen(false)}
        />
      </main>

      <Sheet
        open={compactViewport && questionListOpen}
        onOpenChange={setQuestionListOpen}
      >
        <SheetContent
          side="left"
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement) {
              questionSheetFocusRef.current = document.activeElement;
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = questionSheetFocusRef.current;
            questionSheetFocusRef.current = null;
            restoreAuthoringFocus(opener);
          }}
          className="sat-product sat-authoring authoring-mobile-sheet flex w-[min(92vw,380px)] max-w-[380px] flex-col gap-0 border-r border-au-separator bg-au-canvas p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{workspaceMode === "issues" ? "Authoring issues" : "Question navigator"}</SheetTitle>
            <SheetDescription>{workspaceMode === "issues" ? "Review validation issues in the current SAT draft." : "Choose a SAT question to edit."}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{renderQuestionListPane(true)}</div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={compactViewport && inspectorSheetOpen && Boolean(draft)}
        onOpenChange={setInspectorSheetOpen}
      >
        <SheetContent
          side="right"
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement) {
              inspectorSheetFocusRef.current = document.activeElement;
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = inspectorSheetFocusRef.current;
            inspectorSheetFocusRef.current = null;
            restoreAuthoringFocus(opener);
          }}
          className="sat-product sat-authoring authoring-mobile-sheet flex w-[min(94vw,390px)] max-w-[390px] flex-col gap-0 border-l border-au-separator bg-au-canvas p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Question inspector</SheetTitle>
            <SheetDescription>Review question metadata, answers, and validation.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{renderInspector(true)}</div>
        </SheetContent>
      </Sheet>

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
    </div>
  );
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

function resolveAuthoringField(path: string | null): string {
  if (path?.startsWith("metadata.domain")) return "domain";
  if (path?.startsWith("metadata.skill")) return "skill";
  if (path?.startsWith("stimulus")) return "stimulus";
  if (path?.startsWith("prompt")) return "prompt";
  if (path?.startsWith("rationale")) return "rationale";
  return "answer";
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
