import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState, QuestionAnswer, QuestionBlock } from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { StudentWriting } from '../StudentWriting';
import { StudentQuestionPanel } from '../StudentQuestionPanel';
import {
  StudentAttemptProvider,
  useOptionalStudentAttemptControls,
  useStudentAttempt,
} from '../providers/StudentAttemptProvider';
import { StudentRuntimeProvider } from '../providers/StudentRuntimeProvider';

const questionRendererCalls = vi.hoisted(() => vi.fn());

vi.mock('../QuestionRenderer', () => ({
  QuestionRenderer: React.memo(function MockQuestionRenderer({
    answer,
    number,
  }: {
    answer: QuestionAnswer;
    number: number;
  }) {
    questionRendererCalls(number, answer);
    return <div data-testid={`mock-question-${number}`}>{String(answer ?? '')}</div>;
  }),
}));

function createWritingExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.sections.writing.tasks = [
    {
      id: 'task1',
      label: 'Task 1',
      taskType: 'task1',
      minWords: 150,
      recommendedTime: 20,
    },
    {
      id: 'task2',
      label: 'Task 2',
      taskType: 'task2',
      minWords: 250,
      recommendedTime: 40,
    },
  ];

  return {
    title: 'Typing Performance Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

function renderWriting(onWritingChange = vi.fn()) {
  render(
    <StudentWriting
      state={createWritingExamState()}
      writingAnswers={{}}
      onWritingChange={onWritingChange}
      onSubmit={() => undefined}
      currentQuestionId="task1"
      onNavigate={() => undefined}
      showSubmitButton={false}
    />,
  );

  return {
    editor: screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement,
    onWritingChange,
  };
}

function createQuestionPanelModel() {
  const blocks: QuestionBlock[] = [
    {
      id: 'q1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer q1.',
      questions: [{ id: 'q1', prompt: 'Question 1', correctAnswer: 'A' }],
      answerRule: 'ONE_WORD',
    } as QuestionBlock,
    {
      id: 'q2',
      type: 'SHORT_ANSWER',
      instruction: 'Answer q2.',
      questions: [{ id: 'q2', prompt: 'Question 2', correctAnswer: 'B' }],
      answerRule: 'ONE_WORD',
    } as QuestionBlock,
  ];
  const allQuestions: StudentQuestionDescriptor[] = [
    {
      id: 'q1',
      blockId: 'q1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      block: blocks[0],
      question: (blocks[0] as any).questions[0],
    } as StudentQuestionDescriptor,
    {
      id: 'q2',
      blockId: 'q2',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q2',
      block: blocks[1],
      question: (blocks[1] as any).questions[0],
    } as StudentQuestionDescriptor,
  ];

  return { blocks, allQuestions };
}

function renderQuestionPanel(
  answers: Record<string, QuestionAnswer>,
  model = createQuestionPanelModel(),
) {
  const onAnswerChange = vi.fn();
  const onNavigate = vi.fn();
  const renderBlockInstruction = (instruction: string) => <p>{instruction}</p>;
  const getBlockStartQuestionNumber = (blockId: string) => (blockId === 'q1' ? 1 : 2);

  const props = {
    blocks: model.blocks,
    allQuestions: model.allQuestions,
    answers,
    onAnswerChange,
    currentQuestionId: 'q1',
    onNavigate,
    flags: {},
    answerCompact: false,
    highlightEnabled: false,
    questionContainerRef: React.createRef<HTMLDivElement>(),
    panelTestId: 'question-panel',
    getBlockStartQuestionNumber,
    renderBlockInstruction,
  };

  const rendered = render(<StudentQuestionPanel {...props} />);

  return {
    ...rendered,
    props,
  };
}

describe('Student typing performance', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces writing draft commits while keeping the DOM value immediate', () => {
    vi.useFakeTimers();
    const { editor, onWritingChange } = renderWriting();

    fireEvent.change(editor, { target: { value: 'A' } });
    fireEvent.change(editor, { target: { value: 'A fast' } });
    fireEvent.change(editor, { target: { value: 'A fast draft' } });

    expect(editor.value).toBe('A fast draft');
    expect(onWritingChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onWritingChange).toHaveBeenCalledTimes(1);
    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'A fast draft');
  });

  it('still commits the latest writing DOM value immediately on pagehide', () => {
    vi.useFakeTimers();
    const { editor, onWritingChange } = renderWriting();

    fireEvent.change(editor, { target: { value: 'Latest visible draft' } });
    expect(onWritingChange).not.toHaveBeenCalled();

    fireEvent(window, new Event('pagehide'));

    expect(onWritingChange).toHaveBeenCalledTimes(1);
    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'Latest visible draft');
  });

  function createAttemptSnapshot(): StudentAttempt {
    return {
      id: 'attempt-typing-perf',
      scheduleId: 'sched-typing-perf',
      studentKey: 'student-sched-typing-perf-alice',
      examId: 'exam-typing-perf',
      examTitle: 'Typing Performance Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      submittedAt: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
        lastDisconnectAt: null,
        lastReconnectAt: null,
        lastHeartbeatAt: null,
        lastHeartbeatStatus: 'idle',
      },
      recovery: {
        lastRecoveredAt: null,
        lastLocalMutationAt: null,
        lastPersistedAt: null,
        pendingMutationCount: 0,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function AttemptActionButton() {
    const { actions } = useStudentAttempt();
    return (
      <button type="button" onClick={() => actions.persistAnswer('q1', 'A')}>
        persist answer
      </button>
    );
  }

  function ControlContextRenderProbe({ onRender }: { onRender: () => void }) {
    onRender();
    const controls = useOptionalStudentAttemptControls();
    return (
      <div data-testid="control-context">
        {controls?.getScheduleId() ?? 'missing'}
      </div>
    );
  }

  it('does not rerender answer-control consumers for unrelated attempt answer updates', () => {
    const renderProbe = vi.fn();
    const attempt = createAttemptSnapshot();
    const examState = createWritingExamState();
    examState.activeModule = 'reading';
    examState.reading = {
      passages: [
        {
          id: 'p1',
          title: 'Passage 1',
          content: 'Passage text',
          blocks: [],
        },
      ],
    };

    render(
      <StudentRuntimeProvider state={examState} onExit={() => undefined} attemptSnapshot={attempt}>
        <StudentAttemptProvider
          scheduleId={attempt.scheduleId}
          attemptSnapshot={attempt}
          persistenceEnabled={false}
        >
          <ControlContextRenderProbe onRender={renderProbe} />
          <AttemptActionButton />
        </StudentAttemptProvider>
      </StudentRuntimeProvider>,
    );

    expect(renderProbe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'persist answer' }));

    expect(renderProbe).toHaveBeenCalledTimes(1);
  });

  it('does not rerender unchanged question blocks when one answer changes', () => {
    questionRendererCalls.mockClear();
    const model = createQuestionPanelModel();
    const rendered = renderQuestionPanel({ q1: '', q2: '' }, model);
    expect(questionRendererCalls).toHaveBeenCalledTimes(2);

    questionRendererCalls.mockClear();
    rendered.rerender(
      <StudentQuestionPanel
        {...rendered.props}
        answers={{ q1: 'changed', q2: '' }}
        questionContainerRef={React.createRef<HTMLDivElement>()}
      />,
    );

    expect(questionRendererCalls).toHaveBeenCalledTimes(1);
    expect(questionRendererCalls).toHaveBeenCalledWith(1, 'changed');
  });
});
it('rerenders only the blocks whose active question changes', () => {
  const model = createQuestionPanelModel();
  const renderCounts: Record<string, number> = { q1: 0, q2: 0 };
  const renderBlockInstruction = (_instruction: string, blockId: string) => {
    renderCounts[blockId] = (renderCounts[blockId] ?? 0) + 1;
    return <p>{blockId}</p>;
  };
  const props = {
    blocks: model.blocks,
    allQuestions: model.allQuestions,
    answers: { q1: '', q2: '' },
    onAnswerChange: vi.fn(),
    currentQuestionId: 'q1',
    onNavigate: vi.fn(),
    flags: {},
    answerCompact: false,
    highlightEnabled: false,
    questionContainerRef: React.createRef<HTMLDivElement>(),
    panelTestId: 'question-panel-locality',
    getBlockStartQuestionNumber: (blockId: string) => (blockId === 'q1' ? 1 : 2),
    renderBlockInstruction,
  };
  const rendered = render(<StudentQuestionPanel {...props} />);
  expect(renderCounts).toEqual({ q1: 1, q2: 1 });

  rendered.rerender(<StudentQuestionPanel {...props} currentQuestionId="q2" />);
  expect(renderCounts).toEqual({ q1: 2, q2: 2 });
});

