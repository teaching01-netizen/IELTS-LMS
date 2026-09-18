import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type {
  AssessmentModuleShell,
  AssessmentSectionShell,
  QuestionRevision,
} from "../contracts/assessment";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import type { SpineQueueFilter } from "./spine/queueModel";

/**
 * The navigation guard: every way the author can leave the open question while
 * something is unsaved.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Is it safe to move?" was answered in two places with the same rule and
 * neither named it: the two selection callbacks consulted the row-mutation
 * flight flag, ran the durability barrier and reset the draft, while a separate
 * effect decided whether closing the tab needed a browser warning. The rule for
 * the tab was different from the rule for a selection — deliberately so, and
 * that difference was the thing most likely to be lost in a refactor.
 *
 * The two rules, stated once:
 *
 *   SELECTION — a move INSIDE the room. The previous question's content stays in
 *   the Y.Doc and in its IndexedDB copy whether or not the network has
 *   acknowledged it, so the barrier is the cheap one (`selection`), and a
 *   refused barrier cancels the move. A structural write in flight cancels it
 *   too: moving away from the row an in-flight command is about would leave the
 *   author on a question that is about to change underneath them.
 *
 *   UNLOAD — the tab is going away, and there is no "afterwards". Both writers
 *   contribute their own truth (the room never enqueues a legacy autosave, and
 *   the legacy branch never opens one), because warning from only one of them
 *   would let a browser close discard the other's content.
 *
 * It does not own persistence: the barrier is `useAuthoringPersistence`'s
 * `flushBeforeNavigation`, injected here, so there is still exactly one answer
 * to "is this durable" and one owner of the pending/offline truth.
 */

export interface AuthoringNavigationGuardInput {
  selectedModuleId: string | null;
  selectedExamQuestionId: string | null;
  /** The whole tree, for resolving the module a move enters. */
  shellSections: readonly AssessmentSectionShell[];
  /** Where entering a module should land: the question last left open there. */
  entryQuestionFor: (
    module: Pick<AssessmentModuleShell, "id" | "questions"> | null
  ) => string | null;
  /** The in-page durability barrier, owned by persistence. */
  flushBeforeNavigation: (intent?: "selection" | "mutation") => Promise<boolean>;
  /** A structural write is in flight: the row it targets must not move. */
  rowMutationFlightRef: { current: boolean };
  /** The legacy queue's pending truth. */
  hasPendingChanges: boolean;
  isOffline: boolean;
  saveStatus: QuestionSaveStatus;
  /** The room's own unload truth, read from its snapshot. */
  roomNeedsUnloadWarning: boolean;
  setNavigationError: (message: string | null) => void;
  setSelectedModuleId: Dispatch<SetStateAction<string | null>>;
  setSelectedExamQuestionId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setFilter: Dispatch<SetStateAction<SpineQueueFilter>>;
  /** Clear the range anchor beside the selection, which the workspace owns. */
  clearSelectionAnchor: () => void;
}

export interface AuthoringNavigationGuard {
  /** Move to a question, possibly in another module. False when the move was refused. */
  selectQuestion: (questionId: string, moduleId?: string | null) => Promise<boolean>;
  /** Enter a module at the question the author was last on there. */
  selectModule: (moduleId: string) => Promise<void>;
}

export function useAuthoringNavigationGuard(
  input: AuthoringNavigationGuardInput
): AuthoringNavigationGuard {
  const {
    selectedModuleId,
    selectedExamQuestionId,
    shellSections,
    entryQuestionFor,
    flushBeforeNavigation,
    rowMutationFlightRef,
    hasPendingChanges,
    isOffline,
    saveStatus,
    roomNeedsUnloadWarning,
    setNavigationError,
    setSelectedModuleId,
    setSelectedExamQuestionId,
    setDraft,
    setSelectedIds,
    setSearchQuery,
    setFilter,
    clearSelectionAnchor,
  } = input;

  const selectQuestion = useCallback(
    async (questionId: string, moduleId: string | null = selectedModuleId) => {
      if (rowMutationFlightRef.current) return false;
      if (questionId === selectedExamQuestionId) return true;
      setNavigationError(null);
      if (!(await flushBeforeNavigation("selection"))) return false;
      if (moduleId) setSelectedModuleId(moduleId);
      setDraft(null);
      setSelectedExamQuestionId(questionId);
      return true;
    },
    [
      flushBeforeNavigation,
      rowMutationFlightRef,
      selectedExamQuestionId,
      selectedModuleId,
      setDraft,
      setNavigationError,
      setSelectedExamQuestionId,
      setSelectedModuleId,
    ]
  );

  const selectModule = useCallback(
    async (moduleId: string) => {
      if (rowMutationFlightRef.current || moduleId === selectedModuleId) return;
      if (!(await flushBeforeNavigation("selection"))) return;
      const module = shellSections
        .flatMap((section) => section.modules)
        .find((item) => item.id === moduleId);
      // A module change is a fresh scope: the old search, filter and row
      // selection describe rows of the module being left.
      setSearchQuery("");
      setFilter("all");
      setSelectedIds(new Set());
      clearSelectionAnchor();
      setSelectedModuleId(moduleId);
      setDraft(null);
      // Entering a module returns to the question the author was last on there,
      // not to its first question and never to the question of the module they
      // came from.
      setSelectedExamQuestionId(entryQuestionFor(module ?? null));
    },
    [
      clearSelectionAnchor,
      entryQuestionFor,
      flushBeforeNavigation,
      rowMutationFlightRef,
      selectedModuleId,
      setDraft,
      setFilter,
      setSearchQuery,
      setSelectedExamQuestionId,
      setSelectedIds,
      setSelectedModuleId,
      shellSections,
    ]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const shouldWarn =
      roomNeedsUnloadWarning ||
      (hasPendingChanges && (isOffline || ["unsaved", "saving", "error"].includes(saveStatus)));
    if (!shouldWarn) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasPendingChanges, isOffline, roomNeedsUnloadWarning, saveStatus]);

  return { selectQuestion, selectModule };
}
