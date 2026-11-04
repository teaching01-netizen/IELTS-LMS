import { describe, expect, it } from 'vitest';
import { selectCalculatorAvailable } from '../satCalculatorAvailability';

const MATH = { id: 'math-m1', toolPolicy: { calculator: true } };
const MATH_ARRAY_POLICY = { id: 'math-m1', toolPolicy: ['calculator'] };
const RW_WITH_CALC = { id: 'rw-m1', toolPolicy: { calculator: true } };
const RW = { id: 'rw-m1', toolPolicy: {} };

describe('selectCalculatorAvailable', () => {
  it('returns the live module in module/review when the runner is capable', () => {
    expect(
      selectCalculatorAvailable({
        phase: 'module',
        calculatorCapable: true,
        stateModule: MATH,
        pendingModule: null,
        pendingSectionKey: 'math',
      }),
    ).toBe(MATH);
    expect(
      selectCalculatorAvailable({
        phase: 'review',
        calculatorCapable: true,
        stateModule: MATH,
        pendingModule: null,
        pendingSectionKey: 'math',
      }),
    ).toBe(MATH);
  });

  it('returns null live when the runner is not capable or the module is missing', () => {
    expect(
      selectCalculatorAvailable({
        phase: 'module',
        calculatorCapable: false,
        stateModule: MATH,
        pendingModule: null,
        pendingSectionKey: 'math',
      }),
    ).toBeNull();
    expect(
      selectCalculatorAvailable({
        phase: 'module',
        calculatorCapable: true,
        stateModule: null,
        pendingModule: MATH,
        pendingSectionKey: 'math',
      }),
    ).toBeNull();
  });

  it('prewarms the pending Math module on directions/break', () => {
    for (const phase of ['directions', 'break'] as const) {
      expect(
        selectCalculatorAvailable({
          phase,
          calculatorCapable: false,
          stateModule: null,
          pendingModule: MATH,
          pendingSectionKey: 'math',
        }),
      ).toBe(MATH);
    }
  });

  it('fail-closes: R&W pending never prewarms even with an authored calculator policy', () => {
    expect(
      selectCalculatorAvailable({
        phase: 'directions',
        calculatorCapable: false,
        stateModule: null,
        pendingModule: RW_WITH_CALC,
        pendingSectionKey: 'reading-writing',
      }),
    ).toBeNull();
  });

  it('accepts array tool policies and treats unknown sections as Reading and Writing', () => {
    expect(
      selectCalculatorAvailable({
        phase: 'directions',
        calculatorCapable: false,
        stateModule: null,
        pendingModule: MATH_ARRAY_POLICY,
        pendingSectionKey: 'math',
      }),
    ).toBe(MATH_ARRAY_POLICY);
    expect(
      selectCalculatorAvailable({
        phase: 'directions',
        calculatorCapable: false,
        stateModule: null,
        pendingModule: MATH,
        pendingSectionKey: 'reading-writing',
      }),
    ).toBeNull();
    expect(
      selectCalculatorAvailable({
        phase: 'directions',
        calculatorCapable: false,
        stateModule: null,
        pendingModule: RW,
        pendingSectionKey: 'reading-writing',
      }),
    ).toBeNull();
  });

  it('stays bare outside module/review/directions/break', () => {
    for (const phase of ['loading', 'submitting', 'complete'] as const) {
      expect(
        selectCalculatorAvailable({
          phase,
          calculatorCapable: true,
          stateModule: MATH,
          pendingModule: MATH,
          pendingSectionKey: 'math',
        }),
      ).toBeNull();
    }
  });
});
