import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssessmentValidationIssue, QuestionRevision } from '../../contracts/assessment';
import { QuestionInspectorPane } from '../QuestionInspectorPane';

const content = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: 'paragraph' as const, id, text }],
});

const question: QuestionRevision = {
  id: 'revision-1',
  questionId: 'question-1',
  semanticRevision: 1,
  revision: 1,
  state: 'draft',
  questionType: 'single_choice',
  stimulus: content('stimulus', 'A short passage.'),
  prompt: content('prompt', 'What is the answer?'),
  answer: {
    kind: 'single_choice',
    options: [
      { id: 'A', content: content('a', 'First') },
      { id: 'B', content: content('b', 'Second') },
      { id: 'C', content: content('c', 'Third') },
      { id: 'D', content: content('d', 'Fourth') },
    ],
    correctOptionId: 'B',
  },
  rationale: content('rationale', 'The second choice is supported.'),
  metadata: {
    sectionKey: 'reading-writing',
    domain: null,
    skill: null,
    difficulty: 'medium',
    tags: [],
  },
  accessibility: { longDescription: null },
};

const blockingIssue: AssessmentValidationIssue = {
  code: 'sat.answer.required',
  path: 'examQuestion:question-1:answer',
  message: 'Answer key missing',
  blocking: true,
  examQuestionId: 'question-1',
  field: 'answer',
};

describe('QuestionInspectorPane', () => {
  it('renders content, answer key, and validation sections for the active question', () => {
    render(
      <QuestionInspectorPane
        question={question}
        issues={[]}
        activeSection="content"
        onSectionChange={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('complementary', { name: /question inspector/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Answer key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validation' })).toBeInTheDocument();
  });

  it('shows blocking issues with text and a status summary', () => {
    render(
      <QuestionInspectorPane
        question={question}
        issues={[blockingIssue]}
        activeSection="validation"
        onSectionChange={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Needs attention');
    expect(screen.getByText('Answer key missing')).toBeInTheDocument();
  });
});
