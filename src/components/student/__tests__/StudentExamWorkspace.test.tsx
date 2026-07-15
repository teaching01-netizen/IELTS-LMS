import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import type { QuestionAnswer } from '../../../types';
import { StudentExamWorkspace } from '../StudentExamWorkspace';

vi.mock('../StudentReading', () => ({
  StudentReading: () => <div data-testid="reading-module">reading</div>,
}));

vi.mock('../StudentListening', () => ({
  StudentListening: () => <div data-testid="listening-module">listening</div>,
}));

vi.mock('../StudentWriting', () => ({
  StudentWriting: ({
    highlightEnabled,
    highlightColor,
    highlightClassName,
  }: {
    highlightEnabled?: boolean;
    highlightColor?: string;
    highlightClassName?: string;
  }) => (
    <div
      data-testid="writing-module"
      data-highlight-enabled={String(highlightEnabled)}
      data-highlight-color={highlightColor}
      data-highlight-class-name={highlightClassName}
    >
      writing
    </div>
  ),
}));

vi.mock('../StudentSpeaking', () => ({
  StudentSpeaking: () => <div data-testid="speaking-module">speaking</div>,
}));

vi.mock('../StudentFooter', () => ({
  StudentFooter: ({ onSubmit }: { onSubmit: () => void }) => (
    <button type="button" data-testid="workspace-footer-submit" onClick={onSubmit}>
      footer submit
    </button>
  ),
}));

vi.mock('../QuestionNavigator', () => ({
  QuestionNavigator: ({ onNavigate, onClose }: { onNavigate: (id: string) => void; onClose: () => void }) => (
    <div data-testid="workspace-navigator">
      <button type="button" data-testid="workspace-nav-go" onClick={() => onNavigate('q2')}>
        go
      </button>
      <button type="button" data-testid="workspace-nav-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

function createExamState(): ExamState {
  return {
    title: 'Mock Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: {
      type: 'Academic',
      delivery: {
        launchMode: 'proctor_start',
        transitionMode: 'auto_with_proctor_override',
        allowedExtensionMinutes: [5],
      },
      sections: {
        listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        writing: { enabled: true, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        speaking: { enabled: true, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
      },
    },
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: '', task2Prompt: '' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  } as ExamState;
}

function renderWorkspace(module: 'reading' | 'listening' | 'writing' | 'speaking') {
  const onNavigate = vi.fn();
  const onSubmit = vi.fn();
  const onCloseNavigator = vi.fn();

  render(
    <StudentExamWorkspace
      currentModule={module}
      examState={createExamState()}
      currentQuestionId="q1"
      allQuestions={[{ id: 'q1' } as StudentQuestionDescriptor]}
      answers={{} as Record<string, QuestionAnswer>}
      writingAnswers={{}}
      flags={{}}
      tabletMode={false}
      showSubmitControls
      contentZoom={1}
      displayTimeRemaining={120}
      highlightEnabled={false}
      highlightColor="yellow"
      highlightClassName=""
      passageReadabilityLabel="Comfort"
      canIncreasePassageReadability
      canDecreasePassageReadability
      showNavigator
      onNavigate={onNavigate}
      onObjectiveAnswerChange={vi.fn()}
      onFlagToggle={vi.fn()}
      onWritingChange={vi.fn()}
      onModuleSubmit={onSubmit}
      onRegisterWritingDraftCommit={vi.fn()}
      onRegisterLiveObjectiveAnswer={vi.fn()}
      onRegisterLiveWritingAnswer={vi.fn()}
      onIncreasePassageReadability={vi.fn()}
      onDecreasePassageReadability={vi.fn()}
      onResetPassageReadability={vi.fn()}
      onCloseNavigator={onCloseNavigator}
      security={createExamState().config.security ?? {
        tabSwitchRule: 'warn',
        detectSecondaryScreen: false,
        blockClipboard: false,
        antiScreenshotGuardEnabled: false,
        preventAutofill: false,
        preventAutocorrect: false,
        preventTranslation: false,
      }}
    />,
  );

  return { onNavigate, onSubmit, onCloseNavigator };
}

describe('StudentExamWorkspace', () => {
  it('renders reading module with footer and navigator controls', () => {
    const { onNavigate, onSubmit, onCloseNavigator } = renderWorkspace('reading');

    expect(screen.getByTestId('reading-module')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-footer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-navigator')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workspace-nav-go'));
    expect(onNavigate).toHaveBeenCalledWith('q2');
    expect(onCloseNavigator).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('workspace-footer-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders writing module without footer', () => {
    renderWorkspace('writing');

    expect(screen.getByTestId('writing-module')).toHaveAttribute('data-highlight-enabled', 'false');
    expect(screen.getByTestId('writing-module')).toHaveAttribute('data-highlight-color', 'yellow');
    expect(screen.getByTestId('writing-module')).toHaveAttribute('data-highlight-class-name', '');
    expect(screen.queryByTestId('workspace-footer-submit')).not.toBeInTheDocument();
  });
});
