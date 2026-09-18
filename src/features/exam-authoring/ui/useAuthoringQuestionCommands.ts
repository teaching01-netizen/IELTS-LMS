import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AssessmentModuleShell,
  AssessmentSectionShell,
  BatchQuestionDraft,
  BulkQuestionAction,
  QuestionRevision,
} from "../contracts/assessment";
import type { SatWorkspaceCommandName } from "../realtime/coedit";
import type { CoeditSaveDisplayStatus } from "./spine/coeditSaveTruth";
import type { SatAuthoringCollaborationValue } from "../realtime/coedit";
import type { QuestionFlushResult } from "../hooks/useQuestionAutosave";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { authoringEffects } from "../api/authoringQueryEffects";
import {
  isQuestionWorkspaceScalar,
  questionWorkspaceScalar,
} from "./authoringWorkspaceModel";
import { selectionAfterDelete } from "./spine/overviewModel";
import type { WorkspaceMode } from "./useAuthoringKeyboard";

/**
 * The question command surface: create, import, duplicate, delete, reorder,
 * bulk-change, set-pretest, and save-and-advance.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nine callbacks that all repeat one shape:
 *
 *   refuse if a row mutation is in flight → make the open draft durable →
 *   issue the structural write → announce it → move the selection
 *
 * The shape was repeated, not shared, so each command had its own idea of which
 * of those steps were optional: `create` checked the target module's capacity
 * before flushing, `delete` computed the fallback selection before flushing,
 * `reorder` announced but did not move the selection, and only `create` and
 * `duplicate` adopted the server's returned revision. The row-mutation flight
 * flag was the one thing all of them did share — and it was a ref plus a busy
 * boolean declared in the component and passed down to the queue UI.
 *
 * This hook owns that surface, including the flight flag. It does NOT own:
 *
 *   - the mutations themselves (the workspace is the composition root and passes
 *     them in, so a test can supply fakes without a network);
 *   - the selection model (`useModuleQuestionSelection` + the anchor/range
 *     rules) — commands move the selection, they do not define it;
 *   - persistence. Durability is `useAuthoringPersistence`'s
 *     `flushBeforeNavigation`, injected here, so there is still exactly one
 *     answer to "is it saved before this write".
 *
 * The RETURNED surface stays flat and named: it is what the view binds to
 * (`onCreate`, `onDelete`, ...), so nesting the nine commands into groups would
 * lengthen every call site without telling a reader anything the names do not.
 * The INPUT is where the boundary needed stating, and it is grouped.
 */

/** What a create/duplicate answers with: the new row and its first revision. */
export interface CreatedQuestion {
  examQuestionId: string;
  question: QuestionRevision;
}

/**
 * The module a row belongs to, or null when the tree does not hold it.
 *
 * Resolved from the shell rather than assumed from the selection: a command may
 * name a row the author is not on (a context-menu delete, a multi-row bulk
 * action), and a question id that is no longer in the tree must answer "no
 * module" instead of matching whatever module happens to be open.
 */
function moduleOwningQuestion(
  sections: readonly AssessmentSectionShell[],
  targetId: string | null
): AssessmentModuleShell | null {
  if (!targetId) return null;
  for (const section of sections) {
    for (const module of section.modules) {
      if (module.questions.some((question) => question.examQuestionId === targetId)) {
        return module;
      }
    }
  }
  return null;
}

/**
 * The facts a command surface must be told, grouped by what they are about.
 *
 * One interface with twenty-plus flat fields was legible to the compiler and to
 * nobody else: a reader had to scan the whole list to learn that a command
 * moves the selection and tells the app afterwards, and a caller had no way to
 * see which facts belonged together. The groups ARE the boundary — where writes
 * go, what the author is looking at, the open document, the room, durability,
 * and what the rest of the app is told. The command bodies destructure them
 * straight back into the names they always used, so nothing below this line
 * changed shape.
 */
