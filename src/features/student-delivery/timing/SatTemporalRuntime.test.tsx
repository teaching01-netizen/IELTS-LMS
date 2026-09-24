import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeliveredQuestion } from '../contracts/assessmentDelivery';
import { createSatReadingPreferences } from '../domain/satReadingPreferences';
import { emptySatQuestionResponse } from '../domain/satResponses';
import { SatExamShell } from '../ui/SatExamShell';
import { SatQuestionRenderer } from '../ui/question/SatQuestionRenderer';
import { SatTemporalRuntime } from './SatTemporalRuntime';
import type { SatTemporalModel } from './satTemporalModel';

afterEach(() => vi.useRealTimers());

it('advances the SAT timer for ten idle seconds without rendering or replacing the question', async () => {
  vi.useFakeTimers();
  const startedAt = new Date('2026-01-01T00:00:00.000Z');
  vi.setSystemTime(startedAt);
  const readingPreferences = createSatReadingPreferences();
  const text = (value: string) => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id: value, text: value }] });
  const question: DeliveredQuestion = {
    examQuestionId: 'q1', questionId: 'q1', displayOrder: 0, isPretest: false,
    questionType: 'single_choice', stimulus: text('Passage'), prompt: text('Question prompt'),
    answer: { kind: 'single_choice', options: [{ id: 'A', content: text('Answer A') }] },
    metadata: { sectionKey: 'math', domain: null, skill: null, difficulty: 'medium', tags: [] },
    accessibility: { longDescription: null },
  };
  const model: SatTemporalModel = {
    data: null,
    effectiveTiming: {
      authority: 'legacy_attempt', timingModel: 'legacy_section_v1', stageKey: null,
      stageStatus: null, serverNow: startedAt.toISOString(), deadlineAt: null,
      remainingSeconds: 0, runtimeRevision: 1,
    },
    snapshotReceivedAt: startedAt.getTime(),
    effectiveTimingReceivedAt: startedAt.getTime(),
    stateModuleAttempt: {
      id: 'module-attempt-1', moduleId: 'module-1', state: 'active', allocatedSeconds: 20,
      availableAt: null, startedAt: startedAt.toISOString(), pausedAt: null,
      accumulatedPausedSeconds: 0, extensionSeconds: 0,
      deadlineAt: new Date(startedAt.getTime() + 20_000).toISOString(),
      remainingSeconds: 20, completionReason: null, rawCorrect: null,
      operationalQuestionCount: null, toolState: {}, revision: 1,
    },
    stateSectionKey: 'math', pendingAttempt: undefined, pendingSectionKey: null,
  };
  let questionRenders = 0;
  function QuestionProbe() {
    questionRenders += 1;
    return (
      <SatQuestionRenderer
        sectionKey="math" questionNumber={1} question={question}
        response={emptySatQuestionResponse('q1')} eliminationMode={false} disabled={false}
        readingPreferences={readingPreferences} onReadingSplitRatioChange={vi.fn()}
        onAnswerChange={vi.fn()} onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()}
      />
    );
  }
  render(
    <SatTemporalRuntime model={model}>
      <SatExamShell
        sectionLabel="Math" sectionKey="math" directions={null}
        remainingLabel="0:20" remainingSeconds={20} candidateName="Ada"
        questionIndex={0} questionCount={1}
        navigationItems={[{ id: 'q1', index: 0, number: 1, status: 'unanswered', current: true, markedForReview: false }]}
        calculatorAvailable={false} calculatorOpen={false} referenceAvailable={false}
        referenceOpen={false} blocked={false} saveState="idle" questionNote=""
        readingPreferences={readingPreferences}
        onSelectQuestion={vi.fn()} onToggleCalculator={vi.fn()} onToggleReference={vi.fn()}
        onPrevious={vi.fn()} onNext={vi.fn()} onReviewModule={vi.fn()}
        onSaveNote={vi.fn()} onReadingPreferencesChange={vi.fn()}
      >
        <QuestionProbe />
      </SatExamShell>
    </SatTemporalRuntime>,
  );
  const answerNode = screen.getByText('Answer A');
  const settledRenders = questionRenders;
  expect(screen.getByRole('timer')).toHaveTextContent('0:20');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(screen.getByRole('timer')).toHaveTextContent('0:10');
  expect(questionRenders).toBe(settledRenders);
  expect(screen.getByText('Answer A')).toBe(answerNode);
});
