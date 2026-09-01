import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QuestionRevision } from '../../contracts/assessment';
import { QuestionPaper } from '../QuestionPaper';

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
    ],
    correctOptionId: 'B',
  },
  rationale: content('rationale', 'Because the second choice is supported.'),
  metadata: {
    sectionKey: 'reading-writing',
    domain: null,
    skill: null,
    difficulty: 'medium',
    tags: [],
  },
  accessibility: { longDescription: null },
};

describe('QuestionPaper', () => {
  it('renders the authoring question as a read-only proof sheet', () => {
    render(<QuestionPaper question={question} />);

    const paper = screen.getByTestId('question-paper');
    expect(paper.querySelector('[data-sat-question-body]')).not.toBeNull();
    expect(paper).toHaveTextContent('A short passage.');
    expect(paper).toHaveTextContent('What is the answer?');
    expect(paper).toHaveTextContent('A');
    expect(paper).toHaveTextContent('First');
    expect(paper).toHaveTextContent('B');
    expect(paper).toHaveTextContent('Second');
    expect(paper.querySelector('input, button, [contenteditable="true"]')).toBeNull();
  });
});
