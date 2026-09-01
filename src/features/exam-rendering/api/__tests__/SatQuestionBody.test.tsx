import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DeliveredQuestion } from '../assessmentContracts';
import { SatQuestionBody } from '../SatQuestionBody';

const question: DeliveredQuestion = {
  examQuestionId: 'q1',
  questionId: 'question-1',
  displayOrder: 0,
  isPretest: false,
  questionType: 'single_choice',
  stimulus: {
    version: 1,
    nodes: [{ type: 'paragraph', id: 'stimulus-p', text: 'A short passage.' }],
  },
  prompt: {
    version: 1,
    nodes: [{ type: 'paragraph', id: 'prompt-p', text: 'What is the answer?' }],
  },
  answer: {
    kind: 'single_choice',
    options: [
      { id: 'A', content: { version: 1, nodes: [{ type: 'paragraph', id: 'a', text: 'First' }] } },
    ],
  },
  metadata: {
    sectionKey: 'reading-writing',
    domain: null,
    skill: null,
    difficulty: 'medium',
    tags: [],
  },
  accessibility: { longDescription: null },
};

describe('SatQuestionBody', () => {
  it('renders the exam-visible stimulus and prompt around a read-only answer slot', () => {
    render(
      <SatQuestionBody question={question} sectionKey="reading-writing" stimulusPlacement="inline">
        <div data-testid="static-answer">First</div>
      </SatQuestionBody>
    );

    expect(screen.getByLabelText('Stimulus')).toHaveTextContent('A short passage.');
    expect(screen.getByLabelText('Question')).toHaveTextContent('What is the answer?');
    expect(screen.getByTestId('static-answer')).toHaveTextContent('First');
    expect(screen.getByLabelText('Question').querySelector('input, button, [contenteditable="true"]')).toBeNull();
  });
});
