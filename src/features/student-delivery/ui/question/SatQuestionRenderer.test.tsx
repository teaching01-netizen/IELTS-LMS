import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeliveredQuestion } from '../../contracts/assessmentDelivery';
import { createSatTextAnnotation, emptySatQuestionResponse, type SatQuestionResponseDraft } from '../../domain/satResponses';
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

describe('annotation editor cleanup on erase', () => {
  it('closes the note editor when its annotation disappears from props', async () => {
    const noted = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:same-id', startOffset: 0, endOffset: 7, exact: 'A tree ', note: 'Check the evidence' });
    const seeded = (): SatQuestionResponseDraft => ({ ...emptySatQuestionResponse('q1'), annotations: { version: 2, annotations: [noted], legacyQuestionNote: '' } });
    const view = (response: SatQuestionResponseDraft) => (
      <SatQuestionRenderer sectionKey="reading-writing" questionNumber={1} question={question} response={response}
        eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
        onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />
    );
    const { rerender, unmount } = render(view(seeded()));
    fireEvent.click(screen.getByRole('button', { name: 'Edit note: A tree' }));
    expect(screen.getByRole('textbox', { name: 'Note for selected text' })).toBeInTheDocument();
    rerender(view({ ...seeded(), annotations: { version: 2, annotations: [], legacyQuestionNote: '' } }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Note for selected text' })).not.toBeInTheDocument());
    unmount();
  });
});
