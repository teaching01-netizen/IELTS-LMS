import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createInitialExamState } from '../../../services/examAdapterService';
import { QuestionTracebackPanel } from '../QuestionTracebackPanel';

describe('QuestionTracebackPanel', () => {
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
});
