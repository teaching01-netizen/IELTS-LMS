import { useCallback, useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AssessmentAuthoringShell,
  SatWorkbookCommitResult,
  SatWorkbookUndoState,
} from "../contracts/assessment";
import type { SatWorkspaceCommandName } from "../realtime/coedit";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { authoringEffects } from "../api/authoringQueryEffects";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";

/**
 * The SAT workbook import transaction.
 *
 * WHY THIS EXISTS
 * ---------------
 * A workbook import is not a question command: it replaces the exam's questions
 * wholesale, so the transaction is "stage against the current draft → commit →
 * adopt the returned shell → remember that the commit can still be undone, but
 * only until someone edits". The workspace carried those five pieces as three
 * state cells, one availability fetch and three callbacks, and every one of them
 * had to remember the same rule about WHEN an undo stops being available.
 *
 * This hook owns that transaction. It does not own the selection reset that
 * follows a wholesale replacement — that is the workspace's selection model and
 * it is shared with every other wholesale replacement (batch import, sample
 * load), so it is injected as `onQuestionsReplaced` rather than duplicated here.
 *
 * The importer itself (`SatWorkbookImportSheet`) is an overlay the workspace
 * owns; this hook only decides when it may open and what is staged for it.
 */

export interface AuthoringWorkbookInput {
  examId: string;
  queryClient: QueryClient;
  /** The shell identity the undo availability is read against. */
  shellVersionId: string | null;
  shellVersionRevision: number | null;
  /**
   * The save truth that decides whether an undo is still valid. An undo rewinds
   * to the pre-import revision, so it may only run while nothing has been
   * written since: `saved` is the whole condition.
   */
  saveStatus: QuestionSaveStatus;
  /** Make the open draft durable before a structural transaction. */
  flushBeforeNavigation: () => Promise<boolean>;
  /** Adopt a shell that replaced the exam's questions wholesale. */
  onQuestionsReplaced: (shell: AssessmentAuthoringShell) => void;
  announce: (command: SatWorkspaceCommandName, payload: Record<string, unknown>) => void;
  /** The workspace's single refusal/notice channel. */
  setNavigationError: (message: string | null) => void;
  /** Open/close the import sheet, which the workspace owns as an overlay. */
  setImportOpen: (open: boolean) => void;
}

export interface AuthoringWorkbook {
  /** The shell the importer stages against, or null while it is closed. */
  baseline: AssessmentAuthoringShell | null;
  /** The undo the server still offers, or null when there is none. */
  undo: SatWorkbookUndoState | null;
  undoBusy: boolean;
  openImport: () => Promise<void>;
  /** Close the sheet and drop the staged baseline. */
  closeImport: () => void;
  handleCommitted: (result: SatWorkbookCommitResult) => void;
  /**
   * Drop the undo offer without attempting it. Called when the author edits,
   * which is the one thing that makes a rewind unsafe.
   */
  withdrawUndo: () => void;
  undoImport: () => Promise<void>;
}

function questionCount(shell: AssessmentAuthoringShell): number {
  return shell.sections.reduce(
    (total, section) =>
      total + section.modules.reduce((count, module) => count + module.questions.length, 0),
    0
  );
}

export function useAuthoringWorkbook(input: AuthoringWorkbookInput): AuthoringWorkbook {
  const {
    examId,
    queryClient,
    shellVersionId,
    shellVersionRevision,
    saveStatus,
    flushBeforeNavigation,
    onQuestionsReplaced,
    announce,
    setNavigationError,
    setImportOpen,
  } = input;

  const [baseline, setBaseline] = useState<AssessmentAuthoringShell | null>(null);
  const [undo, setUndo] = useState<SatWorkbookUndoState | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  // Availability is the server's answer, re-read whenever the draft version
  // moves: an undo that another tab already consumed must not stay on offer.
  useEffect(() => {
    if (!shellVersionId) return undefined;
    let cancelled = false;
    void assessmentAuthoringApi
      .getSatWorkbookUndoState(examId)
      .then((state) => {
        if (!cancelled) setUndo(state?.available ? state : null);
      })
      .catch(() => {
        if (!cancelled) setUndo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, shellVersionId, shellVersionRevision]);

  const openImport = useCallback(async () => {
    setNavigationError(null);
    if (!(await flushBeforeNavigation())) return;
    try {
      // The importer stages against the CURRENT draft, so a NO_DRAFT answer is
      // a refusal rather than an empty baseline: importing into an exam with no
      // draft would silently mean something the author did not ask for.
      const staged = await assessmentAuthoringApi.getShell(examId);
      if (!staged.shell) {
        throw new Error("This exam has no editable draft to import into yet.");
      }
      setBaseline(staged.shell);
      setImportOpen(true);
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "The SAT workbook importer could not be opened."
      );
    }
  }, [examId, flushBeforeNavigation, setImportOpen, setNavigationError]);

  const handleCommitted = useCallback(
    (result: SatWorkbookCommitResult) => {
      const nextShell = result.shell;
      void authoringEffects.questionsReplaced(queryClient, examId, nextShell);
      onQuestionsReplaced(nextShell);
      setImportOpen(false);
      setBaseline(null);
      setUndo(result.undo.available ? result.undo : null);
      announce("workbook.imported", { questionCount: questionCount(nextShell) });
    },
    [announce, examId, onQuestionsReplaced, queryClient, setImportOpen]
  );

  const closeImport = useCallback(() => {
    setImportOpen(false);
    setBaseline(null);
  }, [setImportOpen]);

  const withdrawUndo = useCallback(() => {
    setUndo(null);
  }, []);

  const undoImport = useCallback(async () => {
    if (!undo?.available || undoBusy) return;
    if (saveStatus !== "saved") {
      // The undo rewinds to the pre-import revision; anything written since
      // would be rolled back with it, so the offer is withdrawn instead.
      setUndo(null);
      setNavigationError("Undo is no longer available after editing the imported SAT.");
      return;
    }
    setUndoBusy(true);
    setNavigationError(null);
    try {
      const nextShell = await assessmentAuthoringApi.undoSatWorkbookImport(examId, undo.importId);
      void authoringEffects.questionsReplaced(queryClient, examId, nextShell);
      onQuestionsReplaced(nextShell);
      setUndo(null);
      announce("workbook.undone", { importId: undo.importId });
    } catch (error) {
      setUndo(null);
      setNavigationError(
        error instanceof Error ? error.message : "The Excel import could not be undone."
      );
    } finally {
      setUndoBusy(false);
    }
  }, [
    announce,
    examId,
    onQuestionsReplaced,
    queryClient,
    saveStatus,
    setNavigationError,
    undo,
    undoBusy,
  ]);

  return {
    baseline,
    undo,
    undoBusy,
    openImport,
    closeImport,
    handleCommitted,
    withdrawUndo,
    undoImport,
  };
}
