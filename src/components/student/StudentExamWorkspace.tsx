import React from 'react';
import type { ExamState, ModuleType, QuestionAnswer } from '../../types';
import type { StudentQuestionDescriptor } from '@student/application/studentExamContentFacade';
import { QuestionNavigator } from './QuestionNavigator';
import { WritingTaskNavigator } from './WritingTaskNavigator';
import { StudentFooter } from './StudentFooter';
import { StudentListening } from './StudentListening';
import { StudentReading } from './StudentReading';
import { StudentSpeaking } from './StudentSpeaking';
import { StudentWriting } from './StudentWriting';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentLayoutMode } from './layout/studentLayoutMode';

export interface StudentExamWorkspaceProps {
  currentModule: ModuleType;
  examState: ExamState;
  currentQuestionId: string | null;
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  writingAnswers: Record<string, string>;
  flags: Record<string, boolean>;
  tabletMode: boolean;
  layoutMode?: StudentLayoutMode | undefined;
  showSubmitControls: boolean;
  contentZoom: number;
  displayTimeRemaining?: number | undefined
  highlightEnabled: boolean;
  highlightColor: StudentHighlightColor;
  highlightClassName?: string;
  passageReadabilityLabel: string;
  canIncreasePassageReadability: boolean;
  canDecreasePassageReadability: boolean;
  showNavigator: boolean;
  security: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  };
  onNavigate: (id: string) => void;
  onObjectiveAnswerChange: (
    questionId: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  onFlagToggle: (id: string) => void;
  onWritingChange: (taskId: string, text: string) => void;
  onModuleSubmit: () => void;
  onRegisterWritingDraftCommit: (commitDraft: (() => void) | null) => void;
  onRegisterLiveObjectiveAnswer: (questionId: string, value: QuestionAnswer) => void;
  onRegisterLiveWritingAnswer: (taskId: string, text: string) => void;
  onIncreasePassageReadability: () => void;
  onDecreasePassageReadability: () => void;
  onResetPassageReadability: () => void;
  onCloseNavigator: () => void;
  onOpenNavigator?: (() => void) | undefined;
}

export function StudentExamWorkspace({
  currentModule,
  examState,
  currentQuestionId,
  allQuestions,
  answers,
  writingAnswers,
  flags,
  tabletMode,
  layoutMode = 'wide',
  showSubmitControls,
  contentZoom,
  displayTimeRemaining,
  highlightEnabled,
  highlightColor,
  highlightClassName,
  passageReadabilityLabel,
  canIncreasePassageReadability,
  canDecreasePassageReadability,
  showNavigator,
  security,
  onNavigate,
  onObjectiveAnswerChange,
  onFlagToggle,
  onWritingChange,
  onModuleSubmit,
  onRegisterWritingDraftCommit,
  onRegisterLiveObjectiveAnswer,
  onRegisterLiveWritingAnswer,
  onIncreasePassageReadability,
  onDecreasePassageReadability,
  onResetPassageReadability,
  onCloseNavigator,
  onOpenNavigator,
}: StudentExamWorkspaceProps) {
  return (
    <>
      <main
        id="main-content"
        className="student-exam-main flex-1 overflow-hidden relative flex flex-col"
        role="main"
      >
        {currentModule === 'reading' ? (
          <StudentReading
            state={examState}
            answers={answers}
            onAnswerChange={onObjectiveAnswerChange}
            currentQuestionId={currentQuestionId}
            onNavigate={onNavigate}
            flags={flags}
            onToggleFlag={onFlagToggle}
            tabletMode={tabletMode}
            layoutMode={layoutMode}
            contentZoom={contentZoom}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
            onIncreasePassageReadability={onIncreasePassageReadability}
            onDecreasePassageReadability={onDecreasePassageReadability}
            onResetPassageReadability={onResetPassageReadability}
            passageReadabilityLabel={passageReadabilityLabel}
            canIncreasePassageReadability={canIncreasePassageReadability}
            canDecreasePassageReadability={canDecreasePassageReadability}
            registerLiveAnswer={onRegisterLiveObjectiveAnswer}
          />
        ) : null}

        {currentModule === 'listening' ? (
          <StudentListening
            state={examState}
            answers={answers}
            onAnswerChange={onObjectiveAnswerChange}
            currentQuestionId={currentQuestionId}
            onNavigate={onNavigate}
            flags={flags}
            onToggleFlag={onFlagToggle}
            tabletMode={tabletMode}
            layoutMode={layoutMode}
            contentZoom={contentZoom}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
            onIncreasePassageReadability={onIncreasePassageReadability}
            onDecreasePassageReadability={onDecreasePassageReadability}
            onResetPassageReadability={onResetPassageReadability}
            passageReadabilityLabel={passageReadabilityLabel}
            canIncreasePassageReadability={canIncreasePassageReadability}
            canDecreasePassageReadability={canDecreasePassageReadability}
            registerLiveAnswer={onRegisterLiveObjectiveAnswer}
          />
        ) : null}

        {currentModule === 'writing' ? (
          <StudentWriting
            state={examState}
            writingAnswers={writingAnswers}
            onWritingChange={onWritingChange}
            onSubmit={onModuleSubmit}
            currentQuestionId={currentQuestionId}
            onNavigate={onNavigate}
            timeRemaining={displayTimeRemaining}
            registerDraftCommit={onRegisterWritingDraftCommit}
            security={security}
            showSubmitButton={showSubmitControls}
            tabletMode={tabletMode}
            layoutMode={layoutMode}
            registerLiveWritingAnswer={onRegisterLiveWritingAnswer}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
          />
        ) : null}

        {currentModule === 'speaking' ? (
          <StudentSpeaking
            state={examState}
            onSubmit={onModuleSubmit}
            currentQuestionId={currentQuestionId}
            onNavigate={onNavigate}
          />
        ) : null}
      </main>

      {(currentModule === 'reading' || currentModule === 'listening') ? (
        <StudentFooter
          questions={allQuestions}
          currentQuestionId={currentQuestionId}
          onNavigate={onNavigate}
          answers={answers}
          flags={flags}
          onToggleFlag={onFlagToggle}
          onSubmit={onModuleSubmit}
          showSubmitButton={showSubmitControls}
          tabletMode={tabletMode}
          layoutMode={layoutMode}
          onOpenNavigator={onOpenNavigator}
        />
      ) : null}

      {showNavigator ? (
        currentModule === 'writing' ? (
          <WritingTaskNavigator
            tasks={examState.config.sections.writing.tasks ?? []}
            writingAnswers={writingAnswers}
            currentQuestionId={currentQuestionId}
            onNavigate={(id) => {
              onNavigate(id);
              onCloseNavigator();
            }}
            onClose={onCloseNavigator}
          />
        ) : (
          <QuestionNavigator
            questions={allQuestions}
            answers={answers}
            flags={flags}
            currentQuestionId={currentQuestionId}
            onNavigate={(id) => {
              onNavigate(id);
              onCloseNavigator();
            }}
            onClose={onCloseNavigator}
          />
        )
      ) : null}
    </>
  );
}
