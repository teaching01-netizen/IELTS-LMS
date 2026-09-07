import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeliveredQuestion } from '../../contracts/assessmentDelivery';
import { createSatTextAnnotation, emptySatQuestionResponse } from '../../domain/satResponses';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatQuestionRenderer } from './SatQuestionRenderer';

const text = { version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'same-id', text: 'A tree grows.' }] };
const question: DeliveredQuestion = {
  examQuestionId: 'q1', questionId: 'q1', displayOrder: 0, isPretest: false, questionType: 'single_choice',
  stimulus: text, prompt: text,
  answer: { kind: 'single_choice', options: [{ id: 'A', content: text }] },
  metadata: { sectionKey: 'reading-writing', domain: null, skill: null, difficulty: 'medium', tags: [] },
  accessibility: { longDescription: null },
};

describe('SAT annotated question rendering', () => {
  it('renders saved passage highlights without marking the identical prompt or answer text', () => {
    const response = emptySatQuestionResponse('q1');
    response.annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:same-id', startOffset: 2, endOffset: 6, exact: 'tree' })];
    const { container } = render(<SatQuestionRenderer sectionKey="reading-writing" questionNumber={1} question={question} response={response}
      eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
      onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />);
    const highlights = container.querySelectorAll('[data-sat-highlight="true"]');
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toHaveTextContent('tree');
    expect(highlights[0]?.closest('[data-sat-passage-scroll]')).not.toBeNull();
  });
});
