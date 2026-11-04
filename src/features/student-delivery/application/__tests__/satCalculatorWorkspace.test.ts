import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculatorLocaleKey,
  calculatorWorkspaceKey,
  clearCalculatorLocale,
  clearCalculatorLocaleForAttempt,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
  createCalculatorWorkspace,
  isPrewarmKey,
  loadCalculatorLocale,
  loadCalculatorWorkspace,
  saveCalculatorLocale,
  saveCalculatorWorkspace,
} from '../../infrastructure/satCalculatorWorkspace';
import { SAT_EXAM_LOCALE } from '../../infrastructure/desmos/desmosTypes';

describe('satCalculatorWorkspace', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('isolates state by schedule, attempt, and module attempt', () => {
    const first = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const second = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-2');
    expect(first).not.toBe(second);
  });

  it('round-trips the selected embedded calculator mode', () => {
    const key = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    expect(saveCalculatorWorkspace(key, { activeMode: 'scientific' })).toBe(true);
    expect(loadCalculatorWorkspace(key)).toEqual({ activeMode: 'scientific' });
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

  it('freezes the exam locale: seeded storage is never read back', () => {
    const modeKey = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const localeKey = calculatorLocaleKey('schedule-1', 'attempt-1', 'module-1');
    expect(localeKey).not.toBe(modeKey);
    expect(loadCalculatorLocale(localeKey)).toBe(SAT_EXAM_LOCALE);
    expect(saveCalculatorWorkspace(modeKey, { activeMode: 'graphing' })).toBe(true);
    expect(saveCalculatorLocale(localeKey, 'en-US')).toBe(true);
    // The seeded value persists in storage but is never read back: the embed
    // URL always carries the frozen locale (FR-06).
    expect(window.sessionStorage.getItem(localeKey)).toBe(JSON.stringify({ locale: 'en-US' }));
    expect(loadCalculatorLocale(localeKey)).toBe(SAT_EXAM_LOCALE);
    // Mode payload keeps its exact-string contract (separate keys).
    expect(window.sessionStorage.getItem(modeKey)).toBe(JSON.stringify({ activeMode: 'graphing' }));
    window.sessionStorage.setItem(localeKey, '{bad json');
    expect(loadCalculatorLocale(localeKey)).toBe(SAT_EXAM_LOCALE);
    clearCalculatorLocale(localeKey);
    expect(window.sessionStorage.getItem(localeKey)).toBeNull();
  });

  it('flags prewarm storage keys as read-only', () => {
    const real = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'module-1');
    const prewarmWorkspace = calculatorWorkspaceKey('schedule-1', 'attempt-1', 'prewarm:math-m1');
    const prewarmLocale = calculatorLocaleKey('schedule-1', 'attempt-1', 'prewarm:math-m1');
    expect(isPrewarmKey(real)).toBe(false);
    expect(isPrewarmKey(prewarmWorkspace)).toBe(true);
    expect(isPrewarmKey(prewarmLocale)).toBe(true);
    expect(isPrewarmKey('prewarm:math-m1')).toBe(true);
  });

  it('cleans every module locale when the attempt is finalized', () => {
    const first = calculatorLocaleKey('schedule-1', 'attempt-1', 'module-1');
    const second = calculatorLocaleKey('schedule-1', 'attempt-1', 'module-2');
    const other = calculatorLocaleKey('schedule-1', 'attempt-2', 'module-1');
    window.sessionStorage.setItem(first, '{}');
    window.sessionStorage.setItem(second, '{}');
    window.sessionStorage.setItem(other, '{}');
    clearCalculatorLocaleForAttempt('schedule-1', 'attempt-1');
    expect(window.sessionStorage.getItem(first)).toBeNull();
    expect(window.sessionStorage.getItem(second)).toBeNull();
    expect(window.sessionStorage.getItem(other)).toBe('{}');
  });

});
