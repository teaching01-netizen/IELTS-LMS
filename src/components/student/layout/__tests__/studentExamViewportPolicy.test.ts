import { describe, expect, it } from 'vitest';
import {
  isMeaningfulKeyboardReduction,
  resolveStudentExamViewportPolicy,
  type StudentViewportPolicyInput,
} from '../studentExamViewportPolicy';

function policy(input: Partial<StudentViewportPolicyInput> & {
  previousStableHeight: number | null;
  currentVisualHeight: number;
}) {
  return resolveStudentExamViewportPolicy({
    layoutHeight: input.currentVisualHeight,
    editableFocused: false,
    orientation: 'portrait',
    previousOrientation: null,
    keyboardOpen: false,
    ...input,
  });
}

describe('resolveStudentExamViewportPolicy', () => {
  it('900 -> 580 with an input focused: keyboard open, baseline remains 900', () => {
    const output = policy({
      previousStableHeight: 900,
      currentVisualHeight: 580,
      editableFocused: true,
      previousOrientation: 'portrait',
    });

    expect(output).toEqual({
      stableExamHeight: 900,
      keyboardOpen: true,
      shouldCommitNewBaseline: false,
    });
  });

  it('900 -> 850 with no input: keyboard false, baseline may become 850', () => {
    const output = policy({
      previousStableHeight: 900,
      currentVisualHeight: 850,
      previousOrientation: 'portrait',
    });

    expect(output).toEqual({
      stableExamHeight: 850,
      keyboardOpen: false,
      shouldCommitNewBaseline: true,
    });
  });

  it('900 -> 580 with no input: keyboard false', () => {
    const output = policy({
      previousStableHeight: 900,
      currentVisualHeight: 580,
      previousOrientation: 'portrait',
    });

    expect(output.keyboardOpen).toBe(false);
    expect(output.stableExamHeight).toBe(580);
  });

  it('does not treat a small reduction as a keyboard even while focused', () => {
    const output = policy({
      previousStableHeight: 900,
      currentVisualHeight: 850,
      editableFocused: true,
      previousOrientation: 'portrait',
    });

    expect(output.keyboardOpen).toBe(false);
    expect(output.stableExamHeight).toBe(900);
  });

  it('900 -> 900 after blur: keyboard closes', () => {
    const opened = policy({
      previousStableHeight: 900,
      currentVisualHeight: 580,
      editableFocused: true,
      previousOrientation: 'portrait',
    });
    expect(opened.keyboardOpen).toBe(true);

    const closed = resolveStudentExamViewportPolicy({
      previousStableHeight: 900,
      currentVisualHeight: 900,
      layoutHeight: 900,
      editableFocused: false,
      orientation: 'portrait',
      previousOrientation: 'portrait',
      keyboardOpen: true,
    });

    expect(closed.keyboardOpen).toBe(false);
    expect(closed.stableExamHeight).toBe(900);
    expect(closed.shouldCommitNewBaseline).toBe(false);
  });

  it('portrait -> landscape invalidates and recomputes the baseline', () => {
    const output = policy({
      previousStableHeight: 900,
      currentVisualHeight: 768,
      layoutHeight: 768,
      editableFocused: true,
      keyboardOpen: true,
      orientation: 'landscape',
      previousOrientation: 'portrait',
    });

    expect(output).toEqual({
      stableExamHeight: 768,
      keyboardOpen: false,
      shouldCommitNewBaseline: true,
    });
  });

  it('landscape -> portrait invalidates and recomputes the baseline', () => {
    const output = policy({
      previousStableHeight: 768,
      currentVisualHeight: 1024,
      layoutHeight: 1024,
      orientation: 'portrait',
      previousOrientation: 'landscape',
    });

    expect(output).toEqual({
      stableExamHeight: 1024,
      keyboardOpen: false,
      shouldCommitNewBaseline: true,
    });
  });

  it('keeps the keyboard open across intermediate animation heights', () => {
    let previousStableHeight = 900;
    let keyboardOpen = false;

    for (const height of [700, 620, 400]) {
      const output = resolveStudentExamViewportPolicy({
        previousStableHeight,
        currentVisualHeight: height,
        layoutHeight: 900,
        editableFocused: true,
        orientation: 'portrait',
        previousOrientation: 'portrait',
        keyboardOpen,
      });

      expect(output.keyboardOpen).toBe(true);
      expect(output.stableExamHeight).toBe(900);
      previousStableHeight = output.stableExamHeight;
      keyboardOpen = output.keyboardOpen;
    }
  });

  it('VisualViewport unavailable: falls back to the layout height', () => {
    const output = policy({
      previousStableHeight: null,
      currentVisualHeight: 0,
      layoutHeight: 1024,
    });

    expect(output.stableExamHeight).toBe(1024);
    expect(output.keyboardOpen).toBe(false);
    expect(output.shouldCommitNewBaseline).toBe(true);
  });

  it('defines the keyboard reduction thresholds', () => {
    expect(isMeaningfulKeyboardReduction(580, 900)).toBe(true);
    expect(isMeaningfulKeyboardReduction(850, 900)).toBe(false);
    expect(isMeaningfulKeyboardReduction(0, 900)).toBe(false);
    expect(isMeaningfulKeyboardReduction(900, 0)).toBe(false);
  });
});
