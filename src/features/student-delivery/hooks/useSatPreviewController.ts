import { useCallback, useEffect, useMemo, useState } from "react";
import { assessmentAuthoringApi } from "../../exam-authoring/api/assessmentAuthoringApi";
import type {
  AssessmentPreviewProjection,
  DeliveredAssessmentModule,
  DeliveredAssessmentSection,
} from "../../exam-authoring/api/assessmentContracts";
import { resolveSatExamToolPolicy, toSatToolCapabilities } from "../domain/satToolPolicy";
import {
  emptySatQuestionResponse,
  responseForQuestion,
  type SatQuestionResponseDraft,
  type SatQuestionAnnotations,
} from "../domain/satResponses";
import { buildSatQuestionNavigationItems } from "../domain/satSelectors";

export type SatPreviewView = "questions" | "review" | "break";

interface PreviewLocation {
  sectionId: string;
  moduleId: string;
  questionIndex: number;
}

function ordered<T extends { displayOrder: number }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.displayOrder - right.displayOrder);
}

function firstLocation(projection: AssessmentPreviewProjection): PreviewLocation | null {
  for (const section of ordered(projection.sections)) {
    const module = ordered(section.modules)[0];
    if (module) return { sectionId: section.id, moduleId: module.id, questionIndex: 0 };
  }
  return null;
}

function preserveLocation(
  current: AssessmentPreviewProjection,
  next: AssessmentPreviewProjection,
  location: PreviewLocation | null
): PreviewLocation | null {
  if (!location) return firstLocation(next);
  const currentSection = current.sections.find((section) => section.id === location.sectionId);
  const currentModule = currentSection?.modules.find((module) => module.id === location.moduleId);
  const questionId = currentModule?.questions[location.questionIndex]?.examQuestionId ?? null;
  const nextSection = next.sections.find((section) => section.id === location.sectionId);
  const nextModule = nextSection?.modules.find((module) => module.id === location.moduleId);
  if (nextSection && nextModule) {
    const questionIndex = questionId
      ? nextModule.questions.findIndex((question) => question.examQuestionId === questionId)
      : -1;
    return {
      sectionId: nextSection.id,
      moduleId: nextModule.id,
      questionIndex:
        questionIndex >= 0
          ? questionIndex
          : Math.min(location.questionIndex, Math.max(0, nextModule.questions.length - 1)),
    };
  }
  return firstLocation(next);
}

