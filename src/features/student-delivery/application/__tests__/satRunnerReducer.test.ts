import { describe, expect, it } from 'vitest';
import { createSatRunnerState, satRunnerReducer } from '../satRunnerReducer';

function startedMath() {
  const directions = satRunnerReducer(createSatRunnerState('schedule-1', 'candidate-1'), {
    type: 'bootstrapLoaded',
    assessmentId: 'assessment-1',
  });
  return satRunnerReducer(directions, {
    type: 'moduleStarted',
    sectionKey: 'math',
    moduleKey: 'math-m1',
    questionIds: ['q1', 'q2'],
    startedAt: '2026-08-28T01:00:00Z',
    endsAt: '2026-08-28T01:35:00Z',
    toolCapabilities: { calculator: true, referenceSheet: true },
  });
}

describe('satRunnerReducer', () => {
  it('keeps capabilities separate from active tool state', () => {
    const module = startedMath();
    expect(module).toMatchObject({
      phase: 'module',
      toolCapabilities: { calculator: true, referenceSheet: true },
      activeTool: null,
    });

    const calculator = satRunnerReducer(module, { type: 'toggleTool', tool: 'calculator' });
    const reference = satRunnerReducer(calculator, { type: 'toggleTool', tool: 'reference_sheet' });
    expect(calculator.phase === 'module' ? calculator.activeTool : undefined).toBe('calculator');
    expect(reference.phase === 'module' ? reference.activeTool : undefined).toBe('reference_sheet');
  });

  it('updates answer, review, elimination, and annotations in one response aggregate', () => {
    const module = startedMath();
    const answered = satRunnerReducer(module, { type: 'setAnswer', questionId: 'q1', value: 'B' });
    const reviewed = satRunnerReducer(answered, { type: 'setReviewFlag', questionId: 'q1', flagged: true });
    const eliminated = satRunnerReducer(reviewed, { type: 'toggleEliminatedOption', questionId: 'q1', optionId: 'A' });
    const annotated = satRunnerReducer(eliminated, { type: 'setAnnotations', questionId: 'q1', annotations: { version: 1, note: 'Check this step' } });

    expect(annotated.phase === 'module' ? annotated.responses.q1 : undefined).toEqual({
      questionId: 'q1',
      answer: 'B',
      markedForReview: true,
      eliminatedOptionIds: ['A'],
      annotations: { version: 1, note: 'Check this step' },
    });
  });

  it('closes tools on review and returns without losing response or position', () => {
    const module = startedMath();
    const positioned = satRunnerReducer(module, { type: 'selectQuestion', questionIndex: 1 });
    const answered = satRunnerReducer(positioned, { type: 'setAnswer', questionId: 'q2', value: '42' });
    const withTool = satRunnerReducer(answered, { type: 'toggleTool', tool: 'calculator' });
    const review = satRunnerReducer(withTool, { type: 'reviewModule' });
    const returned = satRunnerReducer(review, { type: 'returnToModule' });

    expect(review.phase === 'review' ? review.activeTool : 'not-review').toBeNull();
    expect(returned).toMatchObject({
      phase: 'module',
      questionIndex: 1,
      responses: { q2: { answer: '42' } },
      toolCapabilities: { calculator: true, referenceSheet: true },
    });
  });

  it('moves through break and completion while preserving server-driven phase boundaries', () => {
    const review = satRunnerReducer(startedMath(), { type: 'reviewModule' });
    const breakState = satRunnerReducer(review, {
      type: 'startBreak',
      nextSectionKey: 'reading-writing',
      resumeAt: '2026-08-28T01:42:00Z',
    });
    const next = satRunnerReducer(breakState, {
      type: 'routeToModule',
      sectionKey: 'reading-writing',
      moduleKey: 'rw-m1',
      questionIds: ['r1'],
      startedAt: '2026-08-28T01:42:00Z',
      endsAt: '2026-08-28T02:14:00Z',
    });
    const nextReview = satRunnerReducer(next, { type: 'reviewModule' });
    const submitting = satRunnerReducer(nextReview, { type: 'submit' });
    const complete = satRunnerReducer(submitting, { type: 'completed', resultId: 'result-1' });

    expect(breakState).toMatchObject({ phase: 'break', nextSectionKey: 'reading-writing' });
    expect(next).toMatchObject({ phase: 'module', moduleKey: 'rw-m1', activeTool: null });
    expect(complete).toMatchObject({ phase: 'complete', resultId: 'result-1' });
  });
});