export interface AuthoringQuestionCommandsInput {
  /** Where the writes go. */
  identity: {
    examId: string;
    queryClient: QueryClient;
  };
  /** What the author is looking at, and the only ways a command may move it. */
  selection: {
    selectedModuleId: string | null;
    selectedModule: AssessmentModuleShell | null;
    /** The whole tree, for resolving the module that owns a named row. */
    shellSections: readonly AssessmentSectionShell[];
    selectedExamQuestionId: string | null;
    setSelectedModuleId: Dispatch<SetStateAction<string | null>>;
    setSelectedExamQuestionId: Dispatch<SetStateAction<string | null>>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    /** Clear the range anchor beside the selection, which the workspace owns. */
    clearSelectionAnchor: () => void;
  };
  /** The open document: the source for `inherit` and for save-and-advance. */
  draft: {
    draft: QuestionRevision | null;
    /** Carry the open question's metadata into the next created question. */
    keepMetadataForNext: boolean;
    setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  };
  /** The room, when one owns the exam: it changes what a command may do. */
  collaboration: {
    workspaceCollaboration: SatAuthoringCollaborationValue | null;
    coeditDisplayStatus: CoeditSaveDisplayStatus | null;
  };
  /** Durability: one barrier before a structural write, and the save-and-advance half. */
  durability: {
    flushBeforeNavigation: () => Promise<boolean>;
    commitAndAdvance: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  };
  /**
   * What a command tells the rest of the app once it has acted: the durable
   * summary projection, the workspace announcement, the notice channel, and the
   * surfaces it closes or returns to.
   */
  reporting: {
    updateSummaryCache: (examQuestionId: string, saved: QuestionRevision) => void;
    announce: (command: SatWorkspaceCommandName, payload: Record<string, unknown>) => void;
    setNavigationError: (message: string | null) => void;
    setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
    /** The batch-import sheet, an overlay the workspace owns. */
    setImportOpen: (open: boolean) => void;
  };
  /**
   * The mutations themselves (the workspace is the composition root and passes
   * them in, so a test can supply fakes without a network).
   */
  mutations: {
    createQuestion: (moduleId: string) => Promise<CreatedQuestion>;
    batchCreate: (input: {
      moduleId: string;
      request: { questions: BatchQuestionDraft[]; operationKey: string };
    }) => Promise<{ createdQuestionIds: string[] }>;
    duplicateQuestion: (input: {
      examQuestionId: string;
      request: {
        destinationModuleId: string;
        insertAfterExamQuestionId: string;
        operationKey: string;
      };
    }) => Promise<CreatedQuestion>;
    reorderQuestions: (input: {
      moduleId: string;
      request: { questionIds: string[]; expectedQuestionIds: string[] };
    }) => Promise<unknown>;
    bulkQuestions: (input: {
      questionIds: string[];
      action: BulkQuestionAction;
      expectedRevisions?: Record<string, number>;
      operationKey: string;
    }) => Promise<unknown>;
    validateExam: () => Promise<unknown>;
  };
}

export interface AuthoringQuestionCommands {
  /** A row-mutating command is in flight: the queue must refuse another. */
  rowMutationBusy: boolean;
  /**
   * The same fact in ref form, for the seams outside this hook: the selection
   * commands (`selectQuestion`, `selectModule`) refuse a move while a structural
   * write is in flight, and they must read it at call time rather than through a
   * render, exactly like the command guards above.
   */
  rowMutationFlightRef: { current: boolean };
  createQuestion: (inheritFrom?: QuestionRevision) => Promise<void>;
  batchImport: (drafts: BatchQuestionDraft[]) => Promise<void>;
  duplicateQuestion: (targetId?: string | null) => Promise<void>;
  deleteQuestion: (targetId?: string | null) => Promise<boolean>;
  saveAndNext: () => Promise<void>;
  reorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
  bulkAction: (
    questionIds: string[],
    action: BulkQuestionAction,
    expectedRevisions?: Record<string, number>
  ) => Promise<void>;
  setPretest: (isPretest: boolean) => void;
  openIssues: () => Promise<void>;
}

