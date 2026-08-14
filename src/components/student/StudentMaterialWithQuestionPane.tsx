import React, { useEffect, useRef, useState } from 'react';
import type { QuestionAnswer, QuestionBlock } from '../../types';
import type { StudentQuestionDescriptor } from '@services/examAdapterService';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentLayoutMode } from './layout/studentLayoutMode';
import { StudentQuestionPanel } from './StudentQuestionPanel';
import { StudentSplitPaneResizer } from './StudentSplitPaneResizer';

interface StudentMaterialWithQuestionPaneProps {
  isTabletMode: boolean;
  layoutMode?: StudentLayoutMode | undefined;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  splitPaneStyle: React.CSSProperties | undefined;
  leftWidth: number;
  onDividerPointerDown: ((event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void);
  onDividerKeyDown: ((event: React.KeyboardEvent<HTMLDivElement>) => void);
  workspaceTestId: string;
  dividerAriaLabel: string;
  dividerTestId: string;
  materialPane: React.ReactNode;
  questionPanel: {
    blocks: QuestionBlock[];
    allQuestions: StudentQuestionDescriptor[];
    answers: Record<string, QuestionAnswer>;
    onAnswerChange: (
      questionId: string,
      answer: QuestionAnswer,
      meta?: StudentAnswerMutationMeta,
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
  };
}

type CompactPane = 'material' | 'questions';

function findScrollOwner(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[data-student-zoom-scroll]') ?? root;
}

export function StudentMaterialWithQuestionPane({
  isTabletMode,
  layoutMode = 'wide',
  workspaceRef,
  splitPaneStyle,
  leftWidth,
  onDividerPointerDown,
  onDividerKeyDown,
  workspaceTestId,
  dividerAriaLabel,
  dividerTestId,
  materialPane,
  questionPanel,
}: StudentMaterialWithQuestionPaneProps) {
  const isCompact = layoutMode === 'compact';
  const [activeCompactPane, setActiveCompactPane] = useState<CompactPane>('material');
  const lastFocusedPaneRef = useRef<CompactPane>('material');
  const previousCompactRef = useRef(isCompact);
  const materialPaneRef = useRef<HTMLDivElement>(null);
  const questionPaneRef = useRef<HTMLDivElement>(null);
  const materialScrollTopRef = useRef(0);
  const questionScrollTopRef = useRef(0);

  const saveCompactScrollPosition = () => {
    const owner = findScrollOwner(
      activeCompactPane === 'material' ? materialPaneRef.current : questionPaneRef.current,
    );
    if (activeCompactPane === 'material') {
      materialScrollTopRef.current = owner?.scrollTop ?? 0;
    } else {
      questionScrollTopRef.current = owner?.scrollTop ?? 0;
    }
  };

  const selectCompactPane = (nextPane: CompactPane) => {
    if (nextPane === activeCompactPane) {
      lastFocusedPaneRef.current = nextPane;
      return;
    }

    lastFocusedPaneRef.current = nextPane;
    saveCompactScrollPosition();
    setActiveCompactPane(nextPane);
  };

  useEffect(() => {
    if (isCompact && !previousCompactRef.current) {
      setActiveCompactPane(lastFocusedPaneRef.current);
    }
    previousCompactRef.current = isCompact;
  }, [isCompact]);

  useEffect(() => {
    if (!isCompact) {
      return;
    }

    const owner = findScrollOwner(
      activeCompactPane === 'material' ? materialPaneRef.current : questionPaneRef.current,
    );
    if (owner) {
      owner.scrollTop =
        activeCompactPane === 'material' ? materialScrollTopRef.current : questionScrollTopRef.current;
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
              className="student-touch-target flex-1 rounded-sm border border-gray-300 px-3 text-sm font-semibold text-gray-900"
              aria-pressed={activeCompactPane === 'material'}
              onClick={() => selectCompactPane('material')}
            >
              Show passage
            </button>
            <button
              type="button"
              className="student-touch-target flex-1 rounded-sm border border-gray-300 px-3 text-sm font-semibold text-gray-900"
              aria-pressed={activeCompactPane === 'questions'}
              onClick={() => selectCompactPane('questions')}
            >
              Show questions
            </button>
          </div>
          {activeCompactPane === 'material' ? (
            <div
              ref={materialPaneRef}
              className="min-h-0 flex-1 overflow-hidden"
              onFocusCapture={() => {
                lastFocusedPaneRef.current = 'material';
              }}
            >
              {materialPane}
            </div>
          ) : (
            <div
              ref={questionPaneRef}
              className="min-h-0 flex-1 overflow-hidden"
              onFocusCapture={() => {
                lastFocusedPaneRef.current = 'questions';
              }}
            >
              {questionPanelElement}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`relative flex flex-1 overflow-hidden border-t border-gray-300 ${
            isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
          }`}
          ref={workspaceRef}
          style={splitPaneStyle}
          data-testid={workspaceTestId}
        >
          <div
            className="contents"
            onFocusCapture={() => {
              lastFocusedPaneRef.current = 'material';
            }}
          >
            {materialPane}
          </div>
          <StudentSplitPaneResizer
            isTabletMode={isTabletMode}
            leftWidth={leftWidth}
            onDividerPointerDown={onDividerPointerDown}
            onDividerKeyDown={onDividerKeyDown}
            ariaLabel={dividerAriaLabel}
            testId={dividerTestId}
          />
          <div
            className="contents"
            onFocusCapture={() => {
              lastFocusedPaneRef.current = 'questions';
            }}
          >
            {questionPanelElement}
          </div>
        </div>
      )}
    </div>
  );
}
