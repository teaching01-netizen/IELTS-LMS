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
  // Phase 04 T1: identity — candidateId is the route candidate prop, never
  // the attempt id, and survives the full lifecycle via newWorkingState.
  it('keeps candidateId trustworthy from init through the full lifecycle', () => {
    const fresh = createSatRunnerState('schedule-1', 'candidate-1');
    expect(fresh).toMatchObject({ phase: 'loading', candidateId: 'candidate-1' });
    let state = satRunnerReducer(fresh, { type: 'bootstrapLoaded', assessmentId: 'assessment-1' });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, {
      type: 'moduleStarted',
      sectionKey: 'math',
      moduleKey: 'math-m1',
      questionIds: ['q1'],
      startedAt: '2026-08-28T01:00:00Z',
      endsAt: '2026-08-28T01:35:00Z',
    });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, { type: 'reviewModule' });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, {
      type: 'startBreak',
      nextSectionKey: 'reading-writing',
      resumeAt: '2026-08-28T01:42:00Z',
    });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, {
      type: 'routeToModule',
      sectionKey: 'reading-writing',
      moduleKey: 'rw-m1',
      questionIds: ['r1'],
      startedAt: '2026-08-28T01:42:00Z',
      endsAt: '2026-08-28T02:14:00Z',
    });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, { type: 'reviewModule' });
    state = satRunnerReducer(state, { type: 'submit' });
    expect(state.candidateId).toBe('candidate-1');
    state = satRunnerReducer(state, { type: 'completed', resultId: 'result-1' });
    expect(state).toMatchObject({ phase: 'complete', candidateId: 'candidate-1' });
  });

  it('backfills activeTools from legacy activeTool on recover', () => {
    const legacy = {
      phase: 'module',
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      assessmentId: 'assessment-1',
      sectionKey: 'math',
      moduleKey: 'math-m1',
      questionIds: ['q1'],
      questionIndex: 0,
      responses: {},
      responseRevisions: {},
      toolCapabilities: { calculator: true, referenceSheet: true },
      activeTool: 'calculator',
      startedAt: '2026-08-28T01:00:00Z',
      endsAt: '2026-08-28T01:35:00Z',
    } as unknown as Parameters<typeof satRunnerReducer>[1] extends never
      ? never
      : Extract<import('../satRunnerReducer').SatRunnerState, { phase: 'module' }>;
    const recovered = satRunnerReducer(createSatRunnerState('schedule-1', 'candidate-1'), {
      type: 'recover',
      state: legacy,
    });
    expect(recovered.phase === 'module' ? recovered.activeTools : undefined).toEqual({
      calculator: true,
      referenceSheet: false,
    });
    expect(recovered.candidateId).toBe('candidate-1');
  });

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
    // Bluebook coexistence (Phase 9): opening Reference no longer closes
    // Calculator. Legacy activeTool is compat-only (calculator wins ties).
    expect(reference.phase === 'module' ? reference.activeTools : undefined).toEqual({
      calculator: true,
      referenceSheet: true,
    });
    expect(reference.phase === 'module' ? reference.activeTool : undefined).toBe('calculator');
  });

  it('closes one tool without touching the other (coexistence)', () => {
    const module = startedMath();
    const both = satRunnerReducer(
      satRunnerReducer(module, { type: 'toggleTool', tool: 'calculator' }),
      { type: 'toggleTool', tool: 'reference_sheet' },
    );
    const closed = satRunnerReducer(both, { type: 'toggleTool', tool: 'calculator' });
    expect(closed.phase === 'module' ? closed.activeTools : undefined).toEqual({
      calculator: false,
      referenceSheet: true,
    });
    expect(closed.phase === 'module' ? closed.activeTool : undefined).toBe('reference_sheet');
  });

  it('updates answer, review, elimination, and annotations in one response aggregate', () => {
    const module = startedMath();
    const answered = satRunnerReducer(module, { type: 'setAnswer', questionId: 'q1', value: 'B' });
    const reviewed = satRunnerReducer(answered, { type: 'setReviewFlag', questionId: 'q1', flagged: true });
    const eliminated = satRunnerReducer(reviewed, { type: 'toggleEliminatedOption', questionId: 'q1', optionId: 'A' });
    const annotated = satRunnerReducer(eliminated, { type: 'setAnnotations', questionId: 'q1', annotations: { version: 2, annotations: [], legacyQuestionNote: 'Check this step' } });

    expect(annotated.phase === 'module' ? annotated.responses.q1 : undefined).toEqual({
      questionId: 'q1',
      answer: 'B',
      markedForReview: true,
      eliminatedOptionIds: ['A'],
      annotations: { version: 2, annotations: [], legacyQuestionNote: 'Check this step' },
    });
  });

  it('restores an eliminated choice when it is selected (no selected+eliminated contradiction)', () => {
    const module = startedMath();
    const eliminated = satRunnerReducer(module, { type: 'toggleEliminatedOption', questionId: 'q1', optionId: 'A' });
    expect(eliminated.phase === 'module' ? eliminated.responses.q1?.eliminatedOptionIds : undefined).toEqual(['A']);
    const answered = satRunnerReducer(eliminated, { type: 'setAnswer', questionId: 'q1', value: 'A' });
    expect(answered.phase === 'module' ? answered.responses.q1 : undefined).toMatchObject({
      answer: 'A',
      eliminatedOptionIds: [],
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
