import { describe, expect, it } from 'vitest';
import {
  createStudentExamViewportPolicy,
  reduceStudentExamViewportPolicy,
  type StudentExamViewportMeasurement,
} from '../studentExamViewportPolicy';

const sample = (
  visualHeight: number | null,
  options: Partial<StudentExamViewportMeasurement> = {},
): StudentExamViewportMeasurement => ({
  visualHeight,
  layoutHeight: 900,
  offsetTop: 0,
  layoutWidth: 1024,
  scale: 1,
  ...options,
});

describe('studentExamViewportPolicy', () => {
  it('preserves the trusted pre-keyboard rectangle while dismissal geometry stays smaller', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(560, { offsetTop: 100 }),
    });

    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 100 });

    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(820, { offsetTop: 20 }),
    });
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(810, { offsetTop: 10 }),
    });

    expect(state.mode).toBe('keyboard-recovery');
    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });
  });

  it('accepts late native-scale growth after keyboard dismissal', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(950, { layoutHeight: 950 }),
    });

    expect(state.mode).toBe('stable');
    expect(state.publishedRect.height).toBe(950);
  });

  it('allows bidirectional bootstrap and topology recovery', () => {
    let state = createStudentExamViewportPolicy(sample(640, { offsetTop: 120 }));
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(900),
    });

    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });

    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'topology-recovery-started' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(700, { layoutHeight: 700, layoutWidth: 768 }),
    });

    expect(state.publishedRect.height).toBe(700);
  });

  it('accepts ordinary browser-chrome shrink after the viewport is stable', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(840, { layoutHeight: 900, offsetTop: 10 }),
    });

    expect(state.publishedRect).toEqual({ height: 840, offsetTop: 10 });
  });

  it('retains one keyboard baseline across editable focus transfer', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(560, { offsetTop: 100 }),
    });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });

    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });
  });

  it('ignores invalid and scaled measurements while retaining the trusted rectangle', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(0, { layoutHeight: 0 }),
    });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(600, { scale: 1.4 }),
    });

    expect(state.publishedRect.height).toBe(900);
  });
});
