import React, { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionAnswer, QuestionBlock } from "../../types";
import type { StudentQuestionDescriptor } from "@student/application/studentExamContentFacade";
import type { StudentAnswerMutationMeta } from "../../types/studentAttempt";
import type { StudentHighlightColor } from "./highlightPalette";
import type { StudentLayoutMode } from "./layout/studentLayoutMode";
import { StudentQuestionPanel } from "./StudentQuestionPanel";
import { StudentSplitPaneResizer, type StudentSplitResizeCommands } from "./StudentSplitPaneResizer";

const paneTabClassName =
  "student-touch-target flex-1 rounded-sm border px-3 text-sm font-semibold transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out";

interface StudentMaterialWithQuestionPaneProps {
  isTabletMode: boolean;
  layoutMode?: StudentLayoutMode | undefined;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  splitPaneStyle: React.CSSProperties | undefined;
  leftWidth: number;
  splitMinWidth?: number;
  splitMaxWidth?: number;
  /** P2.4: false when readable pane minimums cannot fit (focus override) — hides the separator. */
  splitSplittable?: boolean;
  onDividerPointerDown: (
    event: React.PointerEvent<HTMLDivElement>
  ) => void;
  onDividerPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDividerPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDividerKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  resizeCommands?: StudentSplitResizeCommands | undefined;
  workspaceTestId: string;
  dividerAriaLabel: string;
  dividerTestId: string;
  materialPane: React.ReactNode;
  /** S1-C3: sessionStorage key for the compact tab (per exam + module). Omit to disable. */
  persistenceKey?: string | undefined;
  questionPanel: {
    blocks: QuestionBlock[];
    allQuestions: StudentQuestionDescriptor[];
    answers: Record<string, QuestionAnswer>;
    onAnswerChange: (
      questionId: string,
      answer: QuestionAnswer,
      meta?: StudentAnswerMutationMeta
    ) => void;
    currentQuestionId: string | null;
    onNavigate: (id: string) => void;
    flags: Record<string, boolean>;
    onToggleFlag?: ((id: string) => void) | undefined;
    answerCompact: boolean;
    highlightEnabled: boolean;
    highlightColor: StudentHighlightColor | undefined;
    registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
    questionContainerRef: React.RefObject<HTMLDivElement | null>;
    contentZoomStyle: React.CSSProperties | undefined;
    panelTestId: string;
    getBlockStartQuestionNumber: (blockId: string) => number;
    renderBlockInstruction: (instruction: string, blockId: string) => React.ReactNode;
    expandedQuestionGapClassName?: string | undefined;
    hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
    hideStepper?: boolean | undefined;
    shouldFocusQuestion?: (() => boolean) | undefined;
    eliminatedOptionIdsByQuestion?: Readonly<Record<string, readonly string[]>> | undefined;
    onToggleOptionElimination?: ((questionId: string, optionId: string) => void) | undefined;
  };
}

type CompactPane = "material" | "questions";

function findScrollOwner(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>("[data-student-zoom-scroll]") ?? root;
}

// S1-C3: persist the compact tab per exam + module so a remount restores
// the learner's tab instead of snapping back to "material". sessionStorage
// keeps it tab-scoped; anything unexpected falls back to "material".
function readPersistedCompactPane(storageKey: string | undefined): CompactPane {
  if (!storageKey) {
    return "material";
  }
  try {
    return sessionStorage.getItem(storageKey) === "questions" ? "questions" : "material";
  } catch {
    return "material";
  }
}

