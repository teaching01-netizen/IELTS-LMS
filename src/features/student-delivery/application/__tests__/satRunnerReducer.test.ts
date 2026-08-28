import { describe, expect, it } from 'vitest';
import { createSatRunnerState, satRunnerReducer } from '../satRunnerReducer';

describe('satRunnerReducer', () => {
  it('moves through directions, timed modules, break, and completion', () => {
    const loading = createSatRunnerState('schedule-1', 'candidate-1');
    const directions = satRunnerReducer(loading, { type: 'bootstrapLoaded', assessmentId: 'assessment-1' });
    const module = satRunnerReducer(directions, {
      type: 'moduleStarted',
      sectionKey: 'reading-writing',
      moduleKey: 'rw-m1',
      questionIds: ['q1', 'q2'],
      startedAt: '2026-08-28T01:00:00Z',
      endsAt: '2026-08-28T01:32:00Z',
    });
    const answered = satRunnerReducer(module, { type: 'setResponse', questionId: 'q1', value: 'A' });
    const reviewed = satRunnerReducer(answered, { type: 'reviewModule' });
    const broken = satRunnerReducer(reviewed, { type: 'startBreak', nextSectionKey: 'math', resumeAt: '2026-08-28T01:42:00Z' });
    const math = satRunnerReducer(broken, {
      type: 'routeToModule',
      sectionKey: 'math',
      moduleKey: 'math-m1',
      questionIds: ['m1'],
      startedAt: '2026-08-28T01:42:00Z',
      endsAt: '2026-08-28T02:17:00Z',
    });
    const submitting = satRunnerReducer(math, { type: 'submit' });
    const complete = satRunnerReducer(submitting, { type: 'completed', resultId: 'result-1' });

    expect(directions.phase).toBe('directions');
    expect(answered.phase === 'module' ? answered.answers.q1 : undefined).toBe('A');
    expect(broken.phase).toBe('break');
    expect(math.phase === 'module' ? math.sectionKey : undefined).toBe('math');
    expect(complete).toMatchObject({ phase: 'complete', resultId: 'result-1' });
  });

  it('advances directly from a submitted module render without relying on a stale phase', () => {
    const module = satRunnerReducer(
      satRunnerReducer(createSatRunnerState('schedule-1', 'candidate-1'), {
        type: 'bootstrapLoaded',
        assessmentId: 'assessment-1',
      }),
      {
        type: 'moduleStarted',
        sectionKey: 'reading-writing',
        moduleKey: 'rw-m1',
        questionIds: ['q1'],
        startedAt: '2026-08-28T01:00:00Z',
        endsAt: '2026-08-28T01:32:00Z',
      },
    );
    const nextModule = satRunnerReducer(module, {
      type: 'routeToModule',
      sectionKey: 'reading-writing',
      moduleKey: 'rw-m2-higher',
      questionIds: ['q2'],
      startedAt: '2026-08-28T01:32:00Z',
      endsAt: '2026-08-28T02:04:00Z',
    });
    const breakState = satRunnerReducer(module, {
      type: 'startBreak',
      nextSectionKey: 'math',
      resumeAt: '2026-08-28T01:42:00Z',
    });

    expect(nextModule).toMatchObject({ phase: 'module', moduleKey: 'rw-m2-higher' });
    expect(breakState).toMatchObject({ phase: 'break', nextSectionKey: 'math' });
  });

  it('keeps the latest recovered server state authoritative', () => {
    const local = createSatRunnerState('schedule-1', 'candidate-1');
    const recovered = { phase: 'complete', scheduleId: 'schedule-1', candidateId: 'candidate-1', assessmentId: 'a', resultId: 'r' } as const;
    expect(satRunnerReducer(local, { type: 'recover', state: recovered })).toEqual(recovered);
  });
  it('returns from review without losing answers, timing, or position', () => {
    const directions = satRunnerReducer(createSatRunnerState('schedule-1', 'candidate-1'), {
      type: 'bootstrapLoaded', assessmentId: 'assessment-1',
    });
    const module = satRunnerReducer(directions, {
      type: 'moduleStarted', sectionKey: 'math', moduleKey: 'math-m1', questionIds: ['q1', 'q2'],
      startedAt: '2026-08-28T01:00:00Z', endsAt: '2026-08-28T01:35:00Z', tools: { calculator: true },
    });
    const positioned = satRunnerReducer(module, { type: 'selectQuestion', questionIndex: 1 });
    const answered = satRunnerReducer(positioned, { type: 'setResponse', questionId: 'q2', value: '42' });
    const review = satRunnerReducer(answered, { type: 'reviewModule' });
    const returned = satRunnerReducer(review, { type: 'returnToModule' });

    expect(returned).toMatchObject({
      phase: 'module', questionIndex: 1, answers: { q2: '42' },
      startedAt: '2026-08-28T01:00:00Z', endsAt: '2026-08-28T01:35:00Z',
      toolState: { calculator: true },
    });
  });

});