export function useAuthoringQuestionCommands(
  input: AuthoringQuestionCommandsInput
): AuthoringQuestionCommands {
  const { examId, queryClient } = input.identity;
  const {
    selectedModuleId,
    selectedModule,
    shellSections,
    selectedExamQuestionId,
    setSelectedModuleId,
    setSelectedExamQuestionId,
    setSelectedIds,
    clearSelectionAnchor,
  } = input.selection;
  const { draft, keepMetadataForNext, setDraft } = input.draft;
  const { workspaceCollaboration, coeditDisplayStatus } = input.collaboration;
  const { flushBeforeNavigation, commitAndAdvance } = input.durability;
  const { updateSummaryCache, announce, setNavigationError, setWorkspaceMode, setImportOpen } =
    input.reporting;
  const { mutations } = input;
  const {
    createQuestion: createQuestionMutation,
    batchCreate,
    duplicateQuestion: duplicateQuestionMutation,
    reorderQuestions,
    bulkQuestions,
    validateExam,
  } = mutations;

  // TWO forms of the same fact, deliberately. React renders the busy state (the
  // queue disables its rows), and the commands read the ref, because a command
  // that re-read renders would let two fast clicks both pass the "already busy"
  // check before either set the flag — the double-create this exists to stop.
  const rowMutationFlight = useRef(false);
  const [rowMutationBusy, setRowMutationBusy] = useState(false);

  const createQuestion = useCallback(
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
        const created = await createQuestionMutation(selectedModuleId);
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
          // The create's `shellChanged` effect already refreshed the release
          // projection; inheriting fields changes content, not structure.
          updateSummaryCache(created.examQuestionId, createdQuestion);
        }
        setSelectedExamQuestionId(created.examQuestionId);
        setDraft(createdQuestion);
        announce("question.created", {
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
      announce,
      createQuestionMutation,
      flushBeforeNavigation,
      selectedModule,
      selectedModuleId,
      setDraft,
      setNavigationError,
      setSelectedExamQuestionId,
      updateSummaryCache,
    ]
  );

  const batchImport = useCallback(
    async (drafts: BatchQuestionDraft[]) => {
      if (!selectedModuleId) throw new Error("Choose a SAT module before importing questions.");
      if (!(await flushBeforeNavigation()))
        throw new Error("Save the current question before importing.");
      const result = await batchCreate({
        moduleId: selectedModuleId,
        request: { questions: drafts, operationKey: crypto.randomUUID() },
      });
      await authoringEffects.shellChanged(queryClient, examId);
      announce("question.created", {
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
    [
      announce,
      batchCreate,
      examId,
      flushBeforeNavigation,
      queryClient,
      selectedModuleId,
      setDraft,
      setImportOpen,
      setSelectedExamQuestionId,
    ]
  );

  // Explicit target IDs: never select a row and invoke a stale selected-row closure.
  const duplicateQuestion = useCallback(
    async (targetId: string | null = selectedExamQuestionId) => {
      const module = moduleOwningQuestion(shellSections, targetId);
      if (
        !targetId ||
        !module ||
        module.questions.length >= module.targetQuestionCount ||
        rowMutationFlight.current
      )
        return;
      rowMutationFlight.current = true;
      setRowMutationBusy(true);
      try {
        if (!(await flushBeforeNavigation())) return;
        const created = await duplicateQuestionMutation({
          examQuestionId: targetId,
          request: {
            destinationModuleId: module.id,
            insertAfterExamQuestionId: targetId,
            operationKey: crypto.randomUUID(),
          },
        });
        setSelectedModuleId(module.id);
        setSelectedExamQuestionId(created.examQuestionId);
        setDraft(created.question);
        announce("question.duplicated", {
          questionId: created.examQuestionId,
          sourceQuestionId: targetId,
          moduleId: module.id,
        });
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question could not be duplicated."
        );
      } finally {
        rowMutationFlight.current = false;
        setRowMutationBusy(false);
      }
    },
    [
      announce,
      duplicateQuestionMutation,
      flushBeforeNavigation,
      selectedExamQuestionId,
      setDraft,
      setNavigationError,
      setSelectedExamQuestionId,
      setSelectedModuleId,
      shellSections,
    ]
  );

  const deleteQuestion = useCallback(
    async (targetId: string | null = selectedExamQuestionId) => {
      const module = moduleOwningQuestion(shellSections, targetId);
      if (!targetId || !module || rowMutationFlight.current) return false;
      rowMutationFlight.current = true;
      setRowMutationBusy(true);
      const deletingActive = targetId === selectedExamQuestionId;
      const index = module.questions.findIndex((q) => q.examQuestionId === targetId);
      const fallback = selectionAfterDelete(
        module.questions.filter((q) => q.examQuestionId !== targetId),
        index
      );
      try {
        if (!(await flushBeforeNavigation())) return false;
        await assessmentAuthoringApi.deleteQuestion(targetId);
        if (deletingActive) {
          setDraft(null);
          setSelectedExamQuestionId(fallback.examQuestionId);
        }
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(targetId);
          return next;
        });
        // Drops the deleted question's cached detail and refreshes the tree it
        // was part of, awaited so the row cannot reappear from a stale shell.
        await authoringEffects.questionRemoved(queryClient, examId, targetId);
        announce("question.deleted", { questionId: targetId, moduleId: module.id });
        return true;
      } catch (error) {
        setNavigationError(
          error instanceof Error ? error.message : "Question could not be deleted."
        );
        return false;
      } finally {
        rowMutationFlight.current = false;
        setRowMutationBusy(false);
      }
    },
    [
      announce,
      examId,
      flushBeforeNavigation,
      queryClient,
      selectedExamQuestionId,
      setDraft,
      setNavigationError,
      setSelectedExamQuestionId,
      setSelectedIds,
      shellSections,
    ]
  );

  const saveAndNext = useCallback(async () => {
    if (rowMutationFlight.current || !draft || !selectedModule) return;
    // The room owns the visible editor, so advancing is a selection move: the
    // previous question stays in the Y.Doc and its IndexedDB copy whether or not
    // the network has acknowledged it.
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
        await createQuestion(keepMetadataForNext ? draft : undefined);
      }
      return;
    }
    const result = await commitAndAdvance(draft);
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
      await createQuestion(keepMetadataForNext ? draft : undefined);
  }, [
    coeditDisplayStatus,
    commitAndAdvance,
    createQuestion,
    draft,
    keepMetadataForNext,
    selectedExamQuestionId,
    selectedModule,
    setDraft,
    setNavigationError,
    setSelectedExamQuestionId,
    workspaceCollaboration,
  ]);

  const reorder = useCallback(
    async (questionIds: string[], expectedQuestionIds: string[]) => {
      if (!selectedModuleId || !(await flushBeforeNavigation())) return;
      try {
        await reorderQuestions({
          moduleId: selectedModuleId,
          request: { questionIds, expectedQuestionIds },
        });
        announce("question.reordered", {
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
    [announce, flushBeforeNavigation, reorderQuestions, selectedModuleId, setNavigationError]
  );

  const bulkAction = useCallback(
    async (
      questionIds: string[],
      action: BulkQuestionAction,
      expectedRevisions?: Record<string, number>
    ) => {
      if (!(await flushBeforeNavigation()))
        throw new Error("Save the current question before applying a bulk action.");
      try {
        await bulkQuestions({
          questionIds,
          action,
          ...(expectedRevisions ? { expectedRevisions } : {}),
          operationKey: crypto.randomUUID(),
        });
        announce("question.bulk_changed", { questionIds, action });
        setSelectedIds(new Set());
        clearSelectionAnchor();
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
    [
      announce,
      bulkQuestions,
      clearSelectionAnchor,
      flushBeforeNavigation,
      selectedExamQuestionId,
      setDraft,
      setNavigationError,
      setSelectedExamQuestionId,
      setSelectedIds,
      setSelectedModuleId,
    ]
  );

  const setPretest = useCallback(
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
      void bulkAction([selectedExamQuestionId], { type: "set_pretest", value: isPretest }).catch(
        () => undefined
      );
    },
    [bulkAction, draft, selectedExamQuestionId, workspaceCollaboration]
  );

  const openIssues = useCallback(async () => {
    if (!(await flushBeforeNavigation())) return;
    setWorkspaceMode("issues");
    try {
      await validateExam();
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Validation could not be completed."
      );
    }
  }, [flushBeforeNavigation, setNavigationError, setWorkspaceMode, validateExam]);

  return {
    rowMutationBusy,
    rowMutationFlightRef: rowMutationFlight,
    createQuestion,
    batchImport,
    duplicateQuestion,
    deleteQuestion,
    saveAndNext,
    reorder,
    bulkAction,
    setPretest,
    openIssues,
  };
}
