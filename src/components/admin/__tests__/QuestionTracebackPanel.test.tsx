import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInitialExamState } from '../../../services/examAdapterService';
import { QuestionTracebackPanel } from '../QuestionTracebackPanel';
import * as gradingReviewUtils from '../gradingReviewUtils';

vi.mock('../gradingReviewUtils', async () => {
  const actual = await vi.importActual<typeof import('../gradingReviewUtils')>('../gradingReviewUtils');
  return {
    ...actual,
    buildQuestionTracebackGroups: vi.fn(actual.buildQuestionTracebackGroups),
  };
});

const mockedBuildQuestionTracebackGroups = vi.mocked(gradingReviewUtils.buildQuestionTracebackGroups);

afterEach(() => {
  mockedBuildQuestionTracebackGroups.mockClear();
});

describe('QuestionTracebackPanel', () => {
  test('lets a grader choose a persisted correctness override for an answer row', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the question.',
            questions: [{ id: 'q-1', prompt: 'What is it?', correctAnswer: 'Answer', answerRule: 'ONE_WORD' }],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];
    const onOverride = vi.fn().mockResolvedValue(undefined);

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={examState}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: { type: 'reading', answers: { 'q-1': 'Answer' } },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
        onOverride={onOverride}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark incorrect' }));

    expect(onOverride).toHaveBeenCalledWith('q-1', false);
  });

  test('renders grouped objective answers from the exam snapshot', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the question.',
            questions: [
              {
                id: 'q-1',
                prompt: 'What is it?',
                correctAnswer: 'Answer',
                answerRule: 'ONE_WORD',
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={examState}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: {
            type: 'reading',
            answers: {
              'q-1': 'Answer',
            },
          },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.getByText(/Traceback View/i)).toBeInTheDocument();
    expect(screen.getByText('Passage 1')).toBeInTheDocument();
    expect(screen.getByText('What is it?')).toBeInTheDocument();
    expect(screen.getAllByText('Answer')).toHaveLength(2);
    expect(screen.getByText('Correct answer')).toBeInTheDocument();
  });

  test('renders mapped MCQ option text in traceback student answers', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'MULTI_MCQ',
            instruction: 'Choose two',
            stem: 'Choose two',
            requiredSelections: 2,
            options: [
              { id: 'A', text: 'Alpha', isCorrect: true },
              { id: 'B', text: 'Beta', isCorrect: false },
              { id: 'C', text: 'Charlie', isCorrect: true },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={examState}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: {
            type: 'reading',
            answers: {
              'block-1': ['C', 'A'],
            },
          },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.getAllByText('Charlie, Alpha').length).toBeGreaterThan(0);
    expect(screen.queryByText('[1] C')).not.toBeInTheDocument();
  });

  test('shows numbering gap warning when canonical question numbers are non-contiguous', () => {
    mockedBuildQuestionTracebackGroups.mockReturnValueOnce([
      {
        groupId: 'g1',
        groupLabel: 'Passage 1',
        items: [
          {
            numberLabel: '21',
            rootNumberLabel: '21',
            questionId: 'q-21',
            rootId: 'q-21',
            prompt: 'Question 21',
            studentAnswer: 'A',
            correctAnswer: 'B',
            correctness: false,
            rootCorrectness: false,
            awardedScore: 0,
            maxScore: 1,
            answerKey: 'q-21',
          },
          {
            numberLabel: '33',
            rootNumberLabel: '33',
            questionId: 'q-33',
            rootId: 'q-33',
            prompt: 'Question 33',
            studentAnswer: 'C',
            correctAnswer: 'D',
            correctness: false,
            rootCorrectness: false,
            awardedScore: 0,
            maxScore: 1,
            answerKey: 'q-33',
          },
        ],
      },
    ]);

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={null}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: { type: 'reading', answers: { 'q-21': 'A', 'q-33': 'C' } },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.getByText(/Question numbering has gaps/i)).toBeInTheDocument();
    expect(screen.getByText(/22-32/)).toBeInTheDocument();
  });

  test('does not show numbering gap warning when numbering is contiguous', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the questions.',
            questions: [
              { id: 'q-1', prompt: 'Q1?', correctAnswer: 'A', answerRule: 'ONE_WORD' },
              { id: 'q-2', prompt: 'Q2?', correctAnswer: 'B', answerRule: 'ONE_WORD' },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={examState}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: { type: 'reading', answers: { 'q-1': 'A', 'q-2': 'B' } },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.queryByText(/Question numbering has gaps/i)).not.toBeInTheDocument();
  });

  test('shows unmapped answer-key warning when stored answer keys do not match traceback descriptors', () => {
    mockedBuildQuestionTracebackGroups.mockReturnValueOnce([
      {
        groupId: 'g1',
        groupLabel: 'Passage 1',
        items: [
          {
            numberLabel: '1',
            rootNumberLabel: '1',
            questionId: 'q-1',
            rootId: 'q-1',
            prompt: 'Question 1',
            studentAnswer: 'A',
            correctAnswer: 'A',
            correctness: true,
            rootCorrectness: true,
            awardedScore: 1,
            maxScore: 1,
            answerKey: 'q-1',
          },
        ],
      },
    ]);

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={null}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: { type: 'reading', answers: { 'q-1': 'A', 'orphan-key': 'X' } },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.getByText(/stored answer key\(s\) do not map/i)).toBeInTheDocument();
    expect(screen.getByText(/orphan-key/)).toBeInTheDocument();
  });

  test('shows grouped scoring rule label when provided by traceback items', () => {
    mockedBuildQuestionTracebackGroups.mockReturnValueOnce([
      {
        groupId: 'g1',
        groupLabel: 'Passage 1',
        items: [
          {
            numberLabel: '22',
            rootNumberLabel: '22',
            questionId: 'q-22:a',
            rootId: 'q-22:group:pair',
            prompt: 'Blank A',
            studentAnswer: 'sun',
            correctAnswer: 'sun',
            correctness: true,
            rootCorrectness: true,
            awardedScore: 1,
            maxScore: 1,
            answerKey: 'q-22',
            rootRuleLabel: 'Scoring: 2 answers required for 1 point',
          },
          {
            numberLabel: '22',
            rootNumberLabel: '22',
            questionId: 'q-22:b',
            rootId: 'q-22:group:pair',
            prompt: 'Blank B',
            studentAnswer: 'moon',
            correctAnswer: 'moon',
            correctness: true,
            rootCorrectness: true,
            awardedScore: 1,
            maxScore: 1,
            answerKey: 'q-22',
            rootRuleLabel: 'Scoring: 2 answers required for 1 point',
          },
        ],
      },
    ]);

    render(
      <QuestionTracebackPanel
        section="reading"
        examState={null}
        sectionSubmission={{
          id: 'sec-1',
          submissionId: 'sub-1',
          section: 'reading',
          answers: { type: 'reading', answers: { 'q-22': ['sun', 'moon'] } },
          autoGradingResults: undefined,
          gradingStatus: 'auto_graded',
          reviewedBy: undefined,
          reviewedAt: undefined,
          finalizedBy: undefined,
          finalizedAt: undefined,
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as any}
        examLoading={false}
        examError={null}
      />,
    );

    expect(screen.getByText(/2 answers required for 1 point/i)).toBeInTheDocument();
  });
});
