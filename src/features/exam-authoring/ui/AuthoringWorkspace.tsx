import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type {
  AssessmentAuthoringShell,
  BulkQuestionAction,
  QuestionRevision,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import {
  assessmentKeys,
  useAuthoringShell,
  useBulkAssessmentQuestions,
  useCreateAssessmentQuestion,
  useDuplicateAssessmentQuestion,
  useExamQuestion,
  useReorderAssessmentQuestions,
} from "../api/assessmentQueries";
import { useQuestionAutosave } from "../hooks/useQuestionAutosave";
import { ExamQuestionRenderer } from "../../exam-rendering/api/ExamQuestionRenderer";
import { StructurePane } from "./StructurePane";
import { QuestionEditor } from "./QuestionEditor";
import { QuestionProperties } from "./QuestionProperties";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { authoringMotion } from "./authoringMotion";

type WorkspaceView = "edit" | "split" | "preview";
const PREF_KEY = "sat-authoring-workspace-v2";

export interface AuthoringWorkspaceProps {
  examId: string;
  examTitle: string;
}

function readWorkspacePreferences() {
  try {
    const saved = window.localStorage.getItem(PREF_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as {
      viewMode?: WorkspaceView;
      showStructure?: boolean;
      showInspector?: boolean;
    };
  } catch {
    return null;
  }
}

export function AuthoringWorkspace({ examId, examTitle }: AuthoringWorkspaceProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preferences = useMemo(readWorkspacePreferences, []);
  const shellQuery = useAuthoringShell(examId);
  const createQuestion = useCreateAssessmentQuestion(examId);
  const duplicateQuestion = useDuplicateAssessmentQuestion(examId);
  const reorderQuestions = useReorderAssessmentQuestions(examId);
  const bulkQuestions = useBulkAssessmentQuestions(examId);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedExamQuestionId, setSelectedExamQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuestionRevision | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<WorkspaceView>(preferences?.viewMode ?? "split");
  const [showStructure, setShowStructure] = useState(preferences?.showStructure ?? true);
  const [showInspector, setShowInspector] = useState(preferences?.showInspector ?? true);
  const [focusMode, setFocusMode] = useState(false);
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);
  const [emphasizedQuestionId, setEmphasizedQuestionId] = useState<string | null>(null);
  const [navigationDirection, setNavigationDirection] = useState<-1 | 1>(1);
  const panelSnapshot = useRef({ structure: true, inspector: true });
  const emphasisTimer = useRef<number | null>(null);
  const handledDeepLink = useRef<string | null>(null);
  const deepLinkQuestionId = searchParams.get("question");
  const deepLinkField = searchParams.get("field");
  const questionQuery = useExamQuestion(selectedExamQuestionId);

  useEffect(() => {
    if (focusMode) return;
    window.localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ viewMode, showStructure, showInspector })
    );
  }, [focusMode, showInspector, showStructure, viewMode]);

  useEffect(() => {
    const shell = shellQuery.data;
    if (!shell) return;

    if (deepLinkQuestionId) {
      const target = shell.sections
        .flatMap((section) => section.modules)
        .flatMap((module) =>
          module.questions.map((question) => ({ question, moduleId: module.id }))
        )
        .find(({ question }) => question.examQuestionId === deepLinkQuestionId);
      const deepLinkKey = `${deepLinkQuestionId}:${deepLinkField ?? ""}`;
      if (target && handledDeepLink.current !== deepLinkKey) {
        handledDeepLink.current = deepLinkKey;
        setSelectedModuleId(target.moduleId);
        setSelectedExamQuestionId(target.question.examQuestionId);
        setPendingQuestionId(target.question.examQuestionId);
        if (deepLinkField?.startsWith("metadata.")) setShowInspector(true);
        return;
      }
    }

    const firstModule = shell.sections[0]?.modules[0];
    if (!selectedModuleId && firstModule) {
      setSelectedModuleId(firstModule.id);
      if (!selectedExamQuestionId && firstModule.questions[0]) {
        setSelectedExamQuestionId(firstModule.questions[0].examQuestionId);
      }
    }
  }, [
    deepLinkField,
    deepLinkQuestionId,
    selectedExamQuestionId,
    selectedModuleId,
    shellQuery.data,
  ]);
  useEffect(() => {
    if (
      questionQuery.data?.question &&
      questionQuery.data.examQuestionId === selectedExamQuestionId
    ) {
      setDraft(questionQuery.data.question);
      setPendingQuestionId(null);
    }
  }, [questionQuery.data, selectedExamQuestionId]);

  useEffect(() => {
    if (!deepLinkQuestionId || selectedExamQuestionId !== deepLinkQuestionId || !draft) return;
    const field = resolveAuthoringField(deepLinkField);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      const container = document.querySelector<HTMLElement>(`[data-authoring-field="${field}"]`);
      container?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      if (container) {
        container.dataset["authoringPulse"] = "true";
        window.setTimeout(() => delete container.dataset["authoringPulse"], 900);
      }
      container
        ?.querySelector<HTMLElement>('input, textarea, select, button, [contenteditable="true"]')
        ?.focus();
    }, 80);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("question");
    nextParams.delete("field");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkField,
    deepLinkQuestionId,
    draft,
    searchParams,
    selectedExamQuestionId,
    setSearchParams,
  ]);

  const saveDraft = async (revision: QuestionRevision) => {
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
    queryClient.setQueryData(
      assessmentKeys.question(selectedExamQuestionId ?? ""),
      (current: typeof questionQuery.data) => (current ? { ...current, question: saved } : current)
    );
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    return saved;
  };

  const autosave = useQuestionAutosave({ save: saveDraft });
  const shell = shellQuery.data;
  const allQuestions = useMemo(
    () =>
      shell?.sections.flatMap((section) =>
        section.modules.flatMap((module) =>
          module.questions.map((question) => ({
            ...question,
            moduleId: module.id,
            moduleTitle: module.title,
            sectionTitle: section.title,
          }))
        )
      ) ?? [],
    [shell]
  );
  const selectedModule = useMemo(
    () =>
      shell?.sections
        .flatMap((section) => section.modules)
        .find((module) => module.id === selectedModuleId),
    [selectedModuleId, shell]
  );
  const selectedIndex = allQuestions.findIndex(
    (question) => question.examQuestionId === selectedExamQuestionId
  );
  const totalTarget =
    shell?.sections.reduce(
      (sum, section) =>
        sum +
        section.modules.reduce((moduleSum, module) => moduleSum + module.targetQuestionCount, 0),
      0
    ) ?? 0;
  const totalAuthored = allQuestions.length;

  const emphasizeQuestion = (questionId: string) => {
    if (emphasisTimer.current !== null) window.clearTimeout(emphasisTimer.current);
    setEmphasizedQuestionId(questionId);
    emphasisTimer.current = window.setTimeout(() => {
      setEmphasizedQuestionId(null);
      emphasisTimer.current = null;
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (emphasisTimer.current !== null) window.clearTimeout(emphasisTimer.current);
    };
  }, []);

  const flushBeforeNavigation = async () => {
    if (!draft || autosave.status === "saved") return true;
    const result = await autosave.flushNow(draft);
    if (result.ok) return true;
    setNavigationError("Save failed. Your current question is still open so no work is lost.");
    return false;
  };

  const selectQuestion = async (examQuestionId: string, moduleId?: string) => {
    if (examQuestionId === selectedExamQuestionId) return;
    setNavigationError(null);
    const targetIndex = allQuestions.findIndex(
      (question) => question.examQuestionId === examQuestionId
    );
    if (targetIndex >= 0 && selectedIndex >= 0) {
      setNavigationDirection(targetIndex >= selectedIndex ? 1 : -1);
    }
    setPendingQuestionId(examQuestionId);
    if (!(await flushBeforeNavigation())) {
      setPendingQuestionId(null);
      return;
    }
    if (moduleId) setSelectedModuleId(moduleId);
    setDraft(null);
    setSelectedExamQuestionId(examQuestionId);
  };

  const handleChange = (next: QuestionRevision) => {
    setDraft(next);
    autosave.scheduleAutosave(next);
  };
  const handleSaveNow = async () => {
    if (!draft) return;
    setNavigationError(null);
    const result = await autosave.flushNow(draft);
    if (!result.ok)
      setNavigationError("Could not save this question. Try again before leaving it.");
  };

  const toggleFocusMode = () => {
    if (!focusMode) {
      panelSnapshot.current = { structure: showStructure, inspector: showInspector };
      setFocusMode(true);
      setShowStructure(false);
      setShowInspector(false);
      return;
    }
    setFocusMode(false);
    setShowStructure(panelSnapshot.current.structure);
    setShowInspector(panelSnapshot.current.inspector);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveNow();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if (command && event.shiftKey && event.key.toLowerCase() === "f" && !editing) {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (command && event.key.toLowerCase() === "d" && !editing) {
        event.preventDefault();
        void handleDuplicate();
      }
      if (event.altKey && !editing && event.key === "ArrowUp") {
        event.preventDefault();
        void goToAdjacentQuestion(-1);
      }
      if (event.altKey && !editing && event.key === "ArrowDown") {
        event.preventDefault();
        void goToAdjacentQuestion(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleCreateQuestion = async (moduleId: string) => {
    if (!(await flushBeforeNavigation())) return;
    const created = await createQuestion.mutateAsync(moduleId);
    setSelectedModuleId(moduleId);
    setSelectedExamQuestionId(created.examQuestionId);
    setDraft(created.question);
    emphasizeQuestion(created.examQuestionId);
  };

  const handleDelete = async () => {
    if (!selectedExamQuestionId) return;
    const fallback = allQuestions.find(
      (question, index) =>
        question.examQuestionId !== selectedExamQuestionId &&
        (index >= selectedIndex || index === Math.max(0, selectedIndex - 1))
    );
    await assessmentAuthoringApi.deleteQuestion(selectedExamQuestionId);
    setDraft(null);
    if (fallback) {
      setSelectedModuleId(fallback.moduleId);
      setSelectedExamQuestionId(fallback.examQuestionId);
    } else {
      setSelectedExamQuestionId(null);
    }
    await queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
    await queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
  };

  const handleDuplicate = async () => {
    if (!selectedExamQuestionId || !selectedModuleId) return;
    if (!(await flushBeforeNavigation())) return;
    setNavigationError(null);
    try {
      const created = await duplicateQuestion.mutateAsync({
        examQuestionId: selectedExamQuestionId,
        request: {
          destinationModuleId: selectedModuleId,
          insertAfterExamQuestionId: selectedExamQuestionId,
        },
      });
      setSelectedExamQuestionId(created.examQuestionId);
      setSelectedModuleId(created.moduleId);
      setDraft(created.question);
      emphasizeQuestion(created.examQuestionId);
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Question could not be duplicated."
      );
    }
  };

  const handleReorderQuestions = async (
    moduleId: string,
    questionIds: string[],
    expectedQuestionIds: string[]
  ) => {
    setNavigationError(null);
    try {
      await reorderQuestions.mutateAsync({
        moduleId,
        request: { questionIds, expectedQuestionIds },
      });
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Question order could not be saved."
      );
      throw error;
    }
  };

  const handleBulkAction = async (questionIds: string[], action: BulkQuestionAction) => {
    if (!questionIds.length) return;
    if (!(await flushBeforeNavigation()))
      throw new Error("Save the current question before continuing.");
    setNavigationError(null);
    const currentSelected = selectedExamQuestionId
      ? questionIds.includes(selectedExamQuestionId)
      : false;
    try {
      const result = await bulkQuestions.mutateAsync({ questionIds, action });
      if (action.type === "delete" && currentSelected) {
        const remaining = allQuestions.filter(
          (question) => !questionIds.includes(question.examQuestionId)
        );
        const fallback =
          remaining[Math.min(Math.max(selectedIndex, 0), Math.max(0, remaining.length - 1))];
        setDraft(null);
        if (fallback) {
          setSelectedModuleId(fallback.moduleId);
          setSelectedExamQuestionId(fallback.examQuestionId);
        } else {
          setSelectedExamQuestionId(null);
        }
      } else if (action.type === "move" && currentSelected) {
        setSelectedModuleId(action.destinationModuleId);
      } else if (action.type === "duplicate" && result.createdQuestionIds.length === 1) {
        const createdId = result.createdQuestionIds[0];
        if (createdId) {
          setDraft(null);
          setSelectedModuleId(action.destinationModuleId);
          setSelectedExamQuestionId(createdId);
          emphasizeQuestion(createdId);
        }
      }
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Bulk action could not be completed."
      );
      throw error;
    }
  };

  const handleSelectModule = async (moduleId: string) => {
    if (!(await flushBeforeNavigation())) return;
    const module = shell?.sections
      .flatMap((section) => section.modules)
      .find((item) => item.id === moduleId);
    setSelectedModuleId(moduleId);
    setDraft(null);
    setSelectedExamQuestionId(module?.questions[0]?.examQuestionId ?? null);
  };

  const goToAdjacentQuestion = async (direction: -1 | 1) => {
    const next = allQuestions[selectedIndex + direction];
    if (next) await selectQuestion(next.examQuestionId, next.moduleId);
  };

  const handleOpenRelease = async () => {
    setNavigationError(null);
    if (!(await flushBeforeNavigation())) return;
    await queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
    navigate(`/builder/${examId}/review`);
  };
  if (shellQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] text-sm text-slate-500">
        Opening SAT workspace…
      </div>
    );
  }
  if (shellQuery.error || !shell) {
    return (
      <div className="p-8 text-sm text-red-700">Unable to load the SAT authoring workspace.</div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#f5f5f7] text-slate-950">
      <header className="authoring-glass sticky top-0 z-40 px-3 py-2.5 sm:px-5">
        <div className="mx-auto flex max-w-[1800px] items-center gap-1.5">
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={() => {
              if (focusMode) setFocusMode(false);
              setShowStructure((value) => !value);
            }}
            className="authoring-interactive flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-slate-950"
            aria-label="Toggle structure"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={showStructure ? "close" : "open"}
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.82 }}
                transition={authoringMotion.state}
                className="block"
              >
                {showStructure ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{examTitle}</h1>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Draft
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {totalAuthored} of {totalTarget} questions authored
            </p>
          </div>

          <div className="authoring-segmented hidden items-center rounded-full p-1 md:flex">
            {(["edit", "split", "preview"] as WorkspaceView[]).map((mode) => {
              const active = viewMode === mode;
              return (
                <motion.button
                  key={mode}
                  type="button"
                  whileTap={authoringMotion.press}
                  transition={authoringMotion.fast}
                  onClick={() => setViewMode(mode)}
                  className={`relative min-h-9 overflow-hidden rounded-full px-3.5 py-1.5 text-xs font-medium capitalize ${active ? "text-slate-950" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {active ? (
                    <motion.span
                      layoutId="sat-workspace-view-pill"
                      className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                      transition={authoringMotion.spring}
                    />
                  ) : null}
                  <span className="relative z-10">{mode}</span>
                </motion.button>
              );
            })}
          </div>

          <SaveStatusIndicator
            status={autosave.status}
            lastSavedAt={autosave.lastSavedAt}
            {...(draft ? { onRetry: () => autosave.retry(draft) } : {})}
          />

          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={() => void handleOpenRelease()}
            className="authoring-interactive flex h-11 items-center gap-2 rounded-full bg-[#0071e3] px-4 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-2"
            aria-label="Open Delivery and Release"
          >
            <ClipboardCheck size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Review</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={toggleFocusMode}
            className={`authoring-interactive hidden h-11 w-11 items-center justify-center rounded-full md:flex ${focusMode ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-black/[0.05] hover:text-slate-950"}`}
            aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
            title="Focus mode (⌘⇧F)"
          >
            {focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </motion.button>

          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={() => {
              if (focusMode) setFocusMode(false);
              setShowInspector((value) => !value);
            }}
            className="authoring-interactive flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-slate-950"
            aria-label="Toggle inspector"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={showInspector ? "close" : "open"}
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.82 }}
                transition={authoringMotion.state}
                className="block"
              >
                {showInspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {navigationError ? (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={authoringMotion.state}
            className="overflow-hidden border-b border-red-100 bg-red-50 px-6 py-2 text-center text-xs font-medium text-red-700"
          >
            {navigationError}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 bg-[#f5f5f7]">
        <motion.aside
          initial={false}
          animate={{ width: showStructure ? 280 : 0, opacity: showStructure ? 1 : 0 }}
          transition={authoringMotion.panel}
          className="authoring-sidebar min-h-0 shrink-0 overflow-hidden border-r border-black/[0.06]"
          aria-hidden={!showStructure}
        >
          <div className="h-full w-[280px]">
            <StructurePane
              shell={shell}
              selectedModuleId={selectedModuleId}
              selectedExamQuestionId={selectedExamQuestionId}
              pendingQuestionId={pendingQuestionId}
              emphasizedQuestionId={emphasizedQuestionId}
              currentSaveStatus={autosave.status}
              onSelectModule={(moduleId) => void handleSelectModule(moduleId)}
              onSelectQuestion={(questionId, moduleId) => void selectQuestion(questionId, moduleId)}
              onCreateQuestion={(moduleId) => void handleCreateQuestion(moduleId)}
              onReorderQuestions={handleReorderQuestions}
              onBulkAction={handleBulkAction}
              isCreating={createQuestion.isPending}
              isMutating={
                reorderQuestions.isPending || bulkQuestions.isPending || duplicateQuestion.isPending
              }
            />
          </div>
        </motion.aside>

        <section className="min-w-0 flex-1 bg-[#f5f5f7]">
          <div className="authoring-subtoolbar sticky top-[64px] z-30 flex items-center justify-between px-5 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span className="truncate">
                {questionQuery.data?.sectionKey ?? selectedModule?.title ?? "SAT"}
              </span>
              {selectedIndex >= 0 ? (
                <>
                  <span>·</span>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={selectedExamQuestionId ?? "none"}
                      initial={{ opacity: 0, x: 3 * navigationDirection }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -3 * navigationDirection }}
                      transition={authoringMotion.state}
                    >
                      Question {selectedIndex + 1} of {allQuestions.length}
                    </motion.span>
                  </AnimatePresence>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <motion.button
                type="button"
                whileTap={authoringMotion.press}
                transition={authoringMotion.fast}
                onClick={() => void goToAdjacentQuestion(-1)}
                disabled={selectedIndex <= 0}
                className="authoring-interactive flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-white/80 disabled:opacity-25"
                aria-label="Previous question"
              >
                <ChevronLeft size={17} />
              </motion.button>
              <motion.button
                type="button"
                whileTap={authoringMotion.press}
                transition={authoringMotion.fast}
                onClick={() => void goToAdjacentQuestion(1)}
                disabled={selectedIndex < 0 || selectedIndex >= allQuestions.length - 1}
                className="authoring-interactive flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-white/80 disabled:opacity-25"
                aria-label="Next question"
              >
                <ChevronRight size={17} />
              </motion.button>
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {!draft ? (
              <motion.div
                key={pendingQuestionId ? `loading-${pendingQuestionId}` : "empty"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={authoringMotion.state}
              >
                {questionQuery.isLoading || pendingQuestionId ? (
                  <QuestionLoadingSkeleton />
                ) : (
                  <div className="flex min-h-[calc(100vh-122px)] items-center justify-center px-8 text-center">
                    <div className="max-w-sm">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                        <Eye size={20} className="text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">
                        {selectedModule
                          ? `Choose a question in ${selectedModule.title}`
                          : "Choose a module to start authoring"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Your workspace preferences are remembered on this device.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key={selectedExamQuestionId ?? draft.id}
                initial={{ opacity: 0, x: 8 * navigationDirection }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 * navigationDirection }}
                transition={authoringMotion.state}
              >
                <motion.div
                  layout
                  transition={authoringMotion.panel}
                  className={`grid min-h-[calc(100vh-122px)] ${
                    viewMode === "split"
                      ? "xl:grid-cols-[minmax(420px,1fr)_minmax(380px,0.9fr)]"
                      : "grid-cols-1"
                  }`}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {viewMode !== "preview" ? (
                      <motion.div
                        key="editor"
                        layout
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -5 }}
                        transition={authoringMotion.panel}
                        className="min-w-0 border-black/5 bg-white xl:border-r"
                      >
                        <QuestionEditor
                          question={draft}
                          saveStatus={autosave.status}
                          onChange={handleChange}
                          onSaveNow={() => void handleSaveNow()}
                          onDuplicate={() => void handleDuplicate()}
                          onDelete={() => void handleDelete()}
                        />
                      </motion.div>
                    ) : null}
                    {viewMode !== "edit" ? (
                      <motion.div
                        key="preview"
                        layout
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 5 }}
                        transition={authoringMotion.panel}
                        className="min-w-0 bg-[#f5f5f7] p-5 xl:p-8"
                      >
                        <div className="mx-auto max-w-3xl">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Eye size={15} className="text-slate-400" />
                              <span className="text-xs font-semibold text-slate-600">
                                Student preview
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              Live · delivery renderer
                            </span>
                          </div>
                          <div className="rounded-[22px] border border-black/[0.06] bg-white p-1 shadow-[0_10px_32px_rgba(0,0,0,0.06)]">
                            <ExamQuestionRenderer question={draft} disabled />
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <motion.aside
          initial={false}
          animate={{ width: showInspector ? 310 : 0, opacity: showInspector ? 1 : 0 }}
          transition={authoringMotion.panel}
          className="authoring-sidebar max-h-[calc(100vh-64px)] shrink-0 overflow-hidden border-l border-black/[0.06]"
          aria-hidden={!showInspector}
        >
          <div className="h-full w-[310px] overflow-y-auto p-4">
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Inspector
              </p>
              <h2 className="mt-1 text-sm font-semibold text-slate-900">Question setup</h2>
            </div>
            {draft ? (
              <QuestionProperties question={draft} onChange={handleChange} />
            ) : (
              <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                Select a question to edit its SAT metadata.
              </p>
            )}
            <div className="my-5 h-px bg-black/[0.06]" />
            <p className="rounded-xl bg-black/[0.035] px-3 py-2.5 text-[10px] leading-4 text-slate-500">
              Timing, routing, validation, and publishing are available from Review in the toolbar.
            </p>
          </div>
        </motion.aside>
      </main>
    </div>
  );
}

function QuestionLoadingSkeleton() {
  return (
    <div className="min-h-[calc(100vh-122px)] bg-white px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-3xl space-y-7" aria-label="Loading question" aria-busy="true">
        <div className="space-y-3">
          <div className="authoring-skeleton h-5 w-32 rounded-full" />
          <div className="authoring-skeleton h-8 w-44 rounded-lg" />
          <div className="authoring-skeleton h-3 w-40 rounded" />
        </div>
        <div className="space-y-2">
          <div className="authoring-skeleton h-3 w-24 rounded" />
          <div className="authoring-skeleton h-36 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="authoring-skeleton h-3 w-16 rounded" />
          <div className="authoring-skeleton h-28 w-full rounded-xl" />
        </div>
        <div className="grid gap-2.5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="authoring-skeleton h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function resolveAuthoringField(issuePath: string | null) {
  if (issuePath?.startsWith("metadata.domain")) return "domain";
  if (issuePath?.startsWith("metadata.skill")) return "skill";
  if (issuePath?.startsWith("stimulus")) return "stimulus";
  if (issuePath?.startsWith("prompt")) return "prompt";
  if (issuePath?.startsWith("rationale")) return "rationale";
  return "answer";
}

export function getShellProvider(shell: AssessmentAuthoringShell): string {
  return shell.providerKey;
}
