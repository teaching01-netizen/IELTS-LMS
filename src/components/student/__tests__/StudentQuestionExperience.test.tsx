import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState, MultiMCQBlock, SentenceCompletionBlock } from '../../../types';
import { AccessibilitySettings } from '../AccessibilitySettings';
import { QuestionNavigator } from '../QuestionNavigator';
import { QuestionRenderer } from '../QuestionRenderer';
import { StudentFooter } from '../StudentFooter';
import { StudentHeader } from '../StudentHeader';
import { StudentListening } from '../StudentListening';
import { StudentReading } from '../StudentReading';

describe('student question experience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps footer numbering aligned after a multi-slot question block', () => {
    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'q1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
          {
            id: 'multi-1',
            blockId: 'multi-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: true,
            correctCount: 3,
          },
          {
            id: 'q5',
            blockId: 'q5',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
        ]}
        currentQuestionId="q1"
        onNavigate={() => {}}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Question 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Question 2-4/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Question 5/i })).toBeInTheDocument();
  });

  it('allows jumping to another part from the footer progress pill', () => {
    const onNavigate = vi.fn();

    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'q1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
          {
            id: 'q2',
            blockId: 'q2',
            groupId: 'group-2',
            groupLabel: 'Section 2',
            isMulti: false,
            correctCount: 1,
          },
        ]}
        currentQuestionId="q1"
        onNavigate={onNavigate}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to Part 2' });
    expect(jumpButton).toHaveTextContent('0/1');
    expect(jumpButton).toHaveTextContent('Part 2');

    fireEvent.click(jumpButton);
    expect(onNavigate).toHaveBeenCalledWith('q2');
  });

  it('renders semantic checkbox inputs for multi-select questions', () => {
    const block: MultiMCQBlock = {
      id: 'multi-1',
      type: 'MULTI_MCQ',
      instruction: 'Choose two options.',
      stem: 'Pick two answers',
      requiredSelections: 2,
      options: [
        { id: 'a', text: 'Answer A', isCorrect: true },
        { id: 'b', text: 'Answer B', isCorrect: true },
        { id: 'c', text: 'Answer C', isCorrect: false },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('renders sentence completion blanks instead of an unimplemented placeholder', () => {
    const question = {
      id: 'sentence-1',
      sentence: 'The library is open ____ and ____.',
      blanks: [
        { id: 'blank-1', correctAnswer: 'daily', position: 0 },
        { id: 'blank-2', correctAnswer: 'late', position: 1 },
      ],
      answerRule: 'TWO_WORDS' as const,
    };

    const block: SentenceCompletionBlock = {
      id: 'sentence-block-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [question],
    };

    render(
      <QuestionRenderer
        question={question}
        block={block}
        number={7}
        answer={['', '']}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByText(/not yet implemented/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.queryByText(/limit:/i)).not.toBeInTheDocument();
  });

  it('opens the question navigator from the header when the control is available', () => {
    const onOpenNavigator = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        onOpenNavigator={onOpenNavigator}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open question navigator/i }));

    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
  });

  it('hides the header exit control when requested', () => {
    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        showExitButton={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /exit exam/i })).not.toBeInTheDocument();
  });

  it('shows the header exit control by default outside active exam mode', () => {
    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive={false}
      />,
    );

    expect(screen.getByRole('button', { name: /exit preview/i })).toBeInTheDocument();
  });

  it('keeps focus inside the question navigator and restores focus when it closes', () => {
    const onNavigate = vi.fn();

    function Harness() {
      const [open, setOpen] = React.useState(false);

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open navigator
          </button>
          {open ? (
            <QuestionNavigator
              questions={[
                {
                  id: 'q1',
                  blockId: 'q1',
                  groupId: 'group-1',
                  groupLabel: 'Section 1',
                  isMulti: false,
                  correctCount: 1,
                },
              ]}
              answers={{}}
              flags={{}}
              currentQuestionId="q1"
              onNavigate={onNavigate}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);

    const openButton = screen.getByRole('button', { name: /open navigator/i });
    openButton.focus();
    fireEvent.click(openButton);

    const dialog = screen.getByRole('dialog', { name: /question navigator/i });
    const closeButton = within(dialog).getByRole('button', { name: /close question navigator/i });
    const questionButton = within(dialog).getByRole('button', { name: /Question 1/i });

    expect(closeButton).toHaveFocus();

    questionButton.focus();
    fireEvent.keyDown(questionButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: 'Escape' });
    expect(openButton).toHaveFocus();
  });

  it('exposes accessibility settings state to assistive technology', () => {
    render(
      <AccessibilitySettings
        isOpen
        onClose={() => undefined}
        fontSize="large"
        highContrast
        onFontSizeChange={() => undefined}
        onHighContrastToggle={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog', { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Large' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: /high contrast mode/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('uses iPad-friendly touch targets in the footer navigator', () => {
    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'q1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
        ]}
        currentQuestionId="q1"
        onNavigate={() => {}}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Question 1/i }).getAttribute('class')).toContain('min-h-11');
    expect(screen.getByRole('button', { name: /finish/i }).getAttribute('class')).toContain('min-h-11');
  });

  it('keeps reading panes under the orientation-aware adaptive workspace and exposes a keyboard separator', () => {
    const state: ExamState = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'l1',
      config: createDefaultConfig('Academic', 'Academic'),
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'A passage.',
            images: [],
            blocks: [
              {
                id: 'q1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'Question?', correctAnswer: 'Answer' }],
              } as any,
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '', tasks: [], customPromptTemplates: [] },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId="q1"
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByTestId('reading-split-pane')).toHaveClass('student-adaptive-workspace');
    expect(screen.getByTestId('reading-split-pane').getAttribute('class')).not.toContain('lg:flex-row');
    const separator = screen.getByRole('separator', { name: /resize reading and questions panes/i });
    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  it('marks reading panes with the iPad adaptive layout contract', () => {
    const state: ExamState = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'l1',
      config: createDefaultConfig('Academic', 'Academic'),
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'A passage.',
            images: [],
            blocks: [
              {
                id: 'q1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'Question?', correctAnswer: 'Answer' }],
              } as any,
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '', tasks: [], customPromptTemplates: [] },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId="q1"
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByTestId('reading-split-pane')).toHaveClass('student-adaptive-workspace');
    expect(screen.getByTestId('reading-passage-pane')).toHaveClass('student-reading-passage-pane');
    expect(screen.getByTestId('reading-question-pane')).toHaveClass('student-reading-question-pane');
  });

  it('reserves inline space for reading flag buttons instead of overlaying questions', () => {
    const onToggleFlag = vi.fn();
    const state: ExamState = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'l1',
      config: createDefaultConfig('Academic', 'Academic'),
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'A passage.',
            images: [],
            blocks: [
              {
                id: 'q1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'Question?', correctAnswer: 'Answer' }],
              } as any,
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '', tasks: [], customPromptTemplates: [] },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId="q1"
        onNavigate={() => undefined}
        flags={{ q1: true }}
        onToggleFlag={onToggleFlag}
      />,
    );

    const question = document.getElementById('question-q1');
    expect(question).not.toBeNull();
    expect(question).toHaveClass('grid');
    expect(question).not.toHaveClass('relative');

    const flagButton = screen.getByRole('button', { name: /unflag question/i });
    expect(flagButton).not.toHaveClass('absolute');
    expect(flagButton).toHaveClass('min-h-11');
    fireEvent.click(flagButton);
    expect(onToggleFlag).toHaveBeenCalledWith('q1');
  });

  it('wires the listening transport controls to the audio element', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});

    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          reading: {
            enabled: false,
            order: 2,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          writing: {
            enabled: false,
            order: 3,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          speaking: {
            enabled: false,
            order: 4,
            duration: 15,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio as HTMLAudioElement, 'duration', {
      configurable: true,
      value: 343,
    });
    Object.defineProperty(audio as HTMLAudioElement, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /play audio/i }));
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: /pause audio/i }));
    expect(pause).toHaveBeenCalledTimes(1);

    const volume = screen.getByLabelText(/audio volume/i);
    fireEvent.change(volume, { target: { value: '35' } });
    expect((audio as HTMLAudioElement).volume).toBeCloseTo(0.35);

    const progressbar = screen.getByTestId('listening-progress-track');
    Object.defineProperty(progressbar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 8,
        right: 200,
        bottom: 8,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(progressbar, { clientX: 100 });
    expect((audio as HTMLAudioElement).currentTime).toBeCloseTo(171.5);

    (audio as HTMLAudioElement).currentTime = 120;
    fireEvent.timeUpdate(audio as HTMLAudioElement);

    const trackPanel = screen.getByText('Listening Audio Track').closest('div');
    expect(trackPanel).not.toBeNull();
    expect(within(trackPanel as HTMLElement).getByText('02:00')).toBeInTheDocument();
  });

  it('reserves inline space for listening flag buttons instead of overlaying questions', () => {
    const onToggleFlag = vi.fn();
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: createDefaultConfig('Academic', 'Academic'),
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'q1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'Question?', correctAnswer: 'Answer' }],
              } as any,
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '', tasks: [], customPromptTemplates: [] },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId="q1"
        onNavigate={() => undefined}
        flags={{}}
        onToggleFlag={onToggleFlag}
      />,
    );

    const question = document.getElementById('question-q1');
    expect(question).not.toBeNull();
    expect(question).toHaveClass('grid');
    expect(question).not.toHaveClass('relative');

    const flagButton = screen.getByRole('button', { name: /flag question/i });
    expect(flagButton).not.toHaveClass('absolute');
    expect(flagButton).toHaveClass('min-h-11');
    fireEvent.click(flagButton);
    expect(onToggleFlag).toHaveBeenCalledWith('q1');
  });

  it('disables the listening audio player when staff turns off audio playback', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
            audioPlaybackEnabled: false,
            staffInstructions: 'Use the invigilator audio system.',
          },
          reading: {
            enabled: false,
            order: 2,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          writing: {
            enabled: false,
            order: 3,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          speaking: {
            enabled: false,
            order: 4,
            duration: 15,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByText(/staff instructions/i)).toBeInTheDocument();
    expect(screen.getByText(/use the invigilator audio system/i)).toBeInTheDocument();
    expect(screen.queryByText(/listening audio track/i)).toBeNull();
  });
});
