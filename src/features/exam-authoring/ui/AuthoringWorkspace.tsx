import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ClipboardCheck, Eye, ListChecks, PencilLine, Sparkles } from "lucide-react";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  AssessmentValidationIssue,
  BatchQuestionDraft,
  BulkQuestionAction,
  QuestionRevision,
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
import { QuestionListPane, type QuestionListFilter } from "./QuestionListPane";
import { QuestionQuickPreview } from "./QuestionQuickPreview";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { SampleExamLoadDialog } from "./SampleExamLoadDialog";
import { authoringMotion } from "./authoringMotion";
import { useOptionalAuthSession } from "../../auth/api/authSession";
import { buildStaffDraftKey } from "../../../utils/staffDraftKey";

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

type WorkspaceMode = "build" | "issues";

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
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [keepMetadataForNext, setKeepMetadataForNext] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const recoveredQuestionDraftKeyRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const questionQuery = useExamQuestion(selectedExamQuestionId);
  const shell = shellQuery.data;
  const questionDraftKey = selectedExamQuestionId
    ? buildStaffDraftKey(staffActorId, "assessment-question", examId, selectedExamQuestionId)
    : null;

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

  const flushBeforeNavigation = useCallback(async () => {
    if (!draft || autosave.status === "saved") return true;
    const result = await autosave.flushNow(draft);
    if (result.ok) return true;
    setNavigationError(
      "Save failed. The current question remains open; navigation was stopped so no work is lost."
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
    if (!selectedExamQuestionId || !selectedModule) return;
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
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : "Question could not be deleted.");
    }
  }, [examId, queryClient, selectedExamQuestionId, selectedModule]);

  const handleSaveAndNext = useCallback(async () => {
    if (!draft || !selectedModule) return;
    const result = await autosave.flushNow(draft);
    if (!result.ok) {
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
      if (command && event.key.toLowerCase() === "d" && !editing) {
        event.preventDefault();
        void handleDuplicate();
        return;
      }
      if (!editing && (event.key === "ArrowDown" || event.key === "ArrowUp") && selectedModule) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = selectedModule.questions[selectedModuleIndex + direction];
        if (next) {
          event.preventDefault();
          void selectQuestion(next.examQuestionId);
        }
        return;
      }
      if (!editing && event.code === "Space" && draft) {
        event.preventDefault();
        setPreviewOpen((value) => !value);
        return;
      }
      if (editing && event.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        document
          .querySelector<HTMLElement>(`[data-question-list-row="${selectedExamQuestionId}"] button`)
          ?.focus();
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

  if (shellQuery.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] text-sm text-slate-500">
        Opening SAT workspace…
      </div>
    );
  if (shellQuery.error || !shell)
    return (
      <div className="p-8 text-sm text-red-700">Unable to load the SAT authoring workspace.</div>
    );

  const moveTargets =
    selectedSection?.modules.filter((module) => module.id !== selectedModuleId) ?? [];
  const importRemaining = selectedModule
    ? Math.max(0, selectedModule.targetQuestionCount - selectedModule.questions.length)
    : 0;

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[#f5f5f7] text-slate-950">
      <header className="authoring-glass z-50 shrink-0 border-b border-black/[0.055] px-3 py-2 sm:px-4">
        <div className="mx-auto flex max-w-[1920px] items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{examTitle}</h1>
              <span className="rounded-full bg-black/[0.045] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                Draft
              </span>
            </div>
            <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">
              {totalAuthored} of {totalTarget} questions authored
            </p>
          </div>
          <div className="authoring-segmented flex items-center rounded-full p-1">
            <ToolbarMode
              active={workspaceMode === "build"}
              onClick={() => setWorkspaceMode("build")}
              icon={<PencilLine size={12} />}
              label="Build"
            />
            <ToolbarMode
              active={workspaceMode === "issues"}
              onClick={() => void openIssues()}
              icon={<ListChecks size={12} />}
              label={`Issues${totalErrors ? ` ${totalErrors}` : ""}`}
            />
          </div>
          <SaveStatusIndicator
            status={autosave.status}
            lastSavedAt={autosave.lastSavedAt}
            {...(draft ? { onRetry: () => autosave.retry(draft) } : {})}
          />
          <button
            type="button"
            disabled={loadSampleExam.isPending}
            onClick={() => setSampleDialogOpen(true)}
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-[#0066cc] hover:bg-[#0071e3]/[0.08] disabled:opacity-40"
            title="Replace this draft with a complete 147-question sample SAT"
          >
            <Sparkles size={13} />
            Load sample
          </button>
          <button
            type="button"
            disabled={!shell}
            onClick={async () => {
              if (await flushBeforeNavigation()) navigate(`/builder/${examId}/preview`);
            }}
            title="Open the full SAT using the real student delivery renderer"
            className="hidden h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-slate-600 hover:bg-black/[0.045] disabled:opacity-30 sm:flex"
          >
            <Eye size={13} />
            Preview
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await flushBeforeNavigation()) navigate(`/builder/${examId}/review`);
            }}
            className="flex h-10 items-center gap-1.5 rounded-full bg-[#0071e3] px-3.5 text-[11px] font-semibold text-white hover:bg-[#0077ed]"
          >
            <ClipboardCheck size={13} />
            Release
          </button>
        </div>
      </header>

      {navigationError ? (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-5 py-2 text-center text-[11px] font-medium text-red-700">
          {navigationError}
        </div>
      ) : null}

      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 overflow-x-auto">
        {selectedModule && selectedSection ? (
          workspaceMode === "build" ? (
            <QuestionListPane
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
            />
          ) : (
            <IssuesPane
              report={validation.data ?? null}
              loading={validation.isPending}
              onRefresh={() => void openIssues()}
              onOpenIssue={(issue) => void openIssue(issue)}
            />
          )
        ) : (
          <div className="flex w-[430px] items-center justify-center border-r border-black/[0.06] bg-white p-8 text-center text-xs text-slate-400">
            Choose a SAT module.
          </div>
        )}

        <section className="min-w-[560px] flex-1 overflow-y-auto bg-white">
          <AnimatePresence mode="popLayout" initial={false}>
            {draft ? (
              <motion.div
                key={selectedExamQuestionId ?? draft.id}
                initial={{ opacity: reduceMotion ? 1 : 0.92, x: reduceMotion ? 0 : 2 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: reduceMotion ? 1 : 0.9, x: reduceMotion ? 0 : -1 }}
                transition={reduceMotion ? { duration: 0.04 } : authoringMotion.question}
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
                  onDelete={() => void handleDelete()}
                />
              </motion.div>
            ) : questionQuery.isLoading && selectedExamQuestionId ? (
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
          </AnimatePresence>
        </section>
        <QuestionQuickPreview
          open={previewOpen}
          question={draft}
          onClose={() => setPreviewOpen(false)}
        />
      </main>
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

function ToolbarMode({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
    >
      {icon}
      {label}
    </button>
  );
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
  return (
    <section
      className="flex w-[430px] min-w-[360px] flex-col border-r border-black/[0.06] bg-white"
      aria-label="SAT authoring issues"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-900">Issues</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Validation across the current SAT draft
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="h-8 rounded-full px-3 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !report ? (
          <div className="p-6 text-center text-[11px] text-slate-400">
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
                className={`mb-1.5 flex w-full gap-2.5 rounded-xl p-3 text-left ${issue.blocking ? "bg-red-50/70" : "bg-amber-50/70"} ${actionable ? "hover:ring-1 hover:ring-black/10" : "cursor-default"}`}
              >
                <AlertCircle
                  size={14}
                  className={`mt-0.5 shrink-0 ${issue.blocking ? "text-red-500" : "text-amber-500"}`}
                />
                <span className="min-w-0">
                  <span
                    className={`block text-[11px] font-semibold ${issue.blocking ? "text-red-800" : "text-amber-800"}`}
                  >
                    {issue.message}
                  </span>
                  <span className="mt-1 block truncate text-[9px] text-slate-400">
                    {actionable ? "Open question and field" : issue.path}
                  </span>
                </span>
              </button>
            );
          })
        ) : report ? (
          <div className="p-8 text-center">
            <ListChecks size={22} className="mx-auto text-emerald-500" />
            <p className="mt-2 text-xs font-semibold text-slate-700">No validation issues</p>
            <p className="mt-1 text-[10px] text-slate-400">
              This SAT draft passes current authoring validation.
            </p>
          </div>
        ) : (
          <div className="p-8 text-center text-[11px] text-slate-400">
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
    <div className="flex min-h-full items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <PencilLine size={22} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">
          {moduleTitle ? `Choose a question in ${moduleTitle}` : "Choose a module"}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-slate-400">
          The question list is the work queue; the editor opens only the selected item.
        </p>
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="mt-3 rounded-full bg-[#0071e3] px-4 py-2 text-[11px] font-semibold text-white"
          >
            Create next question
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div
      className="mx-auto max-w-[900px] animate-pulse space-y-5 px-9 py-8"
      aria-label="Loading question"
    >
      <div className="h-5 w-36 rounded bg-slate-100" />
      <div className="h-10 w-full rounded-xl bg-slate-100" />
      <div className="h-28 w-full rounded-xl bg-slate-100" />
      <div className="h-32 w-full rounded-xl bg-slate-100" />
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-14 w-full rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}

export function getShellProvider(shell: AssessmentAuthoringShell): string {
  return shell.providerKey;
}
