import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculatorWorkspaceKey,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
  createCalculatorWorkspace,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from '../satCalculatorWorkspace';

describe('satCalculatorWorkspace', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('isolates state by schedule, attempt, and module attempt', () => {
    const first = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const second = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-2');
    expect(first).not.toBe(second);
  });

  it('round-trips opaque Desmos state without interpreting it', () => {
    const key = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const graphingState = { expressions: { list: [{ id: '1', latex: 'y=x^2' }] } };
    expect(saveCalculatorWorkspace(key, { activeMode: 'graphing', graphingState })).toBe(true);
    expect(loadCalculatorWorkspace(key)).toEqual({ activeMode: 'graphing', graphingState });
  });

  it('returns a safe default for corrupt state and clears persisted state', () => {
    const key = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    window.sessionStorage.setItem(key, '{bad json');
    expect(loadCalculatorWorkspace(key)).toEqual(createCalculatorWorkspace());
    clearCalculatorWorkspace(key);
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });
  it('cleans every module workspace when the attempt is finalized', () => {
    const first = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const second = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-2');
    const other = calculatorWorkspaceKey('schedule-1', 'attempt-2', 'module-1');
    window.sessionStorage.setItem(first, '{}');
    window.sessionStorage.setItem(second, '{}');
    window.sessionStorage.setItem(other, '{}');
    clearCalculatorWorkspacesForAttempt('schedule-1', 'attempt-1');
    expect(window.sessionStorage.getItem(first)).toBeNull();
    expect(window.sessionStorage.getItem(second)).toBeNull();
    expect(window.sessionStorage.getItem(other)).toBe('{}');
  });

});
