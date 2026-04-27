import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagramLabelingBlock, ExamState, MultiMCQBlock, SentenceCompletionBlock } from '../../../types';
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

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2-4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
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

  it('renders diagram-labeling answers directly on the diagram without label helper text', () => {
    const onChange = vi.fn();
    const block: DiagramLabelingBlock = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '/diagram.jpg',
      labels: [
        { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
        { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={12}
        answer={['existing', '']}
        onChange={onChange}
        slotIds={['diagram-1:label-a', 'diagram-1:label-b']}
        currentQuestionId="diagram-1:label-a"
      />,
    );

    expect(screen.getByAltText('Diagram reference')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toHaveValue('existing');
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
    expect(screen.queryByText(/label 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/label 2/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 13' }), {
      target: { value: 'wheel' },
    });

    expect(onChange).toHaveBeenCalledWith(['existing', 'wheel']);
  });

  it('keeps diagram-labeling fallback fields free of label helper text', () => {
    const block: DiagramLabelingBlock = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '',
      labels: [
        { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
        { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={12}
        answer={['', '']}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/add a diagram/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
    expect(screen.queryByText(/label 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/label 2/i)).not.toBeInTheDocument();
  });

  it('renders uploaded reading pictures in a sticky wrapper on desktop', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
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
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read the diagram.',
            images: [
              {
                id: 'img-1',
                src: '/uploaded-picture.jpg',
                alt: 'Uploaded diagram',
                annotations: [],
                crop: { x: 0, y: 0, width: 100, height: 100 },
                height: 600,
                width: 800,
                zoom: 1,
              },
            ],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer.',
                questions: [{ id: 'q1', prompt: 'What is shown?', correctAnswer: 'diagram', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const image = screen.getByAltText('Uploaded diagram');
    const stickyWrapper = image.closest('.lg\\:sticky');
    expect(stickyWrapper).not.toBeNull();
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

  it('wires zoom controls and opens the highlight palette from the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    const onHighlightModeToggle = vi.fn();
    const onHighlightColorChange = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        zoom={1.25}
        highlightEnabled={false}
        highlightColor="yellow"
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onHighlightModeToggle={onHighlightModeToggle}
        onHighlightColorChange={onHighlightColorChange}
      />,
    );

    expect(screen.getByTestId('zoom-controls')).toHaveClass('w-[11.5rem]');
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('125%');
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }));
    fireEvent.click(screen.getByRole('button', { name: /open highlight options/i }));
    expect(screen.getByRole('dialog', { name: /highlight options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select amber highlight color/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
    expect(onHighlightModeToggle).toHaveBeenCalledTimes(1);
    expect(onHighlightColorChange).toHaveBeenCalledWith('amber');
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
  });

  it('renders separate tablet zoom and highlight controls in the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    const onHighlightModeToggle = vi.fn();
    const onHighlightColorChange = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        tabletMode
        zoom={1.1}
        highlightEnabled={false}
        highlightColor="yellow"
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onHighlightModeToggle={onHighlightModeToggle}
        onHighlightColorChange={onHighlightColorChange}
      />,
    );

    expect(screen.queryByRole('button', { name: /open tablet controls/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('zoom-controls')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open zoom controls/i })).toHaveTextContent('Zoom');
    expect(screen.getByRole('button', { name: /open highlight options/i })).toHaveTextContent('Highlight');

    fireEvent.click(screen.getByRole('button', { name: /open zoom controls/i }));

    const zoomPanel = screen.getByRole('dialog', { name: /zoom controls/i });
    expect(within(zoomPanel).getByTestId('zoom-controls')).toBeInTheDocument();

    fireEvent.click(within(zoomPanel).getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /open highlight options/i }));
    const highlightPanel = screen.getByRole('dialog', { name: /highlight options/i });
    expect(within(highlightPanel).queryByTestId('zoom-controls')).not.toBeInTheDocument();
    fireEvent.click(within(highlightPanel).getByRole('button', { name: /select amber highlight color/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onHighlightColorChange).toHaveBeenCalledWith('amber');
    expect(onHighlightModeToggle).toHaveBeenCalledTimes(1);
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomReset).not.toHaveBeenCalled();
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

  it('moves the listening flag control into reserved inline space in tablet mode', () => {
    const onToggleFlag = vi.fn();

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
        flags={{ q1: true }}
        onToggleFlag={onToggleFlag}
        tabletMode
      />,
    );

    const flagButton = screen.getByRole('button', { name: /unflag question/i });
    expect(flagButton).toHaveClass('inline-flex');
    expect(flagButton).not.toHaveClass('absolute');

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