export function StudentMaterialWithQuestionPane({
  isTabletMode,
  layoutMode = "wide",
  workspaceRef,
  splitPaneStyle,
  leftWidth,
  splitMinWidth,
  splitMaxWidth,
  splitSplittable = true,
  onDividerPointerDown,
  onDividerPointerMove,
  onDividerPointerEnd,
  onDividerKeyDown,
  resizeCommands,
  workspaceTestId,
  dividerAriaLabel,
  dividerTestId,
  materialPane,
  persistenceKey,
  questionPanel,
}: StudentMaterialWithQuestionPaneProps) {
  const isCompact = layoutMode === "compact" || layoutMode === "phone";
  // S1-C3: lazy-init from sessionStorage so a remount restores the tab.
  const [activeCompactPane, setActiveCompactPane] = useState<CompactPane>(() =>
    readPersistedCompactPane(persistenceKey)
  );
  const lastFocusedPaneRef = useRef<CompactPane>(activeCompactPane);
  const previousCompactRef = useRef(isCompact);
  const previousQuestionIdRef = useRef(questionPanel.currentQuestionId);
  const materialPaneRef = useRef<HTMLDivElement>(null);
  const questionPaneRef = useRef<HTMLDivElement>(null);
  const materialScrollTopRef = useRef(0);
  const questionScrollTopRef = useRef(0);

  const saveCompactScrollPosition = useCallback(() => {
    const owner = findScrollOwner(
      activeCompactPane === "material" ? materialPaneRef.current : questionPaneRef.current
    );
    if (activeCompactPane === "material") {
      materialScrollTopRef.current = owner?.scrollTop ?? 0;
    } else {
      questionScrollTopRef.current = owner?.scrollTop ?? 0;
    }
  }, [activeCompactPane]);

  const selectCompactPane = useCallback(
    (nextPane: CompactPane) => {
      if (nextPane === activeCompactPane) {
        lastFocusedPaneRef.current = nextPane;
        return;
      }

      lastFocusedPaneRef.current = nextPane;
      saveCompactScrollPosition();
      setActiveCompactPane(nextPane);
      // S1-C3: persist on change (try/catch; best-effort when storage is off).
      if (persistenceKey) {
        try {
          sessionStorage.setItem(persistenceKey, nextPane);
        } catch {
          // Storage may be unavailable — in-memory state still works.
        }
      }
    },
    [activeCompactPane, persistenceKey, saveCompactScrollPosition]
  );

  useEffect(() => {
    if (isCompact && !previousCompactRef.current) {
      setActiveCompactPane(lastFocusedPaneRef.current);
    }
    previousCompactRef.current = isCompact;
  }, [isCompact]);

  useEffect(() => {
    if (!isCompact) {
      previousQuestionIdRef.current = questionPanel.currentQuestionId;
      return;
    }

    const nextId = questionPanel.currentQuestionId;
    const previousId = previousQuestionIdRef.current;
    previousQuestionIdRef.current = nextId;

    if (nextId !== null && previousId !== null && nextId !== previousId) {
      selectCompactPane("questions");
    }
  }, [questionPanel.currentQuestionId, isCompact, selectCompactPane]);

  useEffect(() => {
    if (!isCompact) {
      previousQuestionIdRef.current = questionPanel.currentQuestionId;
      return;
    }

    const previousId = previousQuestionIdRef.current;
    if (
      previousId === null &&
      questionPanel.currentQuestionId !== null &&
      previousId !== questionPanel.currentQuestionId
    ) {
      previousQuestionIdRef.current = questionPanel.currentQuestionId;
      return;
    }
    previousQuestionIdRef.current = questionPanel.currentQuestionId;
  }, [questionPanel.currentQuestionId, isCompact]);

  useEffect(() => {
    if (!isCompact) {
      return;
    }

    const owner = findScrollOwner(
      activeCompactPane === "material" ? materialPaneRef.current : questionPaneRef.current
    );
    if (owner) {
      owner.scrollTop =
        activeCompactPane === "material"
          ? materialScrollTopRef.current
          : questionScrollTopRef.current;
    }
  }, [activeCompactPane, isCompact]);

  const questionPanelElement = (
    <StudentQuestionPanel
      blocks={questionPanel.blocks}
      allQuestions={questionPanel.allQuestions}
      answers={questionPanel.answers}
      onAnswerChange={questionPanel.onAnswerChange}
      currentQuestionId={questionPanel.currentQuestionId}
      onNavigate={questionPanel.onNavigate}
      flags={questionPanel.flags}
      onToggleFlag={questionPanel.onToggleFlag}
      tabletMode={isTabletMode}
      answerCompact={questionPanel.answerCompact}
      highlightEnabled={questionPanel.highlightEnabled}
      highlightColor={questionPanel.highlightColor}
      registerLiveAnswer={questionPanel.registerLiveAnswer}
      questionContainerRef={questionPanel.questionContainerRef}
      contentZoomStyle={questionPanel.contentZoomStyle}
      panelTestId={questionPanel.panelTestId}
      getBlockStartQuestionNumber={questionPanel.getBlockStartQuestionNumber}
      renderBlockInstruction={questionPanel.renderBlockInstruction}
      expandedQuestionGapClassName={questionPanel.expandedQuestionGapClassName}
      hideDiagramReferenceForBlock={questionPanel.hideDiagramReferenceForBlock}
      hideStepper={questionPanel.hideStepper ?? isCompact}
      selectSheetPresentation={isCompact}
      shouldFocusQuestion={questionPanel.shouldFocusQuestion}
      eliminatedOptionIdsByQuestion={questionPanel.eliminatedOptionIdsByQuestion}
      onToggleOptionElimination={questionPanel.onToggleOptionElimination}
    />
  );

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {isCompact ? (
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-gray-300"
          ref={workspaceRef}
          data-testid={workspaceTestId}
        >
          <div className="student-compact-pane-tabs flex flex-shrink-0 gap-2 border-b border-gray-200 bg-gray-50 p-2">
            <button
              type="button"
              className={`${paneTabClassName} ${
                activeCompactPane === "material"
                  ? "border-blue-700 bg-blue-50 text-blue-900 active:bg-blue-100"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
              aria-pressed={activeCompactPane === "material"}
              onClick={() => selectCompactPane("material")}
            >
              Passage
            </button>
            <button
              type="button"
              className={`${paneTabClassName} ${
                activeCompactPane === "questions"
                  ? "border-blue-700 bg-blue-50 text-blue-900 active:bg-blue-100"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
              aria-pressed={activeCompactPane === "questions"}
              onClick={() => selectCompactPane("questions")}
            >
              Questions
            </button>
          </div>
          {/* P2.3: both panes stay mounted across tab switches. The hidden
              pane is removed from interaction and assistive navigation via
              the hidden attribute + inert, while its React state (textarea,
              selection, answer tree) remains alive. A resize alone never
              swaps pane identity or creates a new answer value. */}
          <div
            ref={materialPaneRef}
            className="min-h-0 flex-1 overflow-hidden"
            hidden={activeCompactPane !== "material"}
            inert={activeCompactPane !== "material" ? true : undefined}
            onFocusCapture={() => {
              lastFocusedPaneRef.current = "material";
            }}
          >
            {materialPane}
          </div>
          <div
            ref={questionPaneRef}
            className="min-h-0 flex-1 overflow-hidden"
            hidden={activeCompactPane !== "questions"}
            inert={activeCompactPane !== "questions" ? true : undefined}
            onFocusCapture={() => {
              lastFocusedPaneRef.current = "questions";
            }}
          >
            {questionPanelElement}
          </div>
        </div>
      ) : (
        <div
          className={`relative flex flex-1 overflow-hidden border-t border-gray-300 ${
            isTabletMode ? "flex-row" : "flex-col md:flex-row"
          }`}
          ref={workspaceRef}
          style={splitPaneStyle}
          data-testid={workspaceTestId}
        >
          <div
            className="contents"
            onFocusCapture={() => {
              lastFocusedPaneRef.current = "material";
            }}
          >
            {materialPane}
          </div>
          {splitSplittable ? (
            <StudentSplitPaneResizer
              isTabletMode={isTabletMode}
              leftWidth={leftWidth}
              minWidth={splitMinWidth}
              maxWidth={splitMaxWidth}
              onDividerPointerDown={onDividerPointerDown}
              onDividerPointerMove={onDividerPointerMove}
              onDividerPointerEnd={onDividerPointerEnd}
              onDividerKeyDown={onDividerKeyDown}
              resizeCommands={resizeCommands}
              ariaLabel={dividerAriaLabel}
              testId={dividerTestId}
            />
          ) : null}
          <div
            className="contents"
            onFocusCapture={() => {
              lastFocusedPaneRef.current = "questions";
            }}
          >
            {questionPanelElement}
          </div>
        </div>
      )}
    </div>
  );
}