it('keeps unchanged blocks isolated during same-block navigation and exposes native stepper semantics', () => {
  const block = {
    id: 'shared',
    type: 'SHORT_ANSWER',
    instruction: 'Answer both questions.',
    questions: [
      { id: 'q1', prompt: 'Question one', correctAnswer: 'A' },
      { id: 'q2', prompt: 'Question two', correctAnswer: 'B' },
    ],
    answerRule: 'ONE_WORD',
  } as QuestionBlock;
  const model = {
    blocks: [block],
    allQuestions: [
      {
        id: 'q1', blockId: 'shared', groupId: 'p1', groupLabel: 'Passage 1', isMulti: false,
        correctCount: 1, answerKey: 'q1', block, question: (block as any).questions[0],
      },
      {
        id: 'q2', blockId: 'shared', groupId: 'p1', groupLabel: 'Passage 1', isMulti: false,
        correctCount: 1, answerKey: 'q2', block, question: (block as any).questions[1],
      },
    ] as StudentQuestionDescriptor[],
  };
  const renderCounts = { shared: 0 };
  const props = {
    blocks: model.blocks,
    allQuestions: model.allQuestions,
    answers: { q1: '', q2: '' },
    onAnswerChange: vi.fn(),
    currentQuestionId: 'q1',
    onNavigate: vi.fn(),
    flags: {},
    answerCompact: false,
    highlightEnabled: false,
    questionContainerRef: React.createRef<HTMLDivElement>(),
    panelTestId: 'question-panel-stepper',
    getBlockStartQuestionNumber: () => 1,
    renderBlockInstruction: (_instruction: string, blockId: string) => {
      renderCounts[blockId as 'shared'] += 1;
      return <p>{blockId}</p>;
    },
  };
  const rendered = render(<StudentQuestionPanel {...props} />);
  expect(renderCounts.shared).toBe(1);
  expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next question' })).toBeEnabled();

  rendered.rerender(<StudentQuestionPanel {...props} currentQuestionId="q2" />);
  expect(renderCounts.shared).toBe(2);
  expect(screen.getByRole('button', { name: 'Previous question' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
});
