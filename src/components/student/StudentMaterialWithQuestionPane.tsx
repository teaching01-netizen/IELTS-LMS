import React from 'react';
import type { QuestionAnswer } from '../../types';
import type { StudentQuestionDescriptor } from '@services/examAdapterService';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentHighlightColor } from './highlightPalette';
import { StudentQuestionPanel } from './StudentQuestionPanel';
import { StudentSplitPaneResizer } from './StudentSplitPaneResizer';

interface StudentMaterialWithQuestionPaneProps {
  isTabletMode: boolean;
  workspaceRef: React.RefObject<HTMLDivElement>;
  splitPaneStyle: React.CSSProperties | undefined;
  leftWidth: number;
  onDividerPointerDown: ((event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void);
  onDividerKeyDown: ((event: React.KeyboardEvent<HTMLDivElement>) => void);
  workspaceTestId: string;
  dividerAriaLabel: string;
  dividerTestId: string;
  materialPane: React.ReactNode;
  questionPanel: {
    blocks: any[];
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
    onToggleFlag?: (id: string) => void;
    answerCompact: boolean;
    highlightEnabled: boolean;
    highlightColor: StudentHighlightColor | undefined;
    registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
    questionContainerRef: React.RefObject<HTMLDivElement>;
    contentZoomStyle: React.CSSProperties | undefined;
    panelTestId: string;
    getBlockStartQuestionNumber: (blockId: string) => number;
    renderBlockInstruction: (instruction: string, blockId: string) => React.ReactNode;
    expandedQuestionGapClassName?: string | undefined;
    hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
  };
}

export function StudentMaterialWithQuestionPane({
  isTabletMode,
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
  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div
        className={`relative flex flex-1 overflow-hidden border-t border-gray-300 ${
          isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
        }`}
        ref={workspaceRef}
        style={splitPaneStyle}
        data-testid={workspaceTestId}
      >
        {materialPane}

        <StudentSplitPaneResizer
          isTabletMode={isTabletMode}
          leftWidth={leftWidth}
          onDividerPointerDown={onDividerPointerDown}
          onDividerKeyDown={onDividerKeyDown}
          ariaLabel={dividerAriaLabel}
          testId={dividerTestId}
        />

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
      </div>
    </div>
  );
}