export function useSatPreviewController(examId: string) {
  const [projection, setProjection] = useState<AssessmentPreviewProjection | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<AssessmentPreviewProjection | null>(null);
  const [location, setLocation] = useState<PreviewLocation | null>(null);
  const [responses, setResponses] = useState<Record<string, SatQuestionResponseDraft>>({});
  const [view, setView] = useState<SatPreviewView>("questions");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await assessmentAuthoringApi.getPreview(examId);
      setProjection(next);
      setLocation(firstLocation(next));
      setPendingRefresh(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load SAT preview.");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projection) return;
    const onFocus = () => {
      void assessmentAuthoringApi
        .getPreview(examId)
        .then((candidate) => {
          if (
            candidate.versionId !== projection.versionId ||
            candidate.versionRevision !== projection.versionRevision
          ) {
            setPendingRefresh(candidate);
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [examId, projection]);

  const sections = useMemo(() => ordered(projection?.sections ?? []), [projection]);
  const section = useMemo(
    () => sections.find((candidate) => candidate.id === location?.sectionId) ?? null,
    [location?.sectionId, sections]
  );
  const modules = useMemo(() => ordered(section?.modules ?? []), [section]);
  const module = useMemo(
    () => modules.find((candidate) => candidate.id === location?.moduleId) ?? null,
    [location?.moduleId, modules]
  );
  const questions = useMemo(() => ordered(module?.questions ?? []), [module]);
  const questionIndex = Math.min(location?.questionIndex ?? 0, Math.max(0, questions.length - 1));
  const question = questions[questionIndex] ?? null;
  const questionIds = useMemo(
    () => questions.map((candidate) => candidate.examQuestionId),
    [questions]
  );
  const response = question ? responseForQuestion(responses, question.examQuestionId) : null;
  const navigationItems = buildSatQuestionNavigationItems(questionIds, questionIndex, responses);
  const toolPolicy = resolveSatExamToolPolicy(section?.sectionKey === "math" ? "math" : "reading-writing", module?.toolPolicy ?? []);
  const tools = toSatToolCapabilities(toolPolicy);

  const setResponse = useCallback(
    (
      questionId: string,
      updater: (current: SatQuestionResponseDraft) => SatQuestionResponseDraft
    ) => {
      setResponses((current) => ({
        ...current,
        [questionId]: updater(current[questionId] ?? emptySatQuestionResponse(questionId)),
      }));
    },
    []
  );

  const selectModule = useCallback(
    (nextSection: DeliveredAssessmentSection, nextModule: DeliveredAssessmentModule) => {
      setLocation({ sectionId: nextSection.id, moduleId: nextModule.id, questionIndex: 0 });
      setView("questions");
      setCalculatorOpen(false);
      setReferenceOpen(false);
    },
    []
  );

  const selectSectionById = useCallback(
    (sectionId: string) => {
      const nextSection = sections.find((candidate) => candidate.id === sectionId);
      const nextModule = ordered(nextSection?.modules ?? [])[0];
      if (nextSection && nextModule) selectModule(nextSection, nextModule);
    },
    [sections, selectModule]
  );

  const selectModuleById = useCallback(
    (moduleId: string) => {
      const nextModule = modules.find((candidate) => candidate.id === moduleId);
      if (section && nextModule) selectModule(section, nextModule);
    },
    [modules, section, selectModule]
  );

  const sectionIndex = section
    ? sections.findIndex((candidate) => candidate.id === section.id)
    : -1;
  const moduleIndex = module ? modules.findIndex((candidate) => candidate.id === module.id) : -1;

  const moveSection = useCallback(
    (delta: number) => {
      const nextSection = sections[sectionIndex + delta];
      const nextModule = ordered(nextSection?.modules ?? [])[0];
      if (nextSection && nextModule) selectModule(nextSection, nextModule);
    },
    [sectionIndex, sections, selectModule]
  );

  const moveModule = useCallback(
    (delta: number) => {
      const nextModule = modules[moduleIndex + delta];
      if (section && nextModule) selectModule(section, nextModule);
    },
    [moduleIndex, modules, section, selectModule]
  );

  const continueFromReview = useCallback(() => {
    const nextModule = modules[moduleIndex + 1];
    if (section && nextModule) {
      selectModule(section, nextModule);
      return;
    }
    if (section?.breakAfterSeconds) {
      setView("break");
      return;
    }
    moveSection(1);
  }, [moduleIndex, modules, moveSection, section, selectModule]);

  const applyPendingRefresh = useCallback(() => {
    if (!projection || !pendingRefresh) return;
    setLocation((current) => preserveLocation(projection, pendingRefresh, current));
    setProjection(pendingRefresh);
    setPendingRefresh(null);
    setView("questions");
  }, [pendingRefresh, projection]);

  return {
    projection,
    pendingRefresh,
    loading,
    error,
    reload: load,
    sections,
    section,
    modules,
    module,
    question,
    questionIndex,
    questionIds,
    response,
    responses,
    navigationItems,
    tools,
    toolPolicy,
    view,
    calculatorOpen,
    referenceOpen,
    canPreviousSection: sectionIndex > 0,
    canNextSection: sectionIndex >= 0 && sectionIndex < sections.length - 1,
    canPreviousModule: moduleIndex > 0,
    canNextModule: moduleIndex >= 0 && moduleIndex < modules.length - 1,
    commands: {
      applyPendingRefresh,
      selectSectionById,
      selectModuleById,
      previousSection: () => moveSection(-1),
      nextSection: () => moveSection(1),
      previousModule: () => moveModule(-1),
      nextModule: () => moveModule(1),
      selectQuestion: (index: number) => {
        setLocation((current) =>
          current
            ? {
                ...current,
                questionIndex: Math.max(0, Math.min(index, Math.max(0, questions.length - 1))),
              }
            : current
        );
        setView("questions");
      },
      previousQuestion: () =>
        setLocation((current) =>
          current ? { ...current, questionIndex: Math.max(0, current.questionIndex - 1) } : current
        ),
      nextQuestion: () =>
        setLocation((current) =>
          current
            ? {
                ...current,
                questionIndex: Math.min(
                  Math.max(0, questions.length - 1),
                  current.questionIndex + 1
                ),
              }
            : current
        ),
      showReview: () => setView("review"),
      showQuestions: () => setView("questions"),
      showBreak: () => setView("break"),
      continueFromReview,
      setAnswer: (answer: string) =>
        question && setResponse(question.examQuestionId, (current) => ({ ...current, answer })),
      toggleReview: () =>
        question &&
        setResponse(question.examQuestionId, (current) => ({
          ...current,
          markedForReview: !current.markedForReview,
        })),
      toggleEliminatedOption: (optionId: string) =>
        question &&
        setResponse(question.examQuestionId, (current) => ({
          ...current,
          eliminatedOptionIds: current.eliminatedOptionIds.includes(optionId)
            ? current.eliminatedOptionIds.filter((candidate) => candidate !== optionId)
            : [...current.eliminatedOptionIds, optionId],
        })),
      setNote: (note: string) =>
        question &&
        setResponse(question.examQuestionId, (current) => ({
          ...current,
          annotations: { ...current.annotations, legacyQuestionNote: note.slice(0, 2_000) },
        })),
      setAnnotations: (annotations: SatQuestionAnnotations) =>
        question && toolPolicy.highlight && setResponse(question.examQuestionId, (current) => ({ ...current, annotations })),
      toggleCalculator: () => setCalculatorOpen((open) => tools.calculator && !open),
      toggleReference: () => setReferenceOpen((open) => tools.referenceSheet && !open),
      closeCalculator: () => setCalculatorOpen(false),
      closeReference: () => setReferenceOpen(false),
    },
  };
}
