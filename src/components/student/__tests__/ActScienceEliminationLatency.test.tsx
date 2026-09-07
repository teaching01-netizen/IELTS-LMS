import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentQuestionPanel } from '../StudentQuestionPanel';
import type { QuestionBlock } from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';

const blocks = [
  {
    id: 'sci-block-1',
    type: 'SINGLE_MCQ',
    instruction: 'Choose the answer.',
    stem: 'Block stem',
    options: [],
    questions: [
      { id: 'sci-q1', stem: 'Which conclusion follows?', options: [{ id: 'opt-a', text: 'A', isCorrect: true }, { id: 'opt-b', text: 'B', isCorrect: false }] },
    ],
  },
] as unknown as QuestionBlock[];
const block = blocks[0] as any;
const allQuestions = [
  { id: 'sci-q1', blockId: 'sci-block-1', groupId: 'stim-1', groupLabel: 'Stimulus 1', isMulti: false, correctCount: 1, answerKey: 'sci-q1', block, question: block.questions[0] },
] as unknown as StudentQuestionDescriptor[];
const stableAnswers = {};
const stableFlags = {};
const noopNav = () => {};
const noopAnswer = () => {};
const getNum = () => 1;
const renderInstr = (instruction: string) => <p>{instruction}</p>;
const panelRef = React.createRef<HTMLDivElement>();

describe('ACT science elimination latency', () => {
  it('applies Eliminate synchronously on first click (no stale memo)', () => {
    // Regression: StudentQuestionPanel's renderQuestionBlock callback omitted the
    // elimination props from its dep array, so the memoized section kept the stale
    // (empty) map and the first click appeared to do nothing until a later render.
    const Harness = () => {
      const [map, setMap] = React.useState<Record<string, readonly string[]>>({});
      return (
        <StudentQuestionPanel
          blocks={blocks}
          allQuestions={allQuestions}
          answers={stableAnswers}
          onAnswerChange={noopAnswer}
          currentQuestionId="sci-q1"
          onNavigate={noopNav}
          flags={stableFlags}
          answerCompact={false}
          highlightEnabled={false}
          questionContainerRef={panelRef}
          panelTestId="science-question-scroll"
          getBlockStartQuestionNumber={getNum}
          renderBlockInstruction={renderInstr}
          eliminatedOptionIdsByQuestion={map}
          onToggleOptionElimination={(questionId, optionId) =>
            setMap((current) => {
              const currentIds = current[questionId] ?? [];
              return { ...current, [questionId]: currentIds.includes(optionId) ? currentIds.filter((id) => id !== optionId) : [...currentIds, optionId] };
            })
          }
        />
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminate option A' }));
    expect(screen.getByRole('button', { name: 'Restore option A' })).toBeInTheDocument();
  });
});
