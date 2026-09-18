import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AssessmentAuthoringShell,
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
} from "../contracts/assessment";
import { useModuleQuestionSelection } from "./moduleQuestionMemory";
import type { SpineQueueFilter } from "./spine/queueModel";

/**
 * "Which module and which question is the author working on?" — one owner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The workspace used to declare these five pieces of state itself and then
 * reconcile them from two effects that read the shell, the URL and each other:
 *
 *   - the deep link (`?question=<id>&field=<field>`) adopted a target question
 *     and stripped itself from the URL;
 *   - a shell that no longer contained the selected module re-selected the
 *     first one, so a deleted module could not leave the editor pointing at a
 *     row that no longer exists.
 *
 * Both of those are SELECTION rules, and they were spread across the component
 * that also owns rendering, persistence and the realtime bridge. They now live
 * with the state they reconcile.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a reducer over the whole workspace. The draft lifecycle (see
 * `authoringDraftLifecycle`), the persistence truth (see
 * `useAuthoringPersistence`) and the overlay stack stay where they are; the
 * only thing this hook owns is "where the author is looking".
 *
 * The one dependency it takes back is `onQuestionAdopted`: adopting a different
 * question invalidates whatever draft was open, and the draft is not this
 * hook's to clear.
 */
export interface AuthoringSelectionInput {
  /**
   * The ready shell, or undefined while the lifecycle has not produced one.
   * Passed in rather than fetched: the workspace owns the shell lifecycle.
   */
  shell: AssessmentAuthoringShell | undefined;
  /** Called when the selection moves to a different question. */
  onQuestionAdopted?: (examQuestionId: string | null) => void;
  /** Focus a deep-linked editor field once its question is open. */
  onDeepLinkField?: (path: string | null) => void;
}

export interface AuthoringSelection {
  selectedModuleId: string | null;
  setSelectedModuleId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedExamQuestionId: string | null;
  setSelectedExamQuestionId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedSection: AssessmentSectionShell | null;
  selectedModule: AssessmentModuleShell | null;
  /** The selected question's index inside the selected module, or -1. */
  selectedModuleIndex: number;
  /** Every question in the shell, each tagged with the module that holds it. */
  allQuestions: (AssessmentQuestionSummary & { moduleId: string })[];
  /** The question to open when entering a module (its remembered one). */
  entryQuestionFor: (
    module: Pick<AssessmentModuleShell, "id" | "questions"> | null
  ) => string | null;
  /** The row multi-selection used by bulk actions, plus its shift anchor. */
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectionAnchorRef: React.RefObject<string | null>;
  /** The queue's text filter and its status chip. */
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filter: SpineQueueFilter;
  setFilter: React.Dispatch<React.SetStateAction<SpineQueueFilter>>;
  /** Drop the row multi-selection and its anchor (a wholesale replacement). */
  clearRowSelection: () => void;
}

export function useAuthoringSelection({
  shell,
  onQuestionAdopted,
  onDeepLinkField,
}: AuthoringSelectionInput): AuthoringSelection {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedExamQuestionId, setSelectedExamQuestionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SpineQueueFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

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

  const { entryQuestionFor } = useModuleQuestionSelection({
    module: selectedModule,
    selectedExamQuestionId,
    onAdoptQuestion: (examQuestionId) => {
      onQuestionAdopted?.(examQuestionId);
      setSelectedExamQuestionId(examQuestionId);
    },
  });

  const clearRowSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionAnchorRef.current = null;
  }, []);

  // The deep link is an INPUT to the selection, not a second source of truth:
  // it is consumed once, the URL is cleaned, and normal selection rules apply
  // from then on. A link naming a question this shell does not contain is
  // dropped rather than guessed at.
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
        onDeepLinkField?.(deepField);
        const next = new URLSearchParams(searchParams);
        next.delete("question");
        next.delete("field");
        setSearchParams(next, { replace: true });
        return;
      }
    }
    // A selection pointing at a module this shell no longer contains (deleted,
    // or a different draft) falls back to the shell's first question. This is
    // the rule that keeps a stale module from rendering over another module's
    // question, so it is stated once, here.
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
  }, [searchParams, selectedModuleId, setSearchParams, shell, onDeepLinkField]);

  return {
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
  };
}
